/**
 * @fileoverview Anthropic (Claude) implementation of {@link Provider}.
 *
 * ## Responsibilities
 *
 * - **Chat**: Maps toolkit `Message[]` to the Messages API (`role` + `content` for user/assistant;
 *   system text uses the top-level `system` field — there is no `system` role in request messages).
 * - **Structured output**: `sendStructuredConversation` uses `messages.parse` with
 *   `output_config.format: zodOutputFormat(schema)` so the SDK validates JSON against Zod.
 * - **Streaming**: Subscribes to `content_block_delta` / `text_delta` events only.
 * - **Embeddings**: Not supported; {@link embed} always throws `501`.
 *
 * ## Options handling
 *
 * Toolkit fields (`model`, `temperature`, …) are pulled out so `...rest` can carry Anthropic-only
 * parameters. `structuredOutputName` is stripped because it is OpenAI-specific and must not be
 * forwarded to Anthropic.
 *
 * @see {@link Provider} for the shared interface.
 */

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
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';
import type {
	MessageParam,
	MessageCreateParamsNonStreaming,
	MessageCreateParamsStreaming,
	ContentBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type { ModelInfo } from '@anthropic-ai/sdk/resources/models';
import {
	toAnthropicContent,
	toAnthropicMessages,
	toAnthropicTools,
	toAnthropicToolChoice,
	fromAnthropicToolUse,
	mapAnthropicStopReason,
} from './anthropic-mapping';

/**
 * Splits {@link LLMOptions} into known toolkit fields vs `rest` spread onto Anthropic requests.
 */
function separateOptions(options: LLMOptions = {}) {
	const {
		model,
		temperature,
		maxTokens,
		systemPrompt,
		responseFormat,
		stream,
		// Toolkit-managed: translated into Anthropic's native tool params, not forwarded raw in `...rest`.
		tools,
		toolChoice,
		// OpenAI-only hint; Anthropic ignores it but we strip so it never lands in `...rest` and confuses the SDK.
		structuredOutputName: _structuredOutputName,
		...rest
	} = options as LLMOptions & { structuredOutputName?: string };

	const known = {
		model,
		temperature,
		maxTokens,
		systemPrompt,
		responseFormat,
		stream,
		tools,
		toolChoice,
		structuredOutputName: _structuredOutputName,
	};

	return { known, rest };
}

export class AnthropicProvider implements Provider {
	private client: Anthropic;
	private logger: LoggerInterface;
	private defaultModel: string;

	/**
	 * Initializes a new instance of the AnthropicProvider
	 * @param apiKey - Anthropic API key.
	 * @param defaultModel - Used when `options.model` is omitted.
	 * @param logger - Toolkit logger for diagnostics.
	 */
	constructor(apiKey: string, defaultModel: string, logger: LoggerInterface) {
		this.client = new Anthropic({ apiKey });
		this.defaultModel = defaultModel;
		this.logger = logger;
		this.logger.debug('AnthropicProvider initialized', { defaultModel });
	}

	/**
	 * Gets the name of the provider.
	 * @returns The string 'anthropic'.
	 */
	getName(): string {
		return 'anthropic';
	}

	/**
	 * Fetches the list of available model IDs from the Anthropic API.
	 * Handles pagination automatically.
	 * @returns A promise resolving to an array of model ID strings.
	 */
	async getAvailableModels(): Promise<string[]> {
		this.logger.debug('Fetching available Anthropic models');
		try {
			const modelInfos: ModelInfo[] = [];
			// SDK async iterator may paginate; collect everything so callers see the full catalog, not just the first page.
			for await (const modelInfo of this.client.models.list()) {
				modelInfos.push(modelInfo);
			}

			// Map the model information to the model IDs
			const modelIds = modelInfos.map((model) => model.id);
			this.logger.debug(`Found ${modelIds.length} Anthropic models`);
			return modelIds;
		} catch (error) {
			this.logger.error('Error fetching Anthropic models', { error });
			throw this.handleError(error);
		}
	}

	/**
	 * Sends a single user message to the LLM and gets a response.
	 * This is a convenience method that delegates to `sendConversation`.
	 * @param message - The user message content.
	 * @param options - Optional LLM parameters.
	 * @returns A promise resolving to the LLMResponse.
	 */
	async sendMessage(
		message: string,
		options?: LLMOptions
	): Promise<LLMResponse> {
		this.logger.debug('sendMessage: Delegating to sendConversation');
		// System is not duplicated here: sendConversation reads `options.systemPrompt` into the top-level `system` field.
		const messages: Message[] = [{ role: 'user', content: message }];
		// Delegate to the main sendConversation method.
		return this.sendConversation(messages, options);
	}

	/**
	 * Non-streaming Messages API call. `options.systemPrompt` becomes the `system` parameter; any
	 * `system` entries inside `messages` are filtered out of `messages` because Anthropic expects
	 * system text only at the top level.
	 * @param messages - The messages to send to the Anthropic API
	 * @param options - The options for the Anthropic API
	 * @returns The response from the Anthropic API
	 */
	async sendConversation(
		messages: Message[],
		options?: LLMOptions
	): Promise<LLMResponse> {
		const model = options?.model || this.defaultModel;
		const systemPrompt = options?.systemPrompt; // Extract system prompt

		this.logger.debug('Sending conversation to Anthropic', {
			model,
			messageCount: messages.length,
			hasSystemPrompt: !!systemPrompt,
			// Avoid logging potentially sensitive options content directly
			// options: options // Consider selective logging if needed
		});

		// Anthropic does not allow `system` inside `messages`; system-only instructions must use the top-level `system` field instead.
		// System filtering + tool_use / tool_result mapping live in anthropic-mapping.
		const anthropicMessages: MessageParam[] = toAnthropicMessages(messages);

		try {
			const { rest } = separateOptions(options);

			// Construct parameters for the Anthropic API call.
			const params: MessageCreateParamsNonStreaming = {
				model: model,
				messages: anthropicMessages,
				// API requires a positive max_tokens; 4096 matches a reasonable default when callers omit maxTokens.
				max_tokens: options?.maxTokens || 4096,
				temperature: options?.temperature,
				// Pass the extracted system prompt directly to the 'system' parameter.
				system: systemPrompt,
				tools:
					options?.tools && options.tools.length > 0
						? toAnthropicTools(options.tools)
						: undefined,
				tool_choice: toAnthropicToolChoice(options?.toolChoice),
				stream: false,
				...rest,
				// TODO: Potentially map other options like stop_sequences if added to LLMOptions
			};

			const response = await this.client.messages.create(params);
			return this.normalizeResponse(response);
		} catch (error) {
			this.logger.error('Error sending conversation to Anthropic', { error });
			throw this.handleError(error);
		}
	}

	/**
	 * Structured completion: same message mapping as {@link sendConversation}, but uses
	 * `messages.parse` so `response.parsed_output` is validated against `schema`.
	 * 
	 * @param messages - The messages to send to the Anthropic API
	 * @param schema - The schema to use for the structured output
	 * @param options - The options for the Anthropic API
	 * @returns The response from the Anthropic API
	 *
	 * @throws {APIError} If `parsed_output` is null after a successful HTTP response.
	 */
	async sendStructuredConversation<T>(
		messages: Message[],
		schema: ZodType<T>,
		options?: StructuredOutputOptions
	): Promise<LLMStructuredResponse<T>> {
		// Tools and structured output are mutually exclusive in 0.4.0: run the
		// tool loop with sendConversation, reserve structured for the final turn.
		// Thrown before the try so it propagates as-is rather than being logged
		// and rewrapped by handleError.
		if (options?.tools && options.tools.length > 0) {
			throw new APIError(
				'Tool calling is not supported with structured output; use sendConversation for the tool loop.',
				400,
				{ provider: 'anthropic' }
			);
		}

		const model = options?.model || this.defaultModel;
		const systemPrompt = options?.systemPrompt;

		// System filtering + tool_use / tool_result mapping live in anthropic-mapping.
		const anthropicMessages: MessageParam[] = toAnthropicMessages(messages);

		try {
			const { rest } = separateOptions(options);

			// `parse` validates `parsed_output` against the Zod schema server-side (when supported); we still null-check below.
			const response = await this.client.messages.parse({
				model,
				messages: anthropicMessages,
				max_tokens: options?.maxTokens || 4096,
				temperature: options?.temperature,
				system: systemPrompt,
				stream: false,
				output_config: {
					format: zodOutputFormat(schema),
				},
				...rest,
			});

			// Successful HTTP does not guarantee parsed_output (e.g. stop before structured body); treat as hard failure for callers expecting T.
			if (response.parsed_output == null) {
				throw new APIError(
					'Anthropic structured completion returned no parsed_output',
					502,
					{ provider: 'anthropic', stop_reason: response.stop_reason }
				);
			}

			const base = this.normalizeResponse(response);
			const parsed = response.parsed_output as T;
			return {
				...base,
				content: JSON.stringify(parsed),
				parsed,
			};
		} catch (error) {
			this.logger.error('Error sending structured conversation to Anthropic', {
				error,
			});
			throw this.handleError(error);
		}
	}

	/**
	 * Streams assistant text: listens for `content_block_delta` with `text_delta` only. Token usage
	 * on the returned {@link LLMResponse} is left undefined (full usage is available on stream
	 * end events; this provider keeps the implementation small).
	 */
	async streamConversation(
		messages: Message[],
		callback: (chunk: string) => void,
		options?: LLMOptions
	): Promise<LLMResponse> {
		const model = options?.model || this.defaultModel;
		const systemPrompt = options?.systemPrompt;

		this.logger.debug('Streaming conversation from Anthropic', {
			model,
			messageCount: messages.length,
			hasSystemPrompt: !!systemPrompt,
		});

		// Filter system messages and map roles, same as sendConversation.
		// System filtering + tool_use / tool_result mapping live in anthropic-mapping.
		const anthropicMessages: MessageParam[] = toAnthropicMessages(messages);

		let fullContent = ''; // Accumulates the full response text from stream chunks.
		// tool_use inputs stream as partial JSON keyed by block index; buffer
		// them here and parse only when the stream completes.
		const toolAccByIndex = new Map<number, { id: string; name: string; json: string }>();
		let rawStopReason: string | null | undefined;
		const { rest } = separateOptions(options);

		try {
			// Construct parameters, ensuring stream is set to true.
			const params: MessageCreateParamsStreaming = {
				model: model,
				messages: anthropicMessages,
				max_tokens: options?.maxTokens || 4096,
				temperature: options?.temperature,
				system: systemPrompt,
				tools:
					options?.tools && options.tools.length > 0
						? toAnthropicTools(options.tools)
						: undefined,
				tool_choice: toAnthropicToolChoice(options?.toolChoice),
				stream: true,
				...rest,
			};

			const stream = await this.client.messages.create(params);

			// Process the stream events asynchronously.
			for await (const event of stream) {
				if (
					event.type === 'content_block_start' &&
					event.content_block.type === 'tool_use'
				) {
					toolAccByIndex.set(event.index, {
						id: event.content_block.id,
						name: event.content_block.name,
						json: '',
					});
				} else if (event.type === 'content_block_delta') {
					if (event.delta.type === 'text_delta') {
						const chunk = event.delta.text;
						fullContent += chunk;
						callback(chunk); // Invoke the callback with the new chunk.
					} else if (event.delta.type === 'input_json_delta') {
						const acc = toolAccByIndex.get(event.index);
						if (acc) {
							acc.json += event.delta.partial_json;
						}
					}
				} else if (event.type === 'message_delta') {
					rawStopReason = event.delta.stop_reason ?? rawStopReason;
				}
				// Usage information is typically not fully available until the 'message_stop' event in Anthropic's stream,
				// so we return undefined usage for simplicity, matching Ollama provider behavior.
			}

			this.logger.debug('Anthropic stream finished');

			const accumulated = [...toolAccByIndex.values()];
			const toolCalls =
				accumulated.length > 0
					? accumulated.map((acc) => {
						let args: Record<string, unknown>;
						try {
							args = acc.json ? JSON.parse(acc.json) : {};
						} catch {
							throw new APIError(
								`Model returned invalid JSON arguments for tool '${acc.name}'.`,
								502,
								{ provider: 'anthropic', tool: acc.name }
							);
						}
						return { id: acc.id, name: acc.name, arguments: args };
					})
					: undefined;

			// Return the final response structure after the stream is complete.
			return {
				content: fullContent,
				toolCalls,
				stopReason: mapAnthropicStopReason(rawStopReason),
				model: model,
				usage: {
					// Stream end events can carry usage; we leave these undefined to keep the stream path simple unless we subscribe to more event types.
					promptTokens: undefined,
					completionTokens: undefined,
					totalTokens: undefined,
				},
				metadata: { provider: 'anthropic' }, // Basic metadata
			};
		} catch (error) {
			this.logger.error('Error streaming conversation from Anthropic', {
				error,
			});
			throw this.handleError(error);
		}
	}

	// --- Helper Methods ---

	/**
	 * Anthropic does not expose embeddings on this code path.
	 *
	 * @throws {APIError} Always — HTTP 501 Not Implemented.
	 */
	async embed(
		texts: string[],
		options?: EmbeddingOptions
	): Promise<EmbeddingResponse> {
		const errorMessage = 'Embeddings are not supported by the Anthropic provider.';
		this.logger.warn(errorMessage, { textsLength: texts.length, options });
		throw new APIError(errorMessage, 501, { provider: 'anthropic' });
	}

	/**
	 * Normalizes the response object from the Anthropic API (`Anthropic.Message`)
	 * into the toolkit's standard `LLMResponse` format.
	 * @param response - The response object from `client.messages.create`.
	 * @returns An LLMResponse object.
	 */
	private normalizeResponse(response: Anthropic.Message): LLMResponse {
		// Extract text content. Assumes the primary response is in the first 'text' type content block.
		// More complex handling might be needed if multiple text blocks or other types (tool_use) are expected.
		const textContent =
			response.content.find((block) => block.type === 'text')?.text || '';

		// Extract usage data, calculate total, and handle potential null/undefined values from the API.
		const promptTokens = response.usage?.input_tokens ?? undefined;
		const completionTokens = response.usage?.output_tokens ?? undefined;
		const totalTokens =
			promptTokens !== undefined && completionTokens !== undefined
				? promptTokens + completionTokens
				: undefined;

		return {
			content: textContent,
			toolCalls: fromAnthropicToolUse(
				// Cast via unknown: this SDK's ContentBlock union (e.g. ContainerUploadBlock)
				// lacks an index signature, so a direct assertion is rejected.
				response.content as unknown as Array<{ type: string; [key: string]: unknown }>
			),
			stopReason: mapAnthropicStopReason(response.stop_reason),
			model: response.model,
			usage: {
				promptTokens: promptTokens,
				completionTokens: completionTokens,
				totalTokens: totalTokens,
			},
			metadata: {
				provider: 'anthropic',
				// Include potentially useful metadata from the Anthropic response.
				id: response.id,
				stop_reason: response.stop_reason,
				stop_sequence: response.stop_sequence,
			},
		};
	}

	/**
	 * Handles errors thrown by the Anthropic SDK or other issues during API interaction.
	 * Wraps errors in the toolkit's standard `APIError`.
	 * @param error - The error object caught.
	 * @returns An instance of `APIError`.
	 */
	private handleError(error: any): Error {
		this.logger.error('Anthropic API Error encountered', { error });

		// Prefer typed SDK errors for status propagation; fall back to stringifying unknown throwables.
		if (error instanceof Anthropic.APIError) {
			// Log specific known details from Anthropic API errors.
			this.logger.error('Anthropic APIError details', {
				status: error.status,
				name: error.name,
				message: error.message,
			});
			// Create a standardized APIError for the toolkit.
			return new APIError(error.message, error.status || 500, {
				provider: 'anthropic',
				originalError: error, // Preserve the original error for deeper inspection if needed.
				errorName: error.name, // Include the specific error name.
			});
		}
		// Handle non-API errors (e.g., network issues) or unexpected errors.
		const message = error instanceof Error ? error.message : 'Unknown error occurred';
		return new APIError(
			`Anthropic Provider Error: ${message}`,
			500, // Assume internal server error for unknown issues.
			{ provider: 'anthropic', originalError: error }
		);
	}
}
