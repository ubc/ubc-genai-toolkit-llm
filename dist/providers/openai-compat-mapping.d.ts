/**
 * @fileoverview Pure mapping helpers shared by the OpenAI-compatible providers
 * ({@link OpenAIProvider} and {@link UbcLlmSandboxProvider}).
 *
 * Everything here is a pure function (no client, no network) so the
 * toolkit-neutral ⇄ OpenAI wire-format translation — including tool calling —
 * can be unit-tested without mocking an SDK.
 */
import OpenAI from 'openai';
import { LLMOptions, Message, StopReason, ToolCall, ToolDefinition } from '../types';
/**
 * Splits {@link LLMOptions} into fields the toolkit sets explicitly on each
 * request vs. passthrough `rest`.
 *
 * `rest` is spread into the SDK call so callers can pass supported OpenAI
 * parameters not modeled on `LLMOptions`, without colliding with
 * toolkit-managed keys. `tools` and `toolChoice` are toolkit-managed (they are
 * translated, not forwarded raw) so they are stripped here too.
 */
export declare function separateOpenAIOptions(options?: LLMOptions): {
    known: {
        model: string | undefined;
        temperature: number | undefined;
        maxTokens: number | undefined;
        systemPrompt: string | undefined;
        responseFormat: "json" | "text" | undefined;
        stream: boolean | undefined;
        tools: ToolDefinition[] | undefined;
        toolChoice: "required" | "auto" | "none" | undefined;
        structuredOutputName: string | undefined;
    };
    rest: {
        [key: string]: any;
    };
};
/**
 * Message content for the OpenAI SDK: a plain string, or a multi-part array
 * (text + base64 `image_url` parts) when the message carries images.
 */
export declare function toOpenAIContent(msg: Message): string | OpenAI.Chat.Completions.ChatCompletionContentPart[];
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
export declare function toOpenAIMessages(messages: Message[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[];
/**
 * Converts toolkit tool definitions to OpenAI `function` tools. Zod schemas
 * become inline JSON Schema (no `$ref` indirection — maximum server
 * compatibility, matching the Ollama structured-output path).
 */
export declare function toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[];
/** Minimal structural type: the slice of an OpenAI assistant message we read tool calls from. */
interface OpenAIToolCallCarrier {
    tool_calls?: Array<{
        id: string;
        type: string;
        function: {
            name: string;
            arguments: string;
        };
    }>;
}
/**
 * Extracts normalized {@link ToolCall}s from an OpenAI assistant message.
 * Returns `undefined` (not `[]`) when there are none, so `LLMResponse.toolCalls`
 * stays absent for plain text responses.
 *
 * @throws {APIError} 502 when the model emitted syntactically invalid JSON
 * arguments — callers cannot execute a tool with unparseable input.
 */
export declare function fromOpenAIToolCalls(message: OpenAIToolCallCarrier | undefined): ToolCall[] | undefined;
/**
 * Normalizes OpenAI `finish_reason` into the toolkit {@link StopReason}.
 * Unknown reasons map to `'other'`; absent reasons map to `undefined`.
 */
export declare function mapOpenAIFinishReason(reason: string | null | undefined): StopReason | undefined;
export {};
//# sourceMappingURL=openai-compat-mapping.d.ts.map