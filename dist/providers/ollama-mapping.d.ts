/**
 * @fileoverview Pure mapping helpers for the Ollama provider's tool calling.
 *
 * Ollama quirks this module encodes:
 * - Tool calls carry **no id**. We synthesize `ollama_call_<index>` so callers
 *   can still correlate results within one response; Ollama itself matches
 *   tool results to calls by order, so the id never goes back on the wire.
 * - `arguments` arrive already parsed (objects, not JSON strings).
 * - A tool-calling turn still reports `done_reason: 'stop'`, so the presence
 *   of `tool_calls` — not the done reason — drives the normalized
 *   {@link StopReason}.
 */
import { Message, StopReason, ToolCall, ToolDefinition } from '../types';
/**
 * Ollama attaches images to a message via an `images` field of base64 strings
 * (vision-capable models). Returns an empty object for text-only messages.
 */
export declare function ollamaImages(msg: Message): {
    images?: string[];
};
/** Structural shape of an Ollama chat message (subset the toolkit produces). */
export interface OllamaChatMessage {
    role: string;
    content: string;
    images?: string[];
    tool_calls?: Array<{
        function: {
            name: string;
            arguments: Record<string, unknown>;
        };
    }>;
}
/**
 * Maps toolkit messages to Ollama chat messages. Assistant tool calls become
 * `tool_calls` (arguments stay objects); tool results become `role: 'tool'`
 * messages without an id (Ollama matches by order, so `toolCallId` is not
 * sent — it exists only for the caller's bookkeeping).
 */
export declare function toOllamaMessages(messages: Message[]): OllamaChatMessage[];
/**
 * Converts toolkit tool definitions to Ollama function tools. Zod schemas
 * become inline JSON Schema (no `$ref` indirection — matches the structured
 * output path in the provider).
 */
export declare function toOllamaTools(tools: ToolDefinition[]): unknown[];
/**
 * Extracts normalized {@link ToolCall}s from an Ollama response message,
 * synthesizing `ollama_call_<index>` ids. Returns `undefined` when there are
 * none.
 */
export declare function fromOllamaToolCalls(toolCalls: Array<{
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}> | undefined): ToolCall[] | undefined;
/**
 * Normalizes Ollama `done_reason` into the toolkit {@link StopReason}. Ollama
 * reports `'stop'` even for tool-calling turns, so `hasToolCalls` wins.
 */
export declare function mapOllamaDoneReason(reason: string | undefined, hasToolCalls: boolean): StopReason | undefined;
//# sourceMappingURL=ollama-mapping.d.ts.map