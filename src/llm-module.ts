import {
	APIError,
	ConfigurationError,
	ConsoleLogger,
	LoggerInterface,
	mergeWithDefaults,
} from 'ubc-genai-toolkit-core';
import {
	LLMConfig,
	LLMOptions,
	LLMResponse,
	LLMStructuredResponse,
	Message,
	ProviderType,
	StructuredOutputOptions,
	EmbeddingOptions,
	EmbeddingResponse,
} from './types';
import { Provider } from './providers/provider-interface';
import { OpenAIProvider } from './providers/openai-provider';
import { OllamaProvider } from './providers/ollama-provider';
import { AnthropicProvider } from './providers/anthropic-provider';
import { UbcLlmSandboxProvider } from './providers/ubc-llm-sandbox-provider';
import { ConversationImpl } from './conversation';
import { Conversation, ConversationFactory } from './conversation-interface';
import type { ZodType } from 'zod';

/**
 * Default LLM configuration
 */
const DEFAULT_LLM_CONFIG: Partial<LLMConfig> = {
	// defaultModel removed - should be configured per provider instance
};

/**
 * Main LLM Module facade
 * 
 */
export class LLMModule implements ConversationFactory {
	private provider: Provider;
	private config: LLMConfig;
	private logger: LoggerInterface;

	/**
	 * Create a new LLM module instance
	 * 
	 * @param config - The configuration for the LLM module
	 */
	constructor(config: Partial<LLMConfig>) {
		this.config = mergeWithDefaults<LLMConfig>(config, DEFAULT_LLM_CONFIG);
		this.logger = this.config.logger!;
		this.provider = this.initializeProvider();
	}

	/**
	 * Send a single message to the LLM
	 * 
	 * @param message - The message to send to the LLM
	 * @param options - The options for the LLM
	 * @returns The response from the LLM
	 */
	async sendMessage(
		message: string,
		options?: LLMOptions
	): Promise<LLMResponse> {
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
	async sendConversation(
		messages: Message[],
		options?: LLMOptions
	): Promise<LLMResponse> {
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
	async sendStructuredConversation<T>(
		messages: Message[],
		schema: ZodType<T>,
		options?: StructuredOutputOptions
	): Promise<LLMStructuredResponse<T>> {
		this.logger.debug('Sending structured conversation to LLM', {
			provider: this.config.provider,
			model: options?.model || this.config.defaultModel,
			messageCount: messages.length,
		});

		const mergedOptions = this.mergeStructuredOptions(options);
		return this.provider.sendStructuredConversation(
			messages,
			schema,
			mergedOptions
		);
	}

	/**
	 * Stream a conversation to the LLM
	 * @param messages - The messages to send to the LLM
	 * @param callback - The callback to use for the LLM
	 * @param options - The options for the LLM
	 * @returns The response from the LLM
	 */
	async streamConversation(
		messages: Message[],
		callback: (chunk: string) => void,
		options?: LLMOptions
	): Promise<LLMResponse> {
		this.logger.debug('Streaming conversation to LLM', {
			provider: this.config.provider,
			model: options?.model || this.config.defaultModel,
			messageCount: messages.length,
		});

		// Merge the options with the stream option
		const mergedOptions = this.mergeOptions(options, { stream: true });

		// Use the provider to stream the conversation
		return this.provider.streamConversation(
			messages,
			callback,
			mergedOptions
		);
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
	async embed(
		texts: string[],
		options?: EmbeddingOptions
	): Promise<EmbeddingResponse> {
		this.logger.debug('Generating embeddings', {
			provider: this.config.provider,
			model: options?.model || this.config.embeddingModel,
			textCount: texts.length,
		});

		if (!this.provider.embed) {
			throw new APIError(
				`The configured provider '${this.config.provider}' does not support the embed operation.`,
				501 // Not Implemented
			);
		}

		// Options merging is handled within provider implementations for now
		// Pass options directly
		return this.provider.embed(texts, options);
	}

	/**
	 * Create a new conversation
	 */
	createConversation(): Conversation {
		return new ConversationImpl(this);
	}

	/**
	 * Get the available models for the current provider
	 */
	async getAvailableModels(): Promise<string[]> {
		return this.provider.getAvailableModels();
	}

	/**
	 * Get the current provider name
	 */
	getProviderName(): string {
		return this.provider.getName();
	}

	/**
	 * Initialize the provider based on configuration
	 * 
	 * @returns The provider
	 */
	private initializeProvider(): Provider {
		const {
			provider,
			apiKey,
			endpoint,
			defaultModel,
			embeddingModel,
			logger,
		} = this.config;

		// Ensure logger is defined for providers
		if (!logger) {
			throw new ConfigurationError('Logger is required but was not provided in config');
		}

		switch (provider) {
			case 'openai':
				if (!apiKey) {
					throw new ConfigurationError(
						'API key is required for OpenAI provider'
					);
				}
				if (!defaultModel) {
					throw new ConfigurationError(
						'defaultModel is required for OpenAI provider'
					);
				}
				return new OpenAIProvider(apiKey, defaultModel, logger, {
					endpoint,
					embeddingModel,
				});

			case 'anthropic':
				if (!apiKey) {
					throw new ConfigurationError(
						'API key is required for Anthropic provider'
					);
				}
				if (!defaultModel) {
					throw new ConfigurationError(
						'defaultModel is required for Anthropic provider'
					);
				}
				return new AnthropicProvider(apiKey, defaultModel, logger);

			case 'ollama':
				if (!endpoint) {
					throw new ConfigurationError(
						'endpoint is required for Ollama provider'
					);
				}
				if (!defaultModel) {
					throw new ConfigurationError(
						'defaultModel is required for Ollama provider'
					);
				}
				return new OllamaProvider(endpoint, defaultModel, logger, {
					embeddingModel,
				});

			case 'ubc-llm-sandbox':
				if (!apiKey) {
					throw new ConfigurationError(
						'apiKey is required for UBC LLM Sandbox provider'
					);
				}
				if (!endpoint) {
					throw new ConfigurationError(
						'endpoint is required for UBC LLM Sandbox provider'
					);
				}
				if (!defaultModel) {
					throw new ConfigurationError(
						'defaultModel is required for UBC LLM Sandbox provider'
					);
				}
				return new UbcLlmSandboxProvider(
					apiKey,
					endpoint,
					defaultModel,
					logger,
					{ embeddingModel }
				);

			default:
				// Consider if we want a way to register custom providers?
				// For now, treat unknown provider string as an error.
				if (typeof provider === 'string') {
					throw new ConfigurationError(
						`Unsupported built-in provider: ${provider}`
					);
				} else {
					// If provider is not a string (e.g., a custom object),
					// potentially handle it differently or throw error.
					// Re-evaluating this logic based on how custom providers might work.
					// For now, assume provider is a string type from config.
					throw new ConfigurationError(
						`Invalid provider configuration.`
					);
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
	private mergeOptions(
		options?: LLMOptions,
		overrides?: Partial<LLMOptions>
	): LLMOptions {
		const defaultOptions = this.config.defaultOptions || {};
		const merged = {
			model: this.config.defaultModel,
			...defaultOptions,
			...options,
			...overrides,
		};

		if (merged.reasoningEffort) {
			this.logger.debug('reasoningEffort set on request', {
				provider: this.config.provider,
				model: merged.model,
				reasoningEffort: merged.reasoningEffort,
			});
		}

		return merged;
	}

	/**
	 * Merge structured output options with defaults
	 * 
	 * @param options - The options to merge
	 * @returns The merged options
	 */
	private mergeStructuredOptions(
		options?: StructuredOutputOptions
	): StructuredOutputOptions {

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