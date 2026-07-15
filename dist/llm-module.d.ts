import { LLMConfig, LLMOptions, LLMResponse, LLMStructuredResponse, Message, StructuredOutputOptions, EmbeddingOptions, EmbeddingResponse } from './types';
import { Conversation, ConversationFactory } from './conversation-interface';
import type { ZodType } from 'zod';
/**
 * Main LLM Module facade
 *
 */
export declare class LLMModule implements ConversationFactory {
    private provider;
    private config;
    private logger;
    /**
     * Create a new LLM module instance
     *
     * @param config - The configuration for the LLM module
     */
    constructor(config: Partial<LLMConfig>);
    /**
     * Send a single message to the LLM
     *
     * @param message - The message to send to the LLM
     * @param options - The options for the LLM
     * @returns The response from the LLM
     */
    sendMessage(message: string, options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Send a conversation to the LLM
     *
     * @param messages - The messages to send to the LLM
     * @param options - The options for the LLM
     * @returns The response from the LLM
     */
    sendConversation(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Non-streaming structured completion: provider validates output against the given Zod schema.
     * Requires a model that supports structured JSON (provider-specific).
     */
    sendStructuredConversation<T>(messages: Message[], schema: ZodType<T>, options?: StructuredOutputOptions): Promise<LLMStructuredResponse<T>>;
    /**
     * Stream a conversation to the LLM
     * @param messages - The messages to send to the LLM
     * @param callback - The callback to use for the LLM
     * @param options - The options for the LLM
     * @returns The response from the LLM
     */
    streamConversation(messages: Message[], callback: (chunk: string) => void, options?: LLMOptions): Promise<LLMResponse>;
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
    embed(texts: string[], options?: EmbeddingOptions): Promise<EmbeddingResponse>;
    /**
     * Create a new conversation
     */
    createConversation(): Conversation;
    /**
     * Get the available models for the current provider
     */
    getAvailableModels(): Promise<string[]>;
    /**
     * Get the current provider name
     */
    getProviderName(): string;
    /**
     * Initialize the provider based on configuration
     *
     * @returns The provider
     */
    private initializeProvider;
    /**
     * Merge provided options with defaults
     *
     * @param options - The options to merge
     * @param overrides - The overrides to merge
     * @returns The merged options
     */
    private mergeOptions;
    /**
     * Merge structured output options with defaults
     *
     * @param options - The options to merge
     * @returns The merged options
     */
    private mergeStructuredOptions;
}
//# sourceMappingURL=llm-module.d.ts.map