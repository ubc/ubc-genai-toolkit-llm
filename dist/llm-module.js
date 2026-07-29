"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMModule = void 0;
const ubc_genai_toolkit_core_1 = require("ubc-genai-toolkit-core");
const openai_provider_1 = require("./providers/openai-provider");
const ollama_provider_1 = require("./providers/ollama-provider");
const anthropic_provider_1 = require("./providers/anthropic-provider");
const ubc_llm_sandbox_provider_1 = require("./providers/ubc-llm-sandbox-provider");
const conversation_1 = require("./conversation");
/**
 * Default LLM configuration
 */
const DEFAULT_LLM_CONFIG = {
// defaultModel removed - should be configured per provider instance
};
/**
 * Main LLM Module facade
 *
 */
class LLMModule {
    /**
     * Create a new LLM module instance
     *
     * @param config - The configuration for the LLM module
     */
    constructor(config) {
        this.config = (0, ubc_genai_toolkit_core_1.mergeWithDefaults)(config, DEFAULT_LLM_CONFIG);
        this.logger = this.config.logger;
        this.provider = this.initializeProvider();
    }
    /**
     * Send a single message to the LLM
     *
     * @param message - The message to send to the LLM
     * @param options - The options for the LLM
     * @returns The response from the LLM
     */
    async sendMessage(message, options) {
        this.logger.debug('Sending message to LLM', {
            provider: this.config.provider,
            model: options?.model || this.config.defaultModel,
        });
        const mergedOptions = this.mergeOptions(options);
        return this.provider.sendMessage(message, mergedOptions);
    }
    /**
     * Send a conversation to the LLM
     *
     * @param messages - The messages to send to the LLM
     * @param options - The options for the LLM
     * @returns The response from the LLM
     */
    async sendConversation(messages, options) {
        this.logger.debug('Sending conversation to LLM', {
            provider: this.config.provider,
            model: options?.model || this.config.defaultModel,
            messageCount: messages.length,
        });
        const mergedOptions = this.mergeOptions(options);
        return this.provider.sendConversation(messages, mergedOptions);
    }
    /**
     * Non-streaming structured completion: provider validates output against the given Zod schema.
     * Requires a model that supports structured JSON (provider-specific).
     */
    async sendStructuredConversation(messages, schema, options) {
        this.logger.debug('Sending structured conversation to LLM', {
            provider: this.config.provider,
            model: options?.model || this.config.defaultModel,
            messageCount: messages.length,
        });
        const mergedOptions = this.mergeStructuredOptions(options);
        return this.provider.sendStructuredConversation(messages, schema, mergedOptions);
    }
    /**
     * Stream a conversation to the LLM
     * @param messages - The messages to send to the LLM
     * @param callback - The callback to use for the LLM
     * @param options - The options for the LLM
     * @returns The response from the LLM
     */
    async streamConversation(messages, callback, options) {
        this.logger.debug('Streaming conversation to LLM', {
            provider: this.config.provider,
            model: options?.model || this.config.defaultModel,
            messageCount: messages.length,
        });
        // Merge the options with the stream option
        const mergedOptions = this.mergeOptions(options, { stream: true });
        // Use the provider to stream the conversation
        return this.provider.streamConversation(messages, callback, mergedOptions);
    }
    /**
     * Generate embeddings for a list of text strings.
     *
     * This method delegates to the configured provider's embed method.
     * Throws an error if the provider does not support embeddings.
     *
     * @param texts - An array of strings to embed.
     * @param options - Optional configuration for the embedding request (e.g., model).
     * @returns A promise resolving to the EmbeddingResponse.
     */
    async embed(texts, options) {
        this.logger.debug('Generating embeddings', {
            provider: this.config.provider,
            model: options?.model || this.config.embeddingModel,
            textCount: texts.length,
        });
        if (!this.provider.embed) {
            throw new ubc_genai_toolkit_core_1.APIError(`The configured provider '${this.config.provider}' does not support the embed operation.`, 501 // Not Implemented
            );
        }
        // Options merging is handled within provider implementations for now
        // Pass options directly
        return this.provider.embed(texts, options);
    }
    /**
     * Create a new conversation
     */
    createConversation() {
        return new conversation_1.ConversationImpl(this);
    }
    /**
     * Get the available models for the current provider
     */
    async getAvailableModels() {
        return this.provider.getAvailableModels();
    }
    /**
     * Get the current provider name
     */
    getProviderName() {
        return this.provider.getName();
    }
    /**
     * Initialize the provider based on configuration
     *
     * @returns The provider
     */
    initializeProvider() {
        const { provider, apiKey, endpoint, defaultModel, embeddingModel, logger, } = this.config;
        // Ensure logger is defined for providers
        if (!logger) {
            throw new ubc_genai_toolkit_core_1.ConfigurationError('Logger is required but was not provided in config');
        }
        switch (provider) {
            case 'openai':
                if (!apiKey) {
                    throw new ubc_genai_toolkit_core_1.ConfigurationError('API key is required for OpenAI provider');
                }
                if (!defaultModel) {
                    throw new ubc_genai_toolkit_core_1.ConfigurationError('defaultModel is required for OpenAI provider');
                }
                return new openai_provider_1.OpenAIProvider(apiKey, defaultModel, logger, {
                    endpoint,
                    embeddingModel,
                });
            case 'anthropic':
                if (!apiKey) {
                    throw new ubc_genai_toolkit_core_1.ConfigurationError('API key is required for Anthropic provider');
                }
                if (!defaultModel) {
                    throw new ubc_genai_toolkit_core_1.ConfigurationError('defaultModel is required for Anthropic provider');
                }
                return new anthropic_provider_1.AnthropicProvider(apiKey, defaultModel, logger);
            case 'ollama':
                if (!endpoint) {
                    throw new ubc_genai_toolkit_core_1.ConfigurationError('endpoint is required for Ollama provider');
                }
                if (!defaultModel) {
                    throw new ubc_genai_toolkit_core_1.ConfigurationError('defaultModel is required for Ollama provider');
                }
                return new ollama_provider_1.OllamaProvider(endpoint, defaultModel, logger, {
                    embeddingModel,
                });
            case 'ubc-llm-sandbox':
                if (!apiKey) {
                    throw new ubc_genai_toolkit_core_1.ConfigurationError('apiKey is required for UBC LLM Sandbox provider');
                }
                if (!endpoint) {
                    throw new ubc_genai_toolkit_core_1.ConfigurationError('endpoint is required for UBC LLM Sandbox provider');
                }
                if (!defaultModel) {
                    throw new ubc_genai_toolkit_core_1.ConfigurationError('defaultModel is required for UBC LLM Sandbox provider');
                }
                return new ubc_llm_sandbox_provider_1.UbcLlmSandboxProvider(apiKey, endpoint, defaultModel, logger, { embeddingModel });
            default:
                // Consider if we want a way to register custom providers?
                // For now, treat unknown provider string as an error.
                if (typeof provider === 'string') {
                    throw new ubc_genai_toolkit_core_1.ConfigurationError(`Unsupported built-in provider: ${provider}`);
                }
                else {
                    // If provider is not a string (e.g., a custom object),
                    // potentially handle it differently or throw error.
                    // Re-evaluating this logic based on how custom providers might work.
                    // For now, assume provider is a string type from config.
                    throw new ubc_genai_toolkit_core_1.ConfigurationError(`Invalid provider configuration.`);
                }
        }
    }
    /**
     * Merge provided options with defaults
     *
     * @param options - The options to merge
     * @param overrides - The overrides to merge
     * @returns The merged options
     */
    mergeOptions(options, overrides) {
        const defaultOptions = this.config.defaultOptions || {};
        return {
            model: this.config.defaultModel,
            ...defaultOptions,
            ...options,
            ...overrides,
        };
    }
    /**
     * Merge structured output options with defaults
     *
     * @param options - The options to merge
     * @returns The merged options
     */
    mergeStructuredOptions(options) {
        // Merge the options with the structured output options
        const defaultOptions = this.config.defaultOptions || {};
        // Merge the options with the structured output options
        return {
            model: this.config.defaultModel,
            ...defaultOptions,
            ...options,
            stream: false,
        };
    }
}
exports.LLMModule = LLMModule;
//# sourceMappingURL=llm-module.js.map