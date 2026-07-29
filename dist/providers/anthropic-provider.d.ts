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
import { LLMOptions, LLMResponse, LLMStructuredResponse, Message, StructuredOutputOptions, EmbeddingOptions, EmbeddingResponse } from '../types';
import { LoggerInterface } from 'ubc-genai-toolkit-core';
import type { ZodType } from 'zod';
export declare class AnthropicProvider implements Provider {
    private client;
    private logger;
    private defaultModel;
    /**
     * Initializes a new instance of the AnthropicProvider
     * @param apiKey - Anthropic API key.
     * @param defaultModel - Used when `options.model` is omitted.
     * @param logger - Toolkit logger for diagnostics.
     */
    constructor(apiKey: string, defaultModel: string, logger: LoggerInterface);
    /**
     * Gets the name of the provider.
     * @returns The string 'anthropic'.
     */
    getName(): string;
    /**
     * Fetches the list of available model IDs from the Anthropic API.
     * Handles pagination automatically.
     * @returns A promise resolving to an array of model ID strings.
     */
    getAvailableModels(): Promise<string[]>;
    /**
     * Sends a single user message to the LLM and gets a response.
     * This is a convenience method that delegates to `sendConversation`.
     * @param message - The user message content.
     * @param options - Optional LLM parameters.
     * @returns A promise resolving to the LLMResponse.
     */
    sendMessage(message: string, options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Non-streaming Messages API call. `options.systemPrompt` becomes the `system` parameter; any
     * `system` entries inside `messages` are filtered out of `messages` because Anthropic expects
     * system text only at the top level.
     * @param messages - The messages to send to the Anthropic API
     * @param options - The options for the Anthropic API
     * @returns The response from the Anthropic API
     */
    sendConversation(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
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
    sendStructuredConversation<T>(messages: Message[], schema: ZodType<T>, options?: StructuredOutputOptions): Promise<LLMStructuredResponse<T>>;
    /**
     * Streams assistant text: listens for `content_block_delta` with `text_delta` only. Token usage
     * on the returned {@link LLMResponse} is left undefined (full usage is available on stream
     * end events; this provider keeps the implementation small).
     */
    streamConversation(messages: Message[], callback: (chunk: string) => void, options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Anthropic does not expose embeddings on this code path.
     *
     * @throws {APIError} Always — HTTP 501 Not Implemented.
     */
    embed(texts: string[], options?: EmbeddingOptions): Promise<EmbeddingResponse>;
    /**
     * Normalizes the response object from the Anthropic API (`Anthropic.Message`)
     * into the toolkit's standard `LLMResponse` format.
     * @param response - The response object from `client.messages.create`.
     * @returns An LLMResponse object.
     */
    private normalizeResponse;
    /**
     * Handles errors thrown by the Anthropic SDK or other issues during API interaction.
     * Wraps errors in the toolkit's standard `APIError`.
     * @param error - The error object caught.
     * @returns An instance of `APIError`.
     */
    private handleError;
}
//# sourceMappingURL=anthropic-provider.d.ts.map