import type { ZodType } from 'zod';
import {
	Message,
	LLMOptions,
	LLMResponse,
	LLMStructuredResponse,
	StructuredOutputOptions,
} from './types';


export interface ConversationFactory {

	/**
	 * Create a new conversation
	 * @returns A new conversation
	 */
	createConversation(): Conversation;

	/**
	 * Send a conversation to the LLM
	 * @param messages - The messages to send to the LLM
	 * @param options - The options for the LLM
	 * @returns The response from the LLM
	 */
	sendConversation(
		messages: Message[],
		options?: LLMOptions
	): Promise<LLMResponse>;

	/**
	 * Stream a conversation to the LLM
	 * @param messages - The messages to send to the LLM
	 * @param callback - The callback to use for the LLM
	 * @param options - The options for the LLM
	 * @returns The response from the LLM
	 */
	streamConversation(
		messages: Message[],
		callback: (chunk: string) => void,
		options?: LLMOptions
	): Promise<LLMResponse>;

	/**
	 * Send a structured conversation to the LLM
	 * @param messages - The messages to send to the LLM
	 * @param schema - The schema to use for the structured output
	 * @param options - The options for the LLM
	 * @returns The response from the LLM
	 */
	sendStructuredConversation<T>(
		messages: Message[],
		schema: ZodType<T>,
		options?: StructuredOutputOptions
	): Promise<LLMStructuredResponse<T>>;
}

/**
 * Conversation interface
 * @param addMessage - Add a message to the conversation
 * @param getHistory - Get the history of the conversation
 * @param send - Send a conversation to the LLM
 * @param stream - Stream a conversation to the LLM
 * @param sendStructured - Send a structured conversation to the LLM
 */
export interface Conversation {
	/**
	 * Add a message to the conversation
	 * @param role - The role of the message
	 * @param content - The content of the message
	 */
	addMessage(role: 'user' | 'assistant' | 'system', content: string): void;

	/**
	 * Get the history of the conversation
	 * @returns The history of the conversation
	 */
	getHistory(): Message[];

	/**
	 * Send a conversation to the LLM
	 * @param options - The options for the LLM
	 * @returns The response from the LLM
	 */
	send(options?: LLMOptions): Promise<LLMResponse>;

	/**
	 * Stream a conversation to the LLM
	 * @param callback - The callback to use for the LLM
	 * @param options - The options for the LLM
	 * @returns The response from the LLM
	 */
	stream(
		callback: (chunk: string) => void,
		options?: LLMOptions
	): Promise<LLMResponse>;

	/**
	 * Send a structured conversation to the LLM
	 * @param schema - The schema to use for the structured output
	 * @param options - The options for the LLM
	 * @returns The response from the LLM
	 */
	sendStructured<T>(
		schema: ZodType<T>,
		options?: StructuredOutputOptions
	): Promise<LLMStructuredResponse<T>>;
}
