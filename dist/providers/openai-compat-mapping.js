"use strict";
/**
 * @fileoverview Pure mapping helpers shared by the OpenAI-compatible providers
 * ({@link OpenAIProvider} and {@link UbcLlmSandboxProvider}).
 *
 * Everything here is a pure function (no client, no network) so the
 * toolkit-neutral ⇄ OpenAI wire-format translation — including tool calling —
 * can be unit-tested without mocking an SDK.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.separateOpenAIOptions = separateOpenAIOptions;
exports.toOpenAIContent = toOpenAIContent;
exports.toOpenAIMessages = toOpenAIMessages;
exports.toOpenAITools = toOpenAITools;
exports.fromOpenAIToolCalls = fromOpenAIToolCalls;
exports.mapOpenAIFinishReason = mapOpenAIFinishReason;
const zod_to_json_schema_1 = require("zod-to-json-schema");
const ubc_genai_toolkit_core_1 = require("ubc-genai-toolkit-core");
/**
 * Splits {@link LLMOptions} into fields the toolkit sets explicitly on each
 * request vs. passthrough `rest`.
 *
 * `rest` is spread into the SDK call so callers can pass supported OpenAI
 * parameters not modeled on `LLMOptions`, without colliding with
 * toolkit-managed keys. `tools` and `toolChoice` are toolkit-managed (they are
 * translated, not forwarded raw) so they are stripped here too.
 */
function separateOpenAIOptions(options = {}) {
    const { model, temperature, maxTokens, systemPrompt, responseFormat, stream, tools, toolChoice, 
    // Rename so it is not forwarded in `rest`; only structured calls need the name.
    structuredOutputName: _structuredOutputName, ...rest } = options;
    const known = {
        model,
        temperature,
        maxTokens,
        systemPrompt,
        responseFormat,
        stream,
        tools,
        toolChoice,
        structuredOutputName: _structuredOutputName,
    };
    return { known, rest };
}
/**
 * Message content for the OpenAI SDK: a plain string, or a multi-part array
 * (text + base64 `image_url` parts) when the message carries images.
 */
function toOpenAIContent(msg) {
    if (!msg.images || msg.images.length === 0) {
        return msg.content;
    }
    const parts = [];
    if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
    }
    for (const image of msg.images) {
        parts.push({
            type: 'image_url',
            image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        });
    }
    return parts;
}
/**
 * Maps toolkit messages to OpenAI chat messages, including the tool-calling
 * shapes: assistant messages carrying {@link Message.toolCalls} become
 * `tool_calls` entries (arguments re-serialized to JSON strings), and
 * `role: 'tool'` messages become `role: 'tool'` + `tool_call_id`.
 *
 * @throws {APIError} 400 when a `role: 'tool'` message has no `toolCallId` —
 * OpenAI cannot associate the result with its request, so failing loudly here
 * beats a confusing provider-side 400.
 */
function toOpenAIMessages(messages) {
    return messages.map((msg) => {
        if (msg.role === 'tool') {
            if (!msg.toolCallId) {
                throw new ubc_genai_toolkit_core_1.APIError("Tool-result message is missing 'toolCallId'; it must reference the ToolCall.id it answers.", 400);
            }
            return {
                role: 'tool',
                tool_call_id: msg.toolCallId,
                content: msg.content,
            };
        }
        if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
            return {
                role: 'assistant',
                // OpenAI expects null (not '') when an assistant turn is tool-calls-only.
                content: msg.content || null,
                tool_calls: msg.toolCalls.map((call) => ({
                    id: call.id,
                    type: 'function',
                    function: {
                        name: call.name,
                        arguments: JSON.stringify(call.arguments),
                    },
                })),
            };
        }
        return {
            role: msg.role,
            content: toOpenAIContent(msg),
        };
    });
}
/**
 * Converts toolkit tool definitions to OpenAI `function` tools. Zod schemas
 * become inline JSON Schema (no `$ref` indirection — maximum server
 * compatibility, matching the Ollama structured-output path).
 */
function toOpenAITools(tools) {
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
 * Extracts normalized {@link ToolCall}s from an OpenAI assistant message.
 * Returns `undefined` (not `[]`) when there are none, so `LLMResponse.toolCalls`
 * stays absent for plain text responses.
 *
 * @throws {APIError} 502 when the model emitted syntactically invalid JSON
 * arguments — callers cannot execute a tool with unparseable input.
 */
function fromOpenAIToolCalls(message) {
    const toolCalls = message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
        return undefined;
    }
    return toolCalls.map((call) => {
        let args;
        try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        }
        catch {
            throw new ubc_genai_toolkit_core_1.APIError(`Model returned invalid JSON arguments for tool '${call.function.name}'.`, 502, { tool: call.function.name, raw: call.function.arguments.slice(0, 200) });
        }
        return { id: call.id, name: call.function.name, arguments: args };
    });
}
/**
 * Normalizes OpenAI `finish_reason` into the toolkit {@link StopReason}.
 * Unknown reasons map to `'other'`; absent reasons map to `undefined`.
 */
function mapOpenAIFinishReason(reason) {
    if (reason == null)
        return undefined;
    switch (reason) {
        case 'stop':
            return 'stop';
        case 'tool_calls':
        case 'function_call':
            return 'tool_calls';
        case 'length':
            return 'length';
        default:
            return 'other';
    }
}
//# sourceMappingURL=openai-compat-mapping.js.map