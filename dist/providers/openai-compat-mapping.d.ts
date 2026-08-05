/**
 * @fileoverview Pure mapping helpers shared by the OpenAI-compatible providers
 * ({@link OpenAIProvider} and {@link UbcLlmSandboxProvider}).
 *
 * Everything here is a pure function (no client, no network) so the
 * toolkit-neutral ⇄ OpenAI wire-format translation — including tool calling —
 * can be unit-tested without mocking an SDK.
 */
import OpenAI from 'openai';
import { LLMOptions, Message, ReasoningEffort, StopReason, ToolCall, ToolDefinition } from '../types';
/** Whether a model accepts / requires OpenAI `reasoning_effort`. */
export type OpenAIReasoningCapability = 'unsupported' | 'optional' | 'required';
/**
 * Splits {@link LLMOptions} into fields the toolkit sets explicitly on each
 * request vs. passthrough `rest`.
 *
 * `rest` is spread into the SDK call so callers can pass supported OpenAI
 * parameters not modeled on `LLMOptions`, without colliding with
 * toolkit-managed keys. `tools`, `toolChoice`, and `reasoningEffort` are
 * toolkit-managed (they are translated, not forwarded raw) so they are
 * stripped here too. Raw snake_case aliases (`reasoning_effort`,
 * `max_completion_tokens`, `max_tokens`) are stripped to avoid double-sending,
 * but their values are retained and normalized into `known` (camelCase wins).
 */
export declare function separateOpenAIOptions(options?: LLMOptions): {
    known: {
        model: string | undefined;
        temperature: number | undefined;
        maxTokens: number | undefined;
        systemPrompt: string | undefined;
        responseFormat: "json" | "text" | undefined;
        stream: boolean | undefined;
        reasoningEffort: ReasoningEffort | undefined;
        tools: ToolDefinition[] | undefined;
        toolChoice: "required" | "none" | "auto" | undefined;
        structuredOutputName: string | undefined;
    };
    rest: {
        [key: string]: any;
    };
};
/**
 * Model-based reasoning support for OpenAI-compatible Chat Completions.
 * Capability is driven by the model id, not by which provider wrapper is used.
 *
 * - unsupported — classic chat models; omit reasoning; error if requested
 * - optional — gpt-5 / o-series; send `reasoning_effort` only when requested
 * - required — reserved; no production models seeded yet
 */
export declare function getOpenAIReasoningCapability(model: string): OpenAIReasoningCapability;
export interface OpenAICompatCompletionKnown {
    maxTokens?: number;
    reasoningEffort?: ReasoningEffort | string;
    temperature?: number;
}
export interface OpenAICompatCompletionOptions {
    /**
     * Overrides whether reasoning may be sent for this model, for gateways whose
     * roster is not OpenAI's. Only the reasoning gate moves — the token field
     * name still follows {@link getOpenAIReasoningCapability}, because that is a
     * property of the model's own API, not of who is proxying it.
     *
     * @see getSandboxReasoningCapability
     */
    reasoningCapability?: OpenAIReasoningCapability;
}
/**
 * Builds the token / reasoning / temperature slice for an OpenAI-compatible
 * chat completion request. Token field name follows model capability
 * (`max_completion_tokens` vs `max_tokens`). Reasoning is omitted unless the
 * model supports it and the caller requested an effort.
 *
 * @throws {APIError} 400 for unsupported model+effort, invalid effort, or
 * required capability with no effort supplied.
 */
export declare function buildOpenAICompatCompletionFields(model: string, known?: OpenAICompatCompletionKnown, options?: OpenAICompatCompletionOptions): {
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    reasoning_effort?: string;
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