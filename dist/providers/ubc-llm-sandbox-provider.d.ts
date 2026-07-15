import { Provider } from './provider-interface';
import { LLMOptions, LLMResponse, LLMStructuredResponse, Message, StructuredOutputOptions, EmbeddingOptions, EmbeddingResponse } from '../types';
import { LoggerInterface } from 'ubc-genai-toolkit-core';
import type { ZodType } from 'zod';
/**
 * Provides access to Large Language Models (LLMs) via the UBC LLM Sandbox service.
 *
 * This class implements the `Provider` interface, offering methods to interact
 * with LLMs for tasks like generating text responses (chat completions) and
 * creating text embeddings. It specifically targets the UBC LLM Sandbox,
 * which uses a LiteLLM proxy layer presenting an OpenAI-compatible API.
 *
 * Usage typically involves creating an instance with the necessary API key,
 * endpoint URL, a default model name, and a logger. Once instantiated, methods
 * like `sendConversation` or `embed` can be called.
 *
 * @implements {Provider}
 */
export declare class UbcLlmSandboxProvider implements Provider {
    private client;
    private logger;
    private defaultModel;
    private embeddingModel?;
    private endpoint;
    /**
     * Initializes a new instance of the UbcLlmSandboxProvider.
     *
     * Configures the provider to communicate with a specific UBC LLM Sandbox endpoint.
     * Requires an API key for authentication and an endpoint URL. A default model must
     * be specified for chat completions when no model is provided in the options.
     * An optional embedding model can also be specified.
     *
     * @param {string} apiKey - The API key for accessing the UBC LLM Sandbox.
     * @param {string} endpoint - The base URL of the UBC LLM Sandbox API endpoint. This is mandatory.
     * @param {string} defaultModel - The identifier of the default LLM to use for chat completions if not specified in options.
     * @param {LoggerInterface} logger - An instance of a logger conforming to the LoggerInterface for logging messages.
     * @param {object} [options] - Optional configuration settings.
     * @param {string} [options.embeddingModel] - The identifier of the default model to use for embeddings if not specified in options.
     * @throws {APIError} If the endpoint URL is not provided.
     */
    constructor(apiKey: string, endpoint: string, // Endpoint is mandatory for this provider
    defaultModel: string, logger: LoggerInterface, options?: {
        embeddingModel?: string;
    });
    /**
     * Gets the unique identifier name for this provider.
     *
     * @returns {string} The name 'ubc-llm-sandbox'.
     */
    getName(): string;
    /**
     * Retrieves a list of model identifiers available through the configured UBC LLM Sandbox endpoint.
     *
     * This method queries the sandbox's `/models` endpoint (via the OpenAI client)
     * to fetch the list of currently accessible models.
     *
     * @returns {Promise<string[]>} A promise that resolves with an array of available model ID strings.
     * @throws {APIError} If there's an error communicating with the sandbox API or parsing the response.
     */
    getAvailableModels(): Promise<string[]>;
    /**
     * Sends a single user message to the LLM and retrieves the response.
     *
     * This is a convenience method that wraps `sendConversation`. It constructs
     * a simple conversation history containing only the user's message (and an optional
     * system prompt) and sends it to the LLM.
     *
     * @param {string} message - The user's message content.
     * @param {LLMOptions} [options] - Optional parameters for the LLM call (e.g., model, temperature, system prompt).
     * @returns {Promise<LLMResponse>} A promise that resolves with the LLM's response, normalized to the toolkit's format.
     * @throws {APIError} If the underlying API call fails.
     */
    sendMessage(message: string, options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Sends a multi-turn conversation history to the LLM and retrieves the response.
     *
     * This method allows for sending a structured conversation (including system, user,
     * and assistant messages) to the LLM. It handles mapping the toolkit's `Message`
     * format to the OpenAI-compatible format expected by the sandbox endpoint.
     *
     * @param {Message[]} messages - An array of message objects representing the conversation history.
     * @param {LLMOptions} [options] - Optional parameters for the LLM call (e.g., model, temperature, maxTokens, responseFormat, system prompt).
     * @returns {Promise<LLMResponse>} A promise that resolves with the LLM's response, normalized to the toolkit's format.
     * @throws {APIError} If the underlying API call fails.
     */
    sendConversation(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Sends a structured conversation to the LLM and retrieves the response.
     *
     * This method is not supported by the UBC LLM Sandbox provider in this version.
     * @param messages - The messages to send to the UBC LLM Sandbox API
     * @param schema - The schema to use for the structured output
     * @param options - The options for the UBC LLM Sandbox API
     * @returns The response from the UBC LLM Sandbox API
     */
    sendStructuredConversation<T>(_messages: Message[], _schema: ZodType<T>, _options?: StructuredOutputOptions): Promise<LLMStructuredResponse<T>>;
    /**
     * Sends a conversation history to the LLM and streams the response back chunk by chunk.
     *
     * Useful for providing real-time feedback to the user as the LLM generates its response.
     * It invokes the provided callback function for each piece of text received from the stream.
     * The final resolved promise contains the complete concatenated response and metadata,
     * although usage statistics might be incomplete due to limitations in the streaming API
     * provided by the underlying LiteLLM proxy.
     *
     * @param {Message[]} messages - An array of message objects representing the conversation history.
     * @param {(chunk: string) => void} callback - A function that will be called with each chunk of text received from the stream.
     * @param {LLMOptions} [options] - Optional parameters for the LLM call (e.g., model, temperature, maxTokens, system prompt).
     * @returns {Promise<LLMResponse>} A promise that resolves with the final aggregated response object once the stream is complete. Usage data may be incomplete.
     * @throws {APIError} If the underlying API call fails or an error occurs during streaming.
     */
    streamConversation(messages: Message[], callback: (chunk: string) => void, options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Generates embeddings for a list of text inputs using a specified or default embedding model.
     *
     * Embeddings are numerical vector representations of text, useful for tasks like
     * semantic search, clustering, and similarity comparisons. This method sends the
     * input texts to the sandbox's embedding endpoint.
     *
     * @param {string[]} texts - An array of strings for which to generate embeddings.
     * @param {EmbeddingOptions} [options] - Optional parameters for the embedding call (e.g., model, dimensions).
     * @returns {Promise<EmbeddingResponse>} A promise that resolves with the generated embeddings and metadata, normalized to the toolkit's format.
     * @throws {APIError} If the underlying API call fails.
     */
    embed(texts: string[], options?: EmbeddingOptions): Promise<EmbeddingResponse>;
    /**
     * Normalizes the response from an OpenAI-compatible chat completion API call
     * into the toolkit's standard `LLMResponse` format.
     *
     * This ensures consistency across different providers. It extracts the main content,
     * model identifier, usage statistics, and adds provider-specific metadata.
     *
     * @param {OpenAI.Chat.Completions.ChatCompletion} response - The raw response object from the OpenAI client.
     * @returns {LLMResponse} The normalized response object.
     * @private
     */
    private normalizeResponse;
    /**
     * Normalizes the response from an OpenAI-compatible embeddings API call
     * into the toolkit's standard `EmbeddingResponse` format.
     *
     * Extracts the embedding vectors, model identifier, and usage statistics,
     * presenting them in a consistent structure.
     *
     * @param {OpenAI.Embeddings.CreateEmbeddingResponse} response - The raw response object from the OpenAI client's embedding creation method.
     * @returns {EmbeddingResponse} The normalized embedding response object.
     * @private
     */
    private normalizeEmbeddingResponse;
    /**
     * Handles errors that occur during API interactions, attempting to normalize them
     * into the toolkit's standard `APIError` format.
     *
     * It specifically checks for `OpenAI.APIError` instances to extract more detailed
     * information like status code and error type. Other errors are wrapped in a
     * generic `APIError`.
     *
     * @param {any} error - The error object caught during an API call.
     * @returns {APIError} A normalized `APIError` object.
     * @private
     */
    private handleError;
}
//# sourceMappingURL=ubc-llm-sandbox-provider.d.ts.map