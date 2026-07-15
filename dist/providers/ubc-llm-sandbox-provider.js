"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UbcLlmSandboxProvider = void 0;
/**
 * @fileoverview Implements the Provider interface for the UBC LLM Sandbox service.
 *
 * The UBC LLM Sandbox provides access to various large language models hosted
 * within UBC's infrastructure. This provider acts as a facade, interacting
 * with the underlying service (which uses a LiteLLM proxy compatible with the
 * OpenAI API) to offer a standardized way for applications to use these models
 * for chat completions and embeddings.
 *
 * Key Features:
 * - Connects to a specified UBC LLM Sandbox endpoint.
 * - Uses an API key for authentication.
 * - Supports standard chat completion (`sendMessage`, `sendConversation`).
 * - Supports streaming chat completion (`streamConversation`).
 * - Supports text embedding generation (`embed`).
 * - Maps UBC LLM Sandbox API responses and errors to the toolkit's standard interfaces.
 * - Requires an explicit endpoint URL during instantiation, unlike some other providers.
 * - Does not support structured output (Coming soon)
 *
 * @see {Provider} Interface definition for LLM providers.
 * @see {@link https://developer.ubc.ca/sandbox/llm} For more information about the UBC LLM Sandbox.
 */
const openai_1 = __importDefault(require("openai"));
const ubc_genai_toolkit_core_1 = require("ubc-genai-toolkit-core");
const openai_compat_mapping_1 = require("./openai-compat-mapping");
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
class UbcLlmSandboxProvider {
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
    constructor(apiKey, endpoint, // Endpoint is mandatory for this provider
    defaultModel, logger, options) {
        if (!endpoint) {
            throw new ubc_genai_toolkit_core_1.APIError('Endpoint is required for UBC LLM Sandbox provider', 400);
        }
        this.client = new openai_1.default({
            apiKey,
            baseURL: endpoint, // Use the provided endpoint
        });
        this.endpoint = endpoint;
        this.defaultModel = defaultModel;
        this.embeddingModel = options?.embeddingModel;
        this.logger = logger;
        this.logger.debug('UbcLlmSandboxProvider initialized', {
            endpoint,
            defaultModel,
            embeddingModel: this.embeddingModel,
        });
    }
    /**
     * Gets the unique identifier name for this provider.
     *
     * @returns {string} The name 'ubc-llm-sandbox'.
     */
    getName() {
        return 'ubc-llm-sandbox';
    }
    /**
     * Retrieves a list of model identifiers available through the configured UBC LLM Sandbox endpoint.
     *
     * This method queries the sandbox's `/models` endpoint (via the OpenAI client)
     * to fetch the list of currently accessible models.
     *
     * @returns {Promise<string[]>} A promise that resolves with an array of available model ID strings.
     * @throws {APIError} If there's an error communicating with the sandbox API or parsing the response.
     */
    async getAvailableModels() {
        try {
            this.logger.debug('Fetching available UBC LLM Sandbox models', { endpoint: this.endpoint });
            const models = await this.client.models.list();
            return models.data.map((model) => model.id);
        }
        catch (error) {
            this.logger.error('Error fetching UBC LLM Sandbox models', { error });
            throw this.handleError(error);
        }
    }
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
    async sendMessage(message, options) {
        const messages = [{ role: 'user', content: message }];
        if (options?.systemPrompt) {
            messages.unshift({ role: 'system', content: options.systemPrompt });
        }
        this.logger.debug('Sending single message via sendConversation (UBC LLM Sandbox)');
        return this.sendConversation(messages, options);
    }
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
    async sendConversation(messages, options) {
        const model = options?.model || this.defaultModel;
        this.logger.debug('Sending conversation to UBC LLM Sandbox', { model, messageCount: messages.length, options });
        try {
            // System filtering + tool_call / tool_result mapping live in openai-compat-mapping.
            const openaiMessages = (0, openai_compat_mapping_1.toOpenAIMessages)(messages);
            // Handle system prompt if not already in messages
            if (options?.systemPrompt && !messages.some(m => m.role === 'system')) {
                openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
            }
            const { rest } = (0, openai_compat_mapping_1.separateOpenAIOptions)(options);
            const response = await this.client.chat.completions.create({
                model,
                messages: openaiMessages,
                temperature: options?.temperature,
                max_tokens: options?.maxTokens,
                response_format: options?.responseFormat === 'json'
                    ? { type: 'json_object' }
                    : undefined,
                // Tool calling: translate toolkit definitions into OpenAI function tools.
                tools: options?.tools && options.tools.length > 0
                    ? (0, openai_compat_mapping_1.toOpenAITools)(options.tools)
                    : undefined,
                tool_choice: options?.toolChoice,
                stream: false,
                ...rest,
            });
            return this.normalizeResponse(response);
        }
        catch (error) {
            this.logger.error('Error calling UBC LLM Sandbox API', { error });
            throw this.handleError(error);
        }
    }
    /**
     * Sends a structured conversation to the LLM and retrieves the response.
     *
     * This method is not supported by the UBC LLM Sandbox provider in this version.
     * @param messages - The messages to send to the UBC LLM Sandbox API
     * @param schema - The schema to use for the structured output
     * @param options - The options for the UBC LLM Sandbox API
     * @returns The response from the UBC LLM Sandbox API
     */
    async sendStructuredConversation(_messages, _schema, _options) {
        throw new ubc_genai_toolkit_core_1.APIError('Structured Zod output is not supported by the UBC LLM Sandbox provider in this version.', 501, { provider: 'ubc-llm-sandbox' });
    }
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
    async streamConversation(messages, callback, options) {
        const model = options?.model || this.defaultModel;
        this.logger.debug('Streaming conversation from UBC LLM Sandbox', { model, messageCount: messages.length, options });
        try {
            // System filtering + tool_call / tool_result mapping live in openai-compat-mapping.
            const openaiMessages = (0, openai_compat_mapping_1.toOpenAIMessages)(messages);
            // Handle system prompt if not already in messages
            if (options?.systemPrompt && !messages.some(m => m.role === 'system')) {
                openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
            }
            const { rest } = (0, openai_compat_mapping_1.separateOpenAIOptions)(options);
            const stream = await this.client.chat.completions.create({
                model,
                messages: openaiMessages,
                temperature: options?.temperature,
                max_tokens: options?.maxTokens,
                // Tool calling: translate toolkit definitions into OpenAI function tools.
                tools: options?.tools && options.tools.length > 0
                    ? (0, openai_compat_mapping_1.toOpenAITools)(options.tools)
                    : undefined,
                tool_choice: options?.toolChoice,
                stream: true,
                ...rest,
            });
            let fullContent = '';
            // Tool-call deltas arrive fragmented across chunks, keyed by index;
            // accumulate here and surface complete calls only on the final response.
            const toolCallAcc = [];
            let finishReason;
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
                        toolCallAcc[i] ?? (toolCallAcc[i] = { args: '' });
                        if (deltaCall.id)
                            toolCallAcc[i].id = deltaCall.id;
                        if (deltaCall.function?.name) {
                            toolCallAcc[i].name = (toolCallAcc[i].name ?? '') + deltaCall.function.name;
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
            const toolCalls = toolCallAcc.length > 0
                ? (0, openai_compat_mapping_1.fromOpenAIToolCalls)({
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
                stopReason: (0, openai_compat_mapping_1.mapOpenAIFinishReason)(finishReason),
                model: model, // Use the requested model name
                usage: {
                    promptTokens: undefined,
                    completionTokens: undefined,
                    totalTokens: undefined,
                },
                metadata: { provider: 'ubc-llm-sandbox' },
            };
        }
        catch (error) {
            this.logger.error('Error streaming from UBC LLM Sandbox API', { error });
            throw this.handleError(error);
        }
    }
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
    async embed(texts, options) {
        try {
            const model = options?.model || this.embeddingModel || 'nomic-embed-text'; // Default to nomic
            this.logger.debug('Generating embeddings with UBC LLM Sandbox', {
                model,
                textCount: texts.length,
                options,
            });
            // Extract provider-specific options (like dimensions)
            const { truncate, ...providerOptions } = options || {}; // truncate might not be used but keep pattern
            delete providerOptions.model; // Don't pass our internal model option directly
            // Use a raw post request to bypass the default 'encoding_format'
            // parameter that client.embeddings.create() automatically adds.
            const response = await this.client.post('/embeddings', {
                body: {
                    model: model,
                    input: texts,
                    ...providerOptions,
                },
                // We need to cast the response to the expected type for the rest of
                // the function to work correctly.
            });
            return this.normalizeEmbeddingResponse(response);
        }
        catch (error) {
            this.logger.error('Error calling UBC LLM Sandbox Embeddings API', {
                error,
            });
            throw this.handleError(error);
        }
    }
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
    normalizeResponse(response) {
        const choice = response.choices[0];
        return {
            content: choice?.message?.content || '',
            toolCalls: (0, openai_compat_mapping_1.fromOpenAIToolCalls)(choice?.message),
            stopReason: (0, openai_compat_mapping_1.mapOpenAIFinishReason)(choice?.finish_reason),
            model: response.model,
            usage: {
                promptTokens: response.usage?.prompt_tokens,
                completionTokens: response.usage?.completion_tokens,
                totalTokens: response.usage?.total_tokens,
            },
            metadata: {
                provider: 'ubc-llm-sandbox',
                // Include relevant OpenAI-compatible fields if needed
                id: response.id,
                created: response.created,
            },
        };
    }
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
    normalizeEmbeddingResponse(response) {
        return {
            embeddings: response.data.map((item) => item.embedding),
            model: response.model,
            usage: {
                promptTokens: response.usage?.prompt_tokens,
                totalTokens: response.usage?.total_tokens,
            },
            metadata: {
                provider: 'ubc-llm-sandbox',
            },
        };
    }
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
    handleError(error) {
        if (error instanceof openai_1.default.APIError) {
            // Use a generic message but include specifics in details
            return new ubc_genai_toolkit_core_1.APIError(`UBC LLM Sandbox API Error: ${error.message}`, error.status || 500, {
                provider: 'ubc-llm-sandbox',
                type: error.name,
                code: error.code,
                param: error.param,
                originalError: error
            });
        }
        // Handle potential network errors or other issues
        if (error instanceof Error) {
            return new ubc_genai_toolkit_core_1.APIError(`UBC LLM Sandbox Provider Error: ${error.message}`, 500, { provider: 'ubc-llm-sandbox', originalError: error });
        }
        return new ubc_genai_toolkit_core_1.APIError('Unknown error occurred while calling UBC LLM Sandbox API', 500, { provider: 'ubc-llm-sandbox' });
    }
}
exports.UbcLlmSandboxProvider = UbcLlmSandboxProvider;
//# sourceMappingURL=ubc-llm-sandbox-provider.js.map