"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ollamaImages = ollamaImages;
exports.toOllamaMessages = toOllamaMessages;
exports.toOllamaTools = toOllamaTools;
exports.fromOllamaToolCalls = fromOllamaToolCalls;
exports.mapOllamaDoneReason = mapOllamaDoneReason;
const zod_to_json_schema_1 = require("zod-to-json-schema");
/**
 * Ollama attaches images to a message via an `images` field of base64 strings
 * (vision-capable models). Returns an empty object for text-only messages.
 */
function ollamaImages(msg) {
    return msg.images && msg.images.length > 0
        ? { images: msg.images.map((image) => image.data) }
        : {};
}
/**
 * Maps toolkit messages to Ollama chat messages. Assistant tool calls become
 * `tool_calls` (arguments stay objects); tool results become `role: 'tool'`
 * messages without an id (Ollama matches by order, so `toolCallId` is not
 * sent — it exists only for the caller's bookkeeping).
 */
function toOllamaMessages(messages) {
    return messages.map((msg) => {
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
function toOllamaTools(tools) {
    return tools.map((tool) => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: (0, zod_to_json_schema_1.zodToJsonSchema)(tool.parameters, {
                target: 'jsonSchema7',
                $refStrategy: 'none',
            }),
        },
    }));
}
/**
 * Extracts normalized {@link ToolCall}s from an Ollama response message,
 * synthesizing `ollama_call_<index>` ids. Returns `undefined` when there are
 * none.
 */
function fromOllamaToolCalls(toolCalls) {
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
function mapOllamaDoneReason(reason, hasToolCalls) {
    if (hasToolCalls)
        return 'tool_calls';
    if (reason == null)
        return undefined;
    switch (reason) {
        case 'stop':
            return 'stop';
        case 'length':
            return 'length';
        default:
            return 'other';
    }
}
//# sourceMappingURL=ollama-mapping.js.map