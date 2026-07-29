/**
 * @fileoverview Pure mapping helpers for the Anthropic provider's tool calling.
 *
 * Anthropic's wire format differs from the toolkit's neutral shapes in two
 * load-bearing ways:
 * - Assistant tool requests are `tool_use` content blocks, not a `tool_calls`
 *   array.
 * - Tool results are `tool_result` content blocks inside a **user** message
 *   (there is no `tool` role), and parallel results must share ONE user
 *   message — splitting them degrades the model's parallel tool calling.
 *
 * Pure functions only (no client, no network) so this translation is
 * unit-testable without mocking the SDK.
 */
import type { MessageParam, ContentBlockParam, Tool, ToolChoice } from '@anthropic-ai/sdk/resources/messages';
import { Message, StopReason, ToolCall, ToolDefinition } from '../types';
/**
 * Message content for the Anthropic SDK: a plain string, or a content-block
 * array (text block + base64 `image` blocks) when the message carries images.
 */
export declare function toAnthropicContent(msg: Message): string | ContentBlockParam[];
/**
 * Maps toolkit messages to Anthropic `MessageParam[]`:
 * - `system` messages are dropped (callers pass system text via the top-level
 *   `system` request field).
 * - assistant messages with {@link Message.toolCalls} become text + `tool_use`
 *   blocks.
 * - `tool` messages become `tool_result` blocks in a user message; consecutive
 *   tool messages are merged into one user message so parallel results arrive
 *   together.
 *
 * @throws {APIError} 400 when a `role: 'tool'` message has no `toolCallId`.
 */
export declare function toAnthropicMessages(messages: Message[]): MessageParam[];
/**
 * Converts toolkit tool definitions to Anthropic tools. Zod schemas become
 * inline JSON Schema (no `$ref` indirection).
 */
export declare function toAnthropicTools(tools: ToolDefinition[]): Tool[];
/**
 * Maps the toolkit's `toolChoice` to Anthropic's `tool_choice` object.
 * Toolkit `'required'` is Anthropic `{ type: 'any' }`.
 */
export declare function toAnthropicToolChoice(choice?: 'auto' | 'required' | 'none'): ToolChoice | undefined;
/**
 * Extracts normalized {@link ToolCall}s from Anthropic response content
 * blocks. Returns `undefined` (not `[]`) when there are none.
 */
export declare function fromAnthropicToolUse(content: Array<{
    type: string;
    [key: string]: unknown;
}>): ToolCall[] | undefined;
/**
 * Normalizes Anthropic `stop_reason` into the toolkit {@link StopReason}.
 */
export declare function mapAnthropicStopReason(reason: string | null | undefined): StopReason | undefined;
//# sourceMappingURL=anthropic-mapping.d.ts.map