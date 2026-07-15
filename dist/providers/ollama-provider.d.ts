/**
 * @fileoverview Ollama (local or remote) implementation of {@link Provider}.
 *
 * ## Responsibilities
 *
 * - **Chat**: Uses the official `ollama` npm client against `host` (your `LLM_ENDPOINT`).
 * - **Structured output**: Converts Zod → JSON Schema (`zod-to-json-schema`), passes it as `format`,
 *   then `JSON.parse` on the full assistant message string and validates with `schema.safeParse`.
 *   Ollama must support schema `format` for your model; the entire `message.content` must be valid JSON.
 * - **JSON mode**: When `responseFormat === 'json'`, `format: 'json'` is set (no schema).
 * - **Embeddings**: `embed` calls `client.embed`.
 *
 * ## Options mapping
 *
 * - Toolkit `maxTokens` → Ollama generate option `num_predict` (max tokens to predict).
 * - Toolkit `temperature` → Ollama `options.temperature`.
 * - Other keys on `LLMOptions` may pass through via `rest` into `options` (e.g. `num_ctx` for context).
 * - `structuredOutputName` is stripped in {@link separateOptions} so it is never sent to Ollama.
 *
 * @see {@link Provider} for the shared interface.
 */
import { Provider } from './provider-interface';
import { LLMOptions, LLMResponse, LLMStructuredResponse, Message, StructuredOutputOptions, EmbeddingOptions, EmbeddingResponse } from '../types';
import { LoggerInterface } from 'ubc-genai-toolkit-core';
import type { ZodType } from 'zod';
export declare class OllamaProvider implements Provider {
    private client;
    private logger;
    private defaultModel;
    private embeddingModel?;
    private endpoint;
    /**
     * @param endpoint - Ollama server URL, e.g. `http://127.0.0.1:11434`.
     * @param defaultModel - Used when `options.model` is omitted.
     * @param logger - Toolkit logger for diagnostics.
     * @param options.embeddingModel - Default for `embed` when `options.model` is omitted.
     */
    constructor(endpoint: string, defaultModel: string, logger: LoggerInterface, options?: {
        embeddingModel?: string;
    });
    /**
     * Get the name of the provider
     * @returns The name of the provider
     */
    getName(): string;
    /** Returns model names from `GET /api/tags` (via SDK `list()`). */
    getAvailableModels(): Promise<string[]>;
    /**
     * Send a single message to the Ollama API
     * @param message - The message to send to the Ollama API
     * @param options - The options for the Ollama API
     * @returns The response from the Ollama API
     */
    sendMessage(message: string, options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Non-streaming chat. Merges `ollamaSpecific` + `rest` into the `options` field of the chat
     * request. Sets `format: 'json'` only when `responseFormat === 'json'`.
     *
     * @param messages - The messages to send to the Ollama API
     * @param options - The options for the Ollama API
     * @returns The response from the Ollama API
     */
    sendConversation(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Sends `format` as a JSON Schema derived from `schema`, then parses and validates the model
     * output with Zod. Requires a server/model that honors JSON Schema in `format`.
     *
     * `schema as never` avoids a TypeScript depth issue with `zodToJsonSchema` generics; the cast
     * on the result narrows to a plain object for Ollama.
     * @param messages - The messages to send to the Ollama API
     * @param schema - The schema to use for the structured output
     * @param options - The options for the Ollama API
     * @returns The response from the Ollama API
     */
    sendStructuredConversation<T>(messages: Message[], schema: ZodType<T>, options?: StructuredOutputOptions): Promise<LLMStructuredResponse<T>>;
    /**
     * Streams message content; when the stream reports `done`, copies timing / eval counts into
     * {@link LLMResponse.metadata} and maps eval counts into `usage` for rough token-like metrics.
     * @param messages - The messages to send to the Ollama API
     * @param callback - The callback to use for the Ollama API
     * @param options - The options for the Ollama API
     * @returns The response from the Ollama API
     */
    streamConversation(messages: Message[], callback: (chunk: string) => void, options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Generate embeddings for a list of text strings using the Ollama API
     * @param texts - The texts to embed
     * @param options - The options for the Ollama API
     * @returns The response from the Ollama API
     */
    embed(texts: string[], options?: EmbeddingOptions): Promise<EmbeddingResponse>;
    /** Normalizes Ollama HTTP errors and generic `Error` into {@link APIError}. */
    private handleError;
    /**
     * Normalizes the response from the Ollama API into the toolkit's standard `LLMResponse` format.
     * @param response - The response object from the Ollama API.
     * @param model - The model that generated the response.
     * @returns An `LLMResponse` object.
     */
    private normalizeResponse;
}
//# sourceMappingURL=ollama-provider.d.ts.map