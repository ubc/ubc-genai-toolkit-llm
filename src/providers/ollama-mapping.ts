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

import { zodToJsonSchema } from 'zod-to-json-schema';
import {
	Message,
	StopReason,
	ToolCall,
	ToolDefinition,
} from '../types';

/**
 * Ollama attaches images to a message via an `images` field of base64 strings
 * (vision-capable models). Returns an empty object for text-only messages.
 */
export function ollamaImages(msg: Message): { images?: string[] } {
	return msg.images && msg.images.length > 0
		? { images: msg.images.map((image) => image.data) }
		: {};
}

/** Structural shape of an Ollama chat message (subset the toolkit produces). */
export interface OllamaChatMessage {
	role: string;
	content: string;
	images?: string[];
	tool_calls?: Array<{
		function: { name: string; arguments: Record<string, unknown> };
	}>;
}

/**
 * Maps toolkit messages to Ollama chat messages. Assistant tool calls become
 * `tool_calls` (arguments stay objects); tool results become `role: 'tool'`
 * messages without an id (Ollama matches by order, so `toolCallId` is not
 * sent — it exists only for the caller's bookkeeping).
 */
export function toOllamaMessages(messages: Message[]): OllamaChatMessage[] {
	return messages.map((msg): OllamaChatMessage => {
		if (msg.role === 'tool') {
			return { role: 'tool', content: msg.content };
		}
		if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
			return {
				role: 'assistant',
				content: msg.content,
				tool_calls: msg.toolCalls.map((call) => ({
					function: { name: call.name, arguments: call.arguments },
				})),
			};
		}
		return {
			role: msg.role,
			content: msg.content,
			...ollamaImages(msg),
		};
	});
}

/**
 * Converts toolkit tool definitions to Ollama function tools. Zod schemas
 * become inline JSON Schema (no `$ref` indirection — matches the structured
 * output path in the provider).
 */
export function toOllamaTools(tools: ToolDefinition[]): unknown[] {
	return tools.map((tool) => ({
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: zodToJsonSchema(tool.parameters as never, {
				target: 'jsonSchema7',
				$refStrategy: 'none',
			}) as Record<string, unknown>,
		},
	}));
}

/**
 * Extracts normalized {@link ToolCall}s from an Ollama response message,
 * synthesizing `ollama_call_<index>` ids. Returns `undefined` when there are
 * none.
 */
export function fromOllamaToolCalls(
	toolCalls:
		| Array<{ function: { name: string; arguments: Record<string, unknown> } }>
		| undefined
): ToolCall[] | undefined {
	if (!toolCalls || toolCalls.length === 0) {
		return undefined;
	}
	return toolCalls.map((call, index) => ({
		id: `ollama_call_${index}`,
		name: call.function.name,
		arguments: call.function.arguments ?? {},
	}));
}

/**
 * Normalizes Ollama `done_reason` into the toolkit {@link StopReason}. Ollama
 * reports `'stop'` even for tool-calling turns, so `hasToolCalls` wins.
 */
export function mapOllamaDoneReason(
	reason: string | undefined,
	hasToolCalls: boolean
): StopReason | undefined {
	if (hasToolCalls) return 'tool_calls';
	if (reason == null) return undefined;
	switch (reason) {
		case 'stop':
			return 'stop';
		case 'length':
			return 'length';
		default:
			return 'other';
	}
}
