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
import { LLMOptions, LLMResponse, LLMStructuredResponse, Message, StructuredOutputOptions, EmbeddingOptions, EmbeddingResponse } from '../types';
import { LoggerInterface, ConfigurationError } from 'ubc-genai-toolkit-core';
import type { ZodType } from 'zod';
import { OpenAICompatCompletionKnown } from './openai-compat-mapping';
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
 * OpenAI-compatible transport for a LiteLLM gateway.
 *
 * Not usable directly — instantiate {@link UbcLlmSandboxProvider} or
 * {@link UbcLlmProxyProvider}, which supply the provider name and model policy.
 *
 * @implements {Provider}
 */
export declare abstract class LiteLLMGatewayProvider implements Provider {
    protected readonly client: OpenAI;
    protected readonly logger: LoggerInterface;
    protected readonly providerName: string;
    /** Prose name for logs and error messages. */
    protected readonly displayName: string;
    /** Normalized base URL — kept for logging and error context. */
    protected readonly endpoint: string;
    protected readonly defaultModel?: string;
    protected readonly embeddingModel?: string;
    protected constructor(config: LiteLLMGatewayProviderConfig);
    /**
     * Gets the unique identifier name for this provider.
     */
    getName(): string;
    /**
     * Narrows what `getAvailableModels()` reports.
     *
     * The default exposes the gateway's answer verbatim: same ids, same order,
     * nothing added or removed. Override to enforce an allowlist.
     */
    protected filterAvailableModels(ids: string[]): string[];
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
    protected validateModel(model: string, _purpose: ModelPurpose): string;
    /**
     * Trailing sentence for "no model configured" / "model rejected" errors,
     * telling the caller where a valid id comes from.
     */
    protected modelGuidance(_purpose: ModelPurpose): string;
    /**
     * Resolves the chat model for a request: explicit override, else the
     * configured default. Never falls back to a hardcoded model — a wrong model
     * silently substituted is worse than a clear error.
     *
     * @throws {ConfigurationError} When neither is set, or policy rejects it.
     */
    protected resolveChatModel(requested?: string): string;
    /**
     * Resolves the embedding model for a request: explicit override, else the
     * configured `embeddingModel`.
     *
     * @throws {ConfigurationError} When neither is set, or policy rejects it.
     */
    protected resolveEmbeddingModel(requested?: string): string;
    /** Builds the "you have to tell me which model" configuration error. */
    protected missingModelError(purpose: ModelPurpose): ConfigurationError;
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
    protected buildCompletionFields(model: string, known: OpenAICompatCompletionKnown, rest: Record<string, any>): Record<string, any>;
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
    getAvailableModels(): Promise<string[]>;
    /**
     * Sends a single user message to the LLM and retrieves the response.
     *
     * Convenience wrapper around {@link sendConversation}.
     *
     * @param {string} message - The user's message content.
     * @param {LLMOptions} [options] - Optional parameters (model, temperature, system prompt, …).
     * @returns {Promise<LLMResponse>} The normalized response.
     */
    sendMessage(message: string, options?: LLMOptions): Promise<LLMResponse>;
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
    sendConversation(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Structured (Zod-validated) completion.
     *
     * Not supported by the LiteLLM gateway providers in this version. Callers
     * needing schema-validated objects can still ask for JSON via
     * `responseFormat: 'json'` (or a raw `response_format`) and validate it
     * themselves.
     */
    sendStructuredConversation<T>(_messages: Message[], _schema: ZodType<T>, _options?: StructuredOutputOptions): Promise<LLMStructuredResponse<T>>;
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
    streamConversation(messages: Message[], callback: (chunk: string) => void, options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Generates embeddings for a list of text inputs.
     *
     * @param {string[]} texts - Strings to embed.
     * @param {EmbeddingOptions} [options] - Optional parameters (model, dimensions, …).
     * @returns {Promise<EmbeddingResponse>} The normalized embedding response.
     * @throws {ConfigurationError} If no embedding model is configured, or policy rejects it.
     * @throws {APIError} If the gateway call fails.
     */
    embed(texts: string[], options?: EmbeddingOptions): Promise<EmbeddingResponse>;
    /**
     * Normalizes an OpenAI-compatible chat completion into {@link LLMResponse}.
     */
    protected normalizeResponse(response: OpenAI.Chat.Completions.ChatCompletion): LLMResponse;
    /**
     * Normalizes an OpenAI-compatible embeddings response into
     * {@link EmbeddingResponse}.
     */
    protected normalizeEmbeddingResponse(response: OpenAI.Embeddings.CreateEmbeddingResponse): EmbeddingResponse;
    /**
     * Normalizes errors into the toolkit's error types.
     *
     * Toolkit errors (including the `ConfigurationError`s raised by model policy)
     * pass through unchanged. `OpenAI.APIError`s keep their HTTP status and
     * provider error `code`, so callers can still distinguish an authentication
     * failure (401) from a quota/rate-limit rejection (429) after normalization.
     */
    protected handleError(error: any): Error;
}
//# sourceMappingURL=litellm-gateway-provider.d.ts.map