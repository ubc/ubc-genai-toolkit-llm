/**
 * @fileoverview Defines the ConversationImpl class, which manages a conversation history
 * and interacts with an LLM via a ConversationFactory.
 */
import { Message, LLMOptions, LLMResponse, LLMStructuredResponse, StructuredOutputOptions } from './types';
import type { ZodType } from 'zod';
import { Conversation, ConversationFactory } from './conversation-interface';
/**
 * Implements the Conversation interface to manage a sequence of messages
 * and facilitate interaction with a Large Language Model (LLM).
 * It uses a ConversationFactory to handle the actual communication (sending/streaming)
 * with the underlying LLM service.
 */
export declare class ConversationImpl implements Conversation {
    /** Stores the sequence of messages in the conversation. */
    private messages;
    /** The factory responsible for communication with the LLM service. */
    private factory;
    /**
     * Creates an instance of ConversationImpl.
     * @param {ConversationFactory} factory - The factory used to send/stream the conversation to the LLM.
     */
    constructor(factory: ConversationFactory);
    /**
     * Adds a new message to the conversation history.
     * @param {'user' | 'assistant' | 'system'} role - The role of the message sender.
     * @param {string} content - The textual content of the message.
     */
    addMessage(role: 'user' | 'assistant' | 'system', content: string): void;
    /**
     * Retrieves a copy of the current conversation history.
     * @returns {Message[]} An array containing all messages in the conversation so far.
     *                     Returns a shallow copy to prevent external modification of the internal state.
     */
    getHistory(): Message[];
    /**
     * Sends the entire conversation history to the LLM for a response.
     * The LLM's response is then added to the history as an 'assistant' message.
     * @param {LLMOptions} [options] - Optional parameters to customize the LLM request (e.g., temperature, max tokens).
     * @returns {Promise<LLMResponse>} A promise that resolves with the LLM's response, including content and potentially other metadata.
     */
    send(options?: LLMOptions): Promise<LLMResponse>;
    /**
     * Sends the conversation history to the LLM and streams the response back.
     * Chunks of the response are passed to the provided callback function as they arrive.
     * The complete response is added to the history as an 'assistant' message once the stream finishes.
     * @param {(chunk: string) => void} callback - A function to be called with each chunk of the streamed response.
     * @param {LLMOptions} [options] - Optional parameters to customize the LLM request.
     * @returns {Promise<LLMResponse>} A promise that resolves with the final LLM response object (containing the full content) once the stream is complete.
     */
    stream(callback: (chunk: string) => void, options?: LLMOptions): Promise<LLMResponse>;
    sendStructured<T>(schema: ZodType<T>, options?: StructuredOutputOptions): Promise<LLMStructuredResponse<T>>;
}
//# sourceMappingURL=conversation.d.ts.map