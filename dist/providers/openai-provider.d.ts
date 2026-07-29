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
import type { ZodType } from 'zod';
import { Provider } from './provider-interface';
import { LLMOptions, LLMResponse, LLMStructuredResponse, Message, StructuredOutputOptions, EmbeddingOptions, EmbeddingResponse } from '../types';
import { LoggerInterface } from 'ubc-genai-toolkit-core';
export declare class OpenAIProvider implements Provider {
    private client;
    private logger;
    private defaultModel;
    private embeddingModel?;
    /**
     * @param apiKey - OpenAI API key (or compatible proxy key).
     * @param defaultModel - Used when `options.model` is omitted.
     * @param logger - Toolkit logger for diagnostics.
     * @param options.endpoint - Optional base URL override (Azure OpenAI, proxies, etc.).
     * @param options.embeddingModel - Default embedding model when `embed` omits `options.model`.
     */
    constructor(apiKey: string, defaultModel: string, logger: LoggerInterface, options?: {
        endpoint?: string;
        embeddingModel?: string;
    });
    /**
     * Get the name of the provider
     * @returns The name of the provider
     */
    getName(): string;
    /**
     * Get the available models for the OpenAI API
     * @returns The available models for the OpenAI API
     */
    getAvailableModels(): Promise<string[]>;
    /**
     * Single-turn helper: builds `[{ role: 'user', ... }]` (plus optional system from `options`)
     * and delegates to {@link sendConversation}.
     */
    sendMessage(message: string, options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Send a conversation to the OpenAI API
     * @param messages - The messages to send to the OpenAI API
     * @param options - The options for the OpenAI API
     * @returns The response from the OpenAI API
     */
    sendConversation(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Send a structured conversation to the OpenAI API
     * @param messages - The messages to send to the OpenAI API
     * @param schema - The schema to use for the structured output
     * @param options - The options for the OpenAI API
     * @returns The response from the OpenAI API
     *
     */
    sendStructuredConversation<T>(messages: Message[], schema: ZodType<T>, options?: StructuredOutputOptions): Promise<LLMStructuredResponse<T>>;
    /**
     * Token streaming: invokes `callback` for each text delta; returned {@link LLMResponse} holds
     * the full concatenated string. Usage fields are not filled for this path.
     * @param messages - The messages to send to the OpenAI API
     * @param callback - The callback to use for the OpenAI API
     * @param options - The options for the OpenAI API
     * @returns The response from the OpenAI API
     */
    streamConversation(messages: Message[], callback: (chunk: string) => void, options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Text embeddings for one or more input strings. Extra fields on `EmbeddingOptions` (e.g.
     * `dimensions` for some models) are forwarded except `truncate`, which is not an OpenAI
     * embeddings API field and is stripped here.
     * @param texts - The texts to embed
     * @param options - The options for the OpenAI API
     * @returns The response from the OpenAI API
     */
    embed(texts: string[], options?: EmbeddingOptions): Promise<EmbeddingResponse>;
    /**
     * Normalize the response from the OpenAI API
     * @param response - The response from the OpenAI API
     * @returns The normalized response
     */
    private normalizeResponse;
    /** Maps OpenAI embeddings response to {@link EmbeddingResponse}. */
    private normalizeEmbeddingResponse;
    /** Wraps `OpenAI.APIError` in {@link APIError}; everything else becomes a generic message. */
    private handleError;
}
//# sourceMappingURL=openai-provider.d.ts.map