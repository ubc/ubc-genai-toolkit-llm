import type { ZodType } from 'zod';
import {
	LLMOptions,
	LLMResponse,
	LLMStructuredResponse,
	Message,
	StructuredOutputOptions,
	EmbeddingOptions,
	EmbeddingResponse,
} from '../types';

/**
 * Common interface for all LLM providers
 */
export interface Provider {
	/**
	 * Send a single message to the LLM
	 */
	sendMessage(message: string, options?: LLMOptions): Promise<LLMResponse>;

	/**
	 * Send a conversation to the LLM
	 */
	sendConversation(
		messages: Message[],
		options?: LLMOptions
	): Promise<LLMResponse>;

	/**
	 * Stream a conversation to the LLM
	 */
	streamConversation(
		messages: Message[],
		callback: (chunk: string) => void,
		options?: LLMOptions
	): Promise<LLMResponse>;

	/**
	 * Get the name of the provider
	 */
	getName(): string;

	/**
	 * Get the available models for this provider
	 */
	getAvailableModels(): Promise<string[]>;

	/**
	 * Generate embeddings for a list of text strings (optional method).
	 *
	 * Providers that do not support embeddings should throw a ToolkitError.
	 */
	embed?(
		texts: string[],
		options?: EmbeddingOptions
	): Promise<EmbeddingResponse>;

	/**
	 * Non-streaming structured completion validated against a Zod schema.
	 * Model and provider must support structured JSON output.
	 */
	sendStructuredConversation<T>(
		messages: Message[],
		schema: ZodType<T>,
		options?: StructuredOutputOptions
	): Promise<LLMStructuredResponse<T>>;
}