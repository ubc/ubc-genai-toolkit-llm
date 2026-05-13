/**
 * @fileoverview OpenAI-backed implementation of {@link Provider}.
 *
 * ## Responsibilities
 *
 * - **Chat**: `sendMessage` / `sendConversation` / `streamConversation` map toolkit types to the
 *   official OpenAI Node SDK (`chat.completions.create`).
 * - **Structured output**: `sendStructuredConversation` uses `beta.chat.completions.parse` with
 *   `zodResponseFormat` so replies are validated against a caller-supplied Zod schema (requires a
 *   model that supports structured outputs / parse).
 * - **Embeddings**: `embed` delegates to `embeddings.create`.
 *
 * ## Options handling
 *
 * `LLMOptions` may include provider-specific fields (e.g. extra body params). We peel off fields
 * the toolkit manages explicitly so they are not duplicated inside `...rest`. `structuredOutputName`
 * is only for structured calls but is stripped here so it never leaks into generic `create` requests.
 *
 * @see {@link Provider} for the shared interface.
 */

import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { ZodType } from 'zod';
import { Provider } from './provider-interface';
import {
	LLMOptions,
	LLMResponse,
	LLMStructuredResponse,
	Message,
	StructuredOutputOptions,
	EmbeddingOptions,
	EmbeddingResponse,
} from '../types';
import { LoggerInterface, APIError } from 'ubc-genai-toolkit-core';

/**
 * Splits {@link LLMOptions} into fields we set explicitly on each request vs. passthrough `rest`.
 *
 * `rest` is spread into the SDK call so callers can pass supported OpenAI parameters not modeled
 * on `LLMOptions`, without colliding with toolkit-managed keys.
 */
function separateOpenAIOptions(options: LLMOptions = {}) {
	const {
		model,
		temperature,
		maxTokens,
		systemPrompt,
		responseFormat,
		stream,
		// Rename so it is not forwarded in `rest`; only structured calls need the name, and generic chat must not send it.
		structuredOutputName: _structuredOutputName,
		...rest
	} = options as LLMOptions & { structuredOutputName?: string };

	// Create a new object with the known options
	const known = {
		model,
		temperature,
		maxTokens,
		systemPrompt,
		responseFormat,
		stream,
		structuredOutputName: _structuredOutputName,
	};

	// Return the known options and the rest of the options
	return { known, rest };
}

export class OpenAIProvider implements Provider {
	private client: OpenAI;
	private logger: LoggerInterface;
	private defaultModel: string;
	private embeddingModel?: string;

	/**
	 * @param apiKey - OpenAI API key (or compatible proxy key).
	 * @param defaultModel - Used when `options.model` is omitted.
	 * @param logger - Toolkit logger for diagnostics.
	 * @param options.endpoint - Optional base URL override (Azure OpenAI, proxies, etc.).
	 * @param options.embeddingModel - Default embedding model when `embed` omits `options.model`.
	 */
	constructor(
		apiKey: string,
		defaultModel: string,
		logger: LoggerInterface,
		options?: {
			endpoint?: string;
			embeddingModel?: string;
		}
	) {
		// Omit baseURL when unset so the client uses the default OpenAI API host; custom baseURL supports Azure-compatible proxies.
		this.client = new OpenAI({
			apiKey,
			...(options?.endpoint ? { baseURL: options.endpoint } : {}),
		});
		this.defaultModel = defaultModel;
		this.embeddingModel = options?.embeddingModel;
		this.logger = logger;
	}

	/**
	 * Get the name of the provider
	 * @returns The name of the provider
	 */
	getName(): string {
		return 'openai';
	}

	/**
	 * Get the available models for the OpenAI API
	 * @returns The available models for the OpenAI API
	 */
	async getAvailableModels(): Promise<string[]> {
		try {
			const models = await this.client.models.list();
			return models.data.map((model) => model.id);
		} catch (error) {
			this.logger.error('Error fetching OpenAI models', { error });
			throw this.handleError(error);
		}
	}

	/**
	 * Single-turn helper: builds `[{ role: 'user', ... }]` (plus optional system from `options`)
	 * and delegates to {@link sendConversation}.
	 */
	async sendMessage(
		message: string,
		options?: LLMOptions
	): Promise<LLMResponse> {
		const messages: Message[] = [{ role: 'user', content: message }];

		// Match sendConversation: inject system as a real message when callers use options.systemPrompt (not only via history).
		if (options?.systemPrompt) {
			messages.unshift({ role: 'system', content: options.systemPrompt });
		}

		return this.sendConversation(messages, options);
	}

	/**
	 * Send a conversation to the OpenAI API
	 * @param messages - The messages to send to the OpenAI API
	 * @param options - The options for the OpenAI API
	 * @returns The response from the OpenAI API
	 */
	async sendConversation(
		messages: Message[],
		options?: LLMOptions
	): Promise<LLMResponse> {
		try {
			const model = options?.model || this.defaultModel;

			// Convert to OpenAI format
			const openaiMessages = messages.map((msg) => ({
				role: msg.role,
				content: msg.content,
			}));

			// Avoid duplicating system: if the transcript already has system, trust it; else prepend options.systemPrompt once.
			if (options?.systemPrompt && !messages.some((m) => m.role === 'system')) {
				openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
			}

			// Separate the options into known and unknown options
			const { rest } = separateOpenAIOptions(options);

			// Create a new response from the OpenAI API
			const response = await this.client.chat.completions.create({
				model,
				messages: openaiMessages,
				temperature: options?.temperature,
				max_tokens: options?.maxTokens,
				// OpenAI JSON mode is opt-in via response_format; omit entirely when not requested so the model stays unconstrained.
				response_format:
					options?.responseFormat === 'json'
						? { type: 'json_object' }
						: undefined,
				// Explicit false: callers might pass `stream` in `rest`; we need a non-streaming completion for normalizeResponse.
				stream: false,
				...rest,
			});

			return this.normalizeResponse(response);
		} catch (error) {
			this.logger.error('Error calling OpenAI API', { error });
			throw this.handleError(error);
		}
	}

	/**
	 * Send a structured conversation to the OpenAI API
	 * @param messages - The messages to send to the OpenAI API
	 * @param schema - The schema to use for the structured output
	 * @param options - The options for the OpenAI API
	 * @returns The response from the OpenAI API
	 * 
	 */
	async sendStructuredConversation<T>(
		messages: Message[],
		schema: ZodType<T>,
		options?: StructuredOutputOptions
	): Promise<LLMStructuredResponse<T>> {
		try {
			const model = options?.model || this.defaultModel;

			const openaiMessages = messages.map((msg) => ({
				role: msg.role,
				content: msg.content,
			}));

			if (options?.systemPrompt && !messages.some((m) => m.role === 'system')) {
				openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
			}

			const { rest } = separateOpenAIOptions(options);
			// SDK uses this label inside the response_format payload; default keeps logs and debugging consistent across callers.
			const formatName =
				options?.structuredOutputName ?? 'structured_output';

			const response = await this.client.beta.chat.completions.parse({
				model,
				messages: openaiMessages,
				temperature: options?.temperature,
				max_tokens: options?.maxTokens,
				response_format: zodResponseFormat(schema, formatName),
				// parse() is non-streaming only; keep false so `...rest` cannot flip this to a stream by accident.
				stream: false,
				...rest,
			});

			const message = response.choices[0]?.message;
			const refusal = (message as { refusal?: string } | undefined)?.refusal;
			// Structured outputs can return a refusal string instead of parsed JSON; surface that explicitly vs a generic parse failure.
			if (refusal) {
				throw new APIError(
					`OpenAI model refused structured output: ${refusal}`,
					400,
					{ provider: 'openai', refusal }
				);
			}

			// parse() should populate `parsed` when the model complies; missing means we cannot trust the payload as T.
			if (message?.parsed == null) {
				throw new APIError(
					'OpenAI structured completion returned no parsed content',
					502,
					{ provider: 'openai', finish_reason: response.choices[0]?.finish_reason }
				);
			}

			const base = this.normalizeResponse(response as OpenAI.Chat.Completions.ChatCompletion);
			return {
				...base,
				// Prefer human-visible string content when the API sends it; otherwise expose the structured object as JSON text.
				content:
					typeof message.content === 'string'
						? message.content
						: JSON.stringify(message.parsed),
				parsed: message.parsed as T,
			};
		} catch (error) {
			this.logger.error('Error calling OpenAI structured API', { error });
			throw this.handleError(error);
		}
	}

	/**
	 * Token streaming: invokes `callback` for each text delta; returned {@link LLMResponse} holds
	 * the full concatenated string. Usage fields are not filled for this path.
	 * @param messages - The messages to send to the OpenAI API
	 * @param callback - The callback to use for the OpenAI API
	 * @param options - The options for the OpenAI API
	 * @returns The response from the OpenAI API
	 */
	async streamConversation(
		messages: Message[],
		callback: (chunk: string) => void,
		options?: LLMOptions
	): Promise<LLMResponse> {
		try {
			const model = options?.model || this.defaultModel;

			const openaiMessages = messages.map((msg) => ({
				role: msg.role,
				content: msg.content,
			}));

			if (options?.systemPrompt && !messages.some((m) => m.role === 'system')) {
				openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
			}

			const { rest } = separateOpenAIOptions(options);

			const stream = await this.client.chat.completions.create({
				model,
				messages: openaiMessages,
				temperature: options?.temperature,
				max_tokens: options?.maxTokens,
				stream: true,
				...rest,
			});

			let fullContent = '';
			for await (const chunk of stream) {
				const content = chunk.choices[0]?.delta?.content || '';
				// Skip empty deltas so callers are not spammed; OpenAI may emit choice/metadata-only chunks.
				if (content) {
					fullContent += content;
					callback(content);
				}
			}

			return {
				content: fullContent,
				model: model,
				metadata: { provider: 'openai' },
			};
		} catch (error) {
			this.logger.error('Error streaming from OpenAI API', { error });
			throw this.handleError(error);
		}
	}

	/**
	 * Text embeddings for one or more input strings. Extra fields on `EmbeddingOptions` (e.g.
	 * `dimensions` for some models) are forwarded except `truncate`, which is not an OpenAI
	 * embeddings API field and is stripped here.
	 * @param texts - The texts to embed
	 * @param options - The options for the OpenAI API
	 * @returns The response from the OpenAI API
	 */
	async embed(
		texts: string[],
		options?: EmbeddingOptions
	): Promise<EmbeddingResponse> {
		try {
			const model = options?.model || this.embeddingModel || 'text-embedding-3-small';

			// `truncate` is a toolkit convenience, not part of OpenAI's embeddings.create body — strip so the SDK does not reject unknown keys.
			const { truncate: _truncate, ...providerOptions } = options || {};
			// Model is passed as the top-level `model` argument below, not inside the spread.
			delete providerOptions.model;

			const response = await this.client.embeddings.create({
				model: model,
				input: texts,
				...providerOptions,
			});

			return this.normalizeEmbeddingResponse(response);
		} catch (error) {
			this.logger.error('Error calling OpenAI Embeddings API', { error });
			throw this.handleError(error);
		}
	}

	/**
	 * Normalize the response from the OpenAI API
	 * @param response - The response from the OpenAI API
	 * @returns The normalized response
	 */
	private normalizeResponse(
		response: OpenAI.Chat.Completions.ChatCompletion
	): LLMResponse {
		return {
			// Empty string if the model returned only tool calls or an unexpected shape — keeps LLMResponse.content always a string.
			content: response.choices[0]?.message?.content || '',
			model: response.model,
			usage: {
				promptTokens: response.usage?.prompt_tokens,
				completionTokens: response.usage?.completion_tokens,
				totalTokens: response.usage?.total_tokens,
			},
			metadata: {
				provider: 'openai',
				id: response.id,
				created: response.created,
			},
		};
	}

	/** Maps OpenAI embeddings response to {@link EmbeddingResponse}. */
	private normalizeEmbeddingResponse(
		response: OpenAI.Embeddings.CreateEmbeddingResponse
	): EmbeddingResponse {
		return {
			embeddings: response.data.map((item) => item.embedding),
			model: response.model,
			usage: {
				promptTokens: response.usage?.prompt_tokens,
				totalTokens: response.usage?.total_tokens,
			},
			metadata: {
				provider: 'openai',
			},
		};
	}

	/** Wraps `OpenAI.APIError` in {@link APIError}; everything else becomes a generic message. */
	private handleError(error: any): Error {
		// Preserve status/code/param from the official client for observability; everything else stays a generic toolkit error.
		if (error instanceof OpenAI.APIError) {
			return new APIError(error.message, error.status || 500, {
				type: error.name,
				code: error.code,
				param: error.param,
			});
		}
		return new APIError('Unknown error occurred while calling OpenAI API');
	}
}
