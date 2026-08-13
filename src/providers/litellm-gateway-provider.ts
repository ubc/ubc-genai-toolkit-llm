/**
 * @fileoverview Shared transport for UBC's LiteLLM gateways.
 *
 * Both {@link UbcLlmSandboxProvider} and {@link UbcLlmProxyProvider} talk to a
 * LiteLLM proxy presenting an OpenAI-compatible API. The wire work — endpoint
 * client, `/models`, `/chat/completions` (buffered and streamed), `/embeddings`,
 * response normalization, error mapping — is identical for both and lives here.
 *
 * What differs is **model policy**, and only model policy:
 *
 * | Provider           | Models reachable                                      |
 * | ------------------ | ----------------------------------------------------- |
 * | `ubc-llm-sandbox`  | only the approved B300 chat/embedding allowlist        |
 * | `ubc-llm-proxy`    | anything the caller's API key is entitled to           |
 *
 * Subclasses express that difference through three hooks — {@link
 * LiteLLMGatewayProvider.filterAvailableModels}, {@link
 * LiteLLMGatewayProvider.validateModel} and {@link
 * LiteLLMGatewayProvider.modelGuidance} — and nothing else. Keeping the policy
 * surface that small is the point of the split: a change to the transport
 * cannot quietly widen what the sandbox will talk to.
 *
 * @see {Provider} Interface definition for LLM providers.
 */

import OpenAI from 'openai';
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
import {
	LoggerInterface,
	APIError,
	ConfigurationError,
	ToolkitError,
} from 'ubc-genai-toolkit-core';
import type { ZodType } from 'zod';
import {
	separateOpenAIOptions,
	buildOpenAICompatCompletionFields,
	OpenAICompatCompletionKnown,
	toOpenAIMessages,
	toOpenAITools,
	fromOpenAIToolCalls,
	mapOpenAIFinishReason,
} from './openai-compat-mapping';
import {
	resolveGatewayReasoning,
	getGatewayReasoningCapability,
} from './litellm-gateway-config';

/** What a model id is being resolved for; used in error messages. */
export type ModelPurpose = 'chat' | 'embedding';

/** Constructor input for {@link LiteLLMGatewayProvider}. */
export interface LiteLLMGatewayProviderConfig {
	/** Provider id — `getName()`, response metadata, and error details. */
	providerName: string;
	/**
	 * Human-readable name used in log lines and error prose (e.g.
	 * `'UBC LLM Sandbox'`). Defaults to {@link providerName}.
	 */
	displayName?: string;
	/** API key for the gateway. */
	apiKey: string;
	/**
	 * The gateway's OpenAI-compatible base URL, already normalized by the
	 * subclass (see `normalizeGatewayEndpoint`).
	 */
	baseURL: string;
	logger: LoggerInterface;
	/** Chat model used when a request does not name one. May be absent. */
	defaultModel?: string;
	/** Embedding model used when `embed()` does not name one. May be absent. */
	embeddingModel?: string;
}

/**
 * Returns the first value that is a non-blank string, **unmodified**.
 *
 * Blank-vs-set is the only judgement made here: the value itself is passed
 * through byte for byte, because a model id is an opaque token to this toolkit
 * and trimming or case-folding it would be a rewrite.
 */
function firstConfigured(...values: Array<string | undefined>): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim() !== '') {
			return value;
		}
	}
	return undefined;
}

/**
 * OpenAI-compatible transport for a LiteLLM gateway.
 *
 * Not usable directly — instantiate {@link UbcLlmSandboxProvider} or
 * {@link UbcLlmProxyProvider}, which supply the provider name and model policy.
 *
 * @implements {Provider}
 */
export abstract class LiteLLMGatewayProvider implements Provider {
	protected readonly client: OpenAI;
	protected readonly logger: LoggerInterface;
	protected readonly providerName: string;
	/** Prose name for logs and error messages. */
	protected readonly displayName: string;
	/** Normalized base URL — kept for logging and error context. */
	protected readonly endpoint: string;
	protected readonly defaultModel?: string;
	protected readonly embeddingModel?: string;

	protected constructor(config: LiteLLMGatewayProviderConfig) {
		this.providerName = config.providerName;
		this.displayName = config.displayName ?? config.providerName;
		this.client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseURL,
		});
		this.endpoint = config.baseURL;
		this.defaultModel = config.defaultModel;
		this.embeddingModel = config.embeddingModel;
		this.logger = config.logger;
		this.logger.debug(`${this.displayName} provider initialized`, {
			endpoint: config.baseURL,
			defaultModel: config.defaultModel,
			embeddingModel: config.embeddingModel,
		});
	}

	/**
	 * Gets the unique identifier name for this provider.
	 */
	getName(): string {
		return this.providerName;
	}

	// ---------------------------------------------------------------------
	// Model policy hooks — the only behavior subclasses are expected to change
	// ---------------------------------------------------------------------

	/**
	 * Narrows what `getAvailableModels()` reports.
	 *
	 * The default exposes the gateway's answer verbatim: same ids, same order,
	 * nothing added or removed. Override to enforce an allowlist.
	 */
	protected filterAvailableModels(ids: string[]): string[] {
		return ids;
	}

	/**
	 * Gate for a model id about to be used on a request.
	 *
	 * Called for the configured default *and* for any per-request override, on
	 * both the chat and embedding paths, so a provider cannot be talked into an
	 * off-policy model by passing `options.model`. The default permits anything
	 * the gateway accepts.
	 *
	 * @returns The id to send — implementations must return it unchanged.
	 * @throws {ConfigurationError} When policy rejects the model.
	 */
	protected validateModel(model: string, _purpose: ModelPurpose): string {
		return model;
	}

	/**
	 * Trailing sentence for "no model configured" / "model rejected" errors,
	 * telling the caller where a valid id comes from.
	 */
	protected modelGuidance(_purpose: ModelPurpose): string {
		return 'Call getAvailableModels() to list the models this endpoint accepts.';
	}

	/**
	 * Resolves the chat model for a request: explicit override, else the
	 * configured default. Never falls back to a hardcoded model — a wrong model
	 * silently substituted is worse than a clear error.
	 *
	 * @throws {ConfigurationError} When neither is set, or policy rejects it.
	 */
	protected resolveChatModel(requested?: string): string {
		const model = firstConfigured(requested, this.defaultModel);
		if (!model) {
			throw this.missingModelError('chat');
		}
		return this.validateModel(model, 'chat');
	}

	/**
	 * Resolves the embedding model for a request: explicit override, else the
	 * configured `embeddingModel`.
	 *
	 * @throws {ConfigurationError} When neither is set, or policy rejects it.
	 */
	protected resolveEmbeddingModel(requested?: string): string {
		const model = firstConfigured(requested, this.embeddingModel);
		if (!model) {
			throw this.missingModelError('embedding');
		}
		return this.validateModel(model, 'embedding');
	}

	/** Builds the "you have to tell me which model" configuration error. */
	protected missingModelError(purpose: ModelPurpose): ConfigurationError {
		const configKey = purpose === 'chat' ? 'defaultModel' : 'embeddingModel';
		const optionKey =
			purpose === 'chat'
				? "'model' in the request options"
				: "'model' in the embedding options";
		return new ConfigurationError(
			`No ${purpose} model is configured for the '${this.providerName}' provider. ` +
				`Set '${configKey}' in the LLM config or pass ${optionKey}. ` +
				this.modelGuidance(purpose),
			{ provider: this.providerName, purpose }
		);
	}

	/**
	 * Builds the token / reasoning / temperature slice of a completion request
	 * under the gateway's rules rather than OpenAI's.
	 *
	 * Three gateway-specific adjustments happen here: self-hosted models are
	 * allowed to reason (OpenAI's mapping only recognizes `gpt-5`/o-series),
	 * efforts outside a model's native scale are clamped instead of being
	 * rejected by the gateway, and models that toggle thinking through their chat
	 * template rather than `reasoning_effort` get `chat_template_kwargs` instead.
	 *
	 * @see resolveGatewayReasoning
	 */
	protected buildCompletionFields(
		model: string,
		known: OpenAICompatCompletionKnown,
		rest: Record<string, any>
	) {
		const { reasoningEffort, chatTemplateKwargs } = resolveGatewayReasoning(
			model,
			known.reasoningEffort
		);
		if (reasoningEffort !== known.reasoningEffort) {
			this.logger.debug(`Adjusted reasoning request for ${this.displayName} model`, {
				model,
				requested: known.reasoningEffort,
				sentEffort: reasoningEffort,
				chatTemplateKwargs,
			});
		}

		const fields: Record<string, any> = buildOpenAICompatCompletionFields(
			model,
			{ ...known, reasoningEffort },
			{ reasoningCapability: getGatewayReasoningCapability(model) }
		);

		if (chatTemplateKwargs) {
			// An explicit caller-supplied chat_template_kwargs wins: they may be
			// toggling template flags this mapping knows nothing about.
			fields.chat_template_kwargs = {
				...chatTemplateKwargs,
				...(rest.chat_template_kwargs as Record<string, unknown> | undefined),
			};
		}

		return fields;
	}

	// ---------------------------------------------------------------------
	// Transport
	// ---------------------------------------------------------------------

	/**
	 * Retrieves the model identifiers available through the configured endpoint.
	 *
	 * Queries the gateway's `/models` route. Ids are reported exactly as the
	 * gateway returns them — no suffix is added or removed and no name is
	 * rewritten — after {@link filterAvailableModels} applies provider policy.
	 *
	 * @returns {Promise<string[]>} The available model ids.
	 * @throws {APIError} If the gateway call fails.
	 */
	async getAvailableModels(): Promise<string[]> {
		try {
			this.logger.debug(`Fetching available ${this.displayName} models`, {
				endpoint: this.endpoint,
			});
			const models = await this.client.models.list();
			const ids = models.data.map((model) => model.id);
			const visible = this.filterAvailableModels(ids);
			if (visible.length !== ids.length) {
				this.logger.debug(`Filtered ${this.displayName} model list to provider policy`, {
					returned: ids.length,
					visible: visible.length,
				});
			}
			return visible;
		} catch (error) {
			this.logger.error(`Error fetching ${this.displayName} models`, { error });
			throw this.handleError(error);
		}
	}

	/**
	 * Sends a single user message to the LLM and retrieves the response.
	 *
	 * Convenience wrapper around {@link sendConversation}.
	 *
	 * @param {string} message - The user's message content.
	 * @param {LLMOptions} [options] - Optional parameters (model, temperature, system prompt, …).
	 * @returns {Promise<LLMResponse>} The normalized response.
	 */
	async sendMessage(
		message: string,
		options?: LLMOptions
	): Promise<LLMResponse> {
		const messages: Message[] = [{ role: 'user', content: message }];

		if (options?.systemPrompt) {
			messages.unshift({ role: 'system', content: options.systemPrompt });
		}

		this.logger.debug(
			`Sending single message via sendConversation (${this.displayName})`
		);
		return this.sendConversation(messages, options);
	}

	/**
	 * Sends a multi-turn conversation to the LLM and retrieves the response.
	 *
	 * Maps the toolkit's `Message` format to the OpenAI-compatible format the
	 * gateway expects, including tool calls and images.
	 *
	 * @param {Message[]} messages - The conversation history.
	 * @param {LLMOptions} [options] - Optional parameters (model, temperature, maxTokens, tools, …).
	 * @returns {Promise<LLMResponse>} The normalized response.
	 * @throws {ConfigurationError} If no model is configured, or policy rejects it.
	 * @throws {APIError} If the gateway call fails.
	 */
	async sendConversation(
		messages: Message[],
		options?: LLMOptions
	): Promise<LLMResponse> {
		const { known, rest } = separateOpenAIOptions(options);
		// Resolved before the try so a configuration problem surfaces as a
		// ConfigurationError rather than being wrapped as a transport failure.
		const model = this.resolveChatModel(known.model);

		try {
			// System filtering + tool_call / tool_result mapping live in openai-compat-mapping.
			const openaiMessages = toOpenAIMessages(messages);

			// Handle system prompt if not already in messages
			if (options?.systemPrompt && !messages.some((m) => m.role === 'system')) {
				openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
			}

			const completionFields = this.buildCompletionFields(model, known, rest);
			this.logger.debug(`Sending conversation to ${this.displayName}`, {
				model,
				messageCount: messages.length,
				options,
			});

			const response = await this.client.chat.completions.create({
				...rest,
				...completionFields,
				model,
				messages: openaiMessages,
				// Only set response_format when canonical responseFormat was provided so raw
				// snake_case passthrough (e.g. BiocBot) in `rest` is not overwritten by undefined.
				...(known.responseFormat !== undefined
					? {
							response_format:
								known.responseFormat === 'json'
									? { type: 'json_object' }
									: undefined,
						}
					: {}),
				// Tool calling: translate toolkit definitions into OpenAI function tools.
				tools:
					known.tools && known.tools.length > 0
						? toOpenAITools(known.tools)
						: undefined,
				...(known.toolChoice !== undefined
					? { tool_choice: known.toolChoice }
					: {}),
				stream: false,
			} as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

			return this.normalizeResponse(response);
		} catch (error) {
			this.logger.error(`Error calling ${this.displayName} API`, { error });
			throw this.handleError(error);
		}
	}

	/**
	 * Structured (Zod-validated) completion.
	 *
	 * Not supported by the LiteLLM gateway providers in this version. Callers
	 * needing schema-validated objects can still ask for JSON via
	 * `responseFormat: 'json'` (or a raw `response_format`) and validate it
	 * themselves.
	 */
	async sendStructuredConversation<T>(
		_messages: Message[],
		_schema: ZodType<T>,
		_options?: StructuredOutputOptions
	): Promise<LLMStructuredResponse<T>> {
		throw new APIError(
			`Structured Zod output is not supported by the ${this.displayName} provider in this version.`,
			501,
			{ provider: this.providerName }
		);
	}

	/**
	 * Sends a conversation and streams the response back chunk by chunk.
	 *
	 * Invokes `callback` for each piece of text received. The resolved promise
	 * carries the complete concatenated response; usage statistics are absent
	 * because the LiteLLM streaming response does not carry them.
	 *
	 * @param {Message[]} messages - The conversation history.
	 * @param {(chunk: string) => void} callback - Called with each text chunk.
	 * @param {LLMOptions} [options] - Optional parameters.
	 * @returns {Promise<LLMResponse>} The aggregated response once the stream ends.
	 * @throws {ConfigurationError} If no model is configured, or policy rejects it.
	 * @throws {APIError} If the gateway call fails.
	 */
	async streamConversation(
		messages: Message[],
		callback: (chunk: string) => void,
		options?: LLMOptions
	): Promise<LLMResponse> {
		const { known, rest } = separateOpenAIOptions(options);
		const model = this.resolveChatModel(known.model);

		try {
			// System filtering + tool_call / tool_result mapping live in openai-compat-mapping.
			const openaiMessages = toOpenAIMessages(messages);

			// Handle system prompt if not already in messages
			if (options?.systemPrompt && !messages.some((m) => m.role === 'system')) {
				openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
			}

			const completionFields = this.buildCompletionFields(model, known, rest);
			this.logger.debug(`Streaming conversation from ${this.displayName}`, {
				model,
				messageCount: messages.length,
				options,
			});

			const stream = await this.client.chat.completions.create({
				...rest,
				...completionFields,
				model,
				messages: openaiMessages,
				// Tool calling: translate toolkit definitions into OpenAI function tools.
				tools:
					known.tools && known.tools.length > 0
						? toOpenAITools(known.tools)
						: undefined,
				tool_choice: known.toolChoice,
				stream: true,
			} as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

			let fullContent = '';
			// Tool-call deltas arrive fragmented across chunks, keyed by index;
			// accumulate here and surface complete calls only on the final response.
			const toolCallAcc: Array<{ id?: string; name?: string; args: string }> = [];
			let finishReason: string | null | undefined;

			for await (const chunk of stream) {
				const choice = chunk.choices[0];
				const content = choice?.delta?.content || '';
				if (content) {
					fullContent += content;
					callback(content);
				}
				if (choice?.delta?.tool_calls) {
					for (const deltaCall of choice.delta.tool_calls) {
						const i = deltaCall.index;
						toolCallAcc[i] ??= { args: '' };
						if (deltaCall.id) toolCallAcc[i].id = deltaCall.id;
						if (deltaCall.function?.name) {
							toolCallAcc[i].name =
								(toolCallAcc[i].name ?? '') + deltaCall.function.name;
						}
						if (deltaCall.function?.arguments) {
							toolCallAcc[i].args += deltaCall.function.arguments;
						}
					}
				}
				if (choice?.finish_reason) {
					finishReason = choice.finish_reason;
				}
			}

			const toolCalls =
				toolCallAcc.length > 0
					? fromOpenAIToolCalls({
							tool_calls: toolCallAcc.map((acc, i) => ({
								id: acc.id ?? `call_${i}`,
								type: 'function',
								function: { name: acc.name ?? '', arguments: acc.args || '{}' },
							})),
						})
					: undefined;

			return {
				content: fullContent,
				toolCalls,
				stopReason: mapOpenAIFinishReason(finishReason),
				model: model, // Use the requested model name
				usage: {
					promptTokens: undefined,
					completionTokens: undefined,
					totalTokens: undefined,
				},
				metadata: { provider: this.providerName },
			};
		} catch (error) {
			this.logger.error(`Error streaming from ${this.displayName} API`, { error });
			throw this.handleError(error);
		}
	}

	/**
	 * Generates embeddings for a list of text inputs.
	 *
	 * @param {string[]} texts - Strings to embed.
	 * @param {EmbeddingOptions} [options] - Optional parameters (model, dimensions, …).
	 * @returns {Promise<EmbeddingResponse>} The normalized embedding response.
	 * @throws {ConfigurationError} If no embedding model is configured, or policy rejects it.
	 * @throws {APIError} If the gateway call fails.
	 */
	async embed(
		texts: string[],
		options?: EmbeddingOptions
	): Promise<EmbeddingResponse> {
		const model = this.resolveEmbeddingModel(options?.model);

		try {
			this.logger.debug(`Generating embeddings with ${this.displayName}`, {
				model,
				textCount: texts.length,
				options,
			});

			// Extract provider-specific options (like dimensions)
			const { truncate, ...providerOptions } = options || {}; // truncate might not be used but keep pattern
			delete providerOptions.model; // Don't pass our internal model option directly

			// Use a raw post request to bypass the default 'encoding_format'
			// parameter that client.embeddings.create() automatically adds.
			const response = (await this.client.post('/embeddings', {
				body: {
					model: model,
					input: texts,
					...providerOptions,
				},
				// We need to cast the response to the expected type for the rest of
				// the function to work correctly.
			})) as OpenAI.Embeddings.CreateEmbeddingResponse;

			return this.normalizeEmbeddingResponse(response);
		} catch (error) {
			this.logger.error(`Error calling ${this.displayName} Embeddings API`, {
				error,
			});
			throw this.handleError(error);
		}
	}

	/**
	 * Normalizes an OpenAI-compatible chat completion into {@link LLMResponse}.
	 */
	protected normalizeResponse(
		response: OpenAI.Chat.Completions.ChatCompletion
	): LLMResponse {
		const choice = response.choices[0];
		return {
			content: choice?.message?.content || '',
			toolCalls: fromOpenAIToolCalls(choice?.message),
			stopReason: mapOpenAIFinishReason(choice?.finish_reason),
			// Reported by the gateway, passed through untouched.
			model: response.model,
			usage: {
				promptTokens: response.usage?.prompt_tokens,
				completionTokens: response.usage?.completion_tokens,
				totalTokens: response.usage?.total_tokens,
			},
			metadata: {
				provider: this.providerName,
				// Include relevant OpenAI-compatible fields if needed
				id: response.id,
				created: response.created,
			},
		};
	}

	/**
	 * Normalizes an OpenAI-compatible embeddings response into
	 * {@link EmbeddingResponse}.
	 */
	protected normalizeEmbeddingResponse(
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
				provider: this.providerName,
			},
		};
	}

	/**
	 * Normalizes errors into the toolkit's error types.
	 *
	 * Toolkit errors (including the `ConfigurationError`s raised by model policy)
	 * pass through unchanged. `OpenAI.APIError`s keep their HTTP status and
	 * provider error `code`, so callers can still distinguish an authentication
	 * failure (401) from a quota/rate-limit rejection (429) after normalization.
	 */
	protected handleError(error: any): Error {
		if (error instanceof ToolkitError) {
			return error;
		}
		if (error instanceof OpenAI.APIError) {
			// Use a generic message but include specifics in details
			return new APIError(
				`${this.displayName} API Error: ${error.message}`,
				error.status || 500,
				{
					provider: this.providerName,
					type: error.name,
					code: error.code,
					param: error.param,
					originalError: error,
				}
			);
		}
		// Handle potential network errors or other issues
		if (error instanceof Error) {
			return new APIError(
				`${this.displayName} Provider Error: ${error.message}`,
				500,
				{ provider: this.providerName, originalError: error }
			);
		}
		return new APIError(
			`Unknown error occurred while calling the ${this.displayName} API`,
			500,
			{ provider: this.providerName }
		);
	}
}
