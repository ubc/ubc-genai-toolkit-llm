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

import { zodToJsonSchema } from 'zod-to-json-schema';
import { APIError } from 'ubc-genai-toolkit-core';
import type {
	MessageParam,
	ContentBlockParam,
	Tool,
	ToolChoice,
	ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import {
	Message,
	StopReason,
	ToolCall,
	ToolDefinition,
} from '../types';

/**
 * Message content for the Anthropic SDK: a plain string, or a content-block
 * array (text block + base64 `image` blocks) when the message carries images.
 */
export function toAnthropicContent(msg: Message): string | ContentBlockParam[] {
	if (!msg.images || msg.images.length === 0) {
		return msg.content;
	}
	const blocks: ContentBlockParam[] = [];
	if (msg.content) {
		blocks.push({ type: 'text', text: msg.content });
	}
	for (const image of msg.images) {
		blocks.push({
			type: 'image',
			source: {
				type: 'base64',
				// Standard image MIME strings; Anthropic validates server-side.
				media_type: image.mimeType as
					| 'image/jpeg'
					| 'image/png'
					| 'image/gif'
					| 'image/webp',
				data: image.data,
			},
		});
	}
	return blocks;
}

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
export function toAnthropicMessages(messages: Message[]): MessageParam[] {
	const out: MessageParam[] = [];

	for (const msg of messages) {
		if (msg.role === 'system') {
			continue;
		}

		if (msg.role === 'tool') {
			if (!msg.toolCallId) {
				throw new APIError(
					"Tool-result message is missing 'toolCallId'; it must reference the ToolCall.id it answers.",
					400
				);
			}
			const resultBlock: ToolResultBlockParam = {
				type: 'tool_result',
				tool_use_id: msg.toolCallId,
				content: msg.content,
			};
			const previous = out[out.length - 1];
			const previousIsToolResults =
				previous &&
				previous.role === 'user' &&
				Array.isArray(previous.content) &&
				previous.content.every((block) => block.type === 'tool_result');
			if (previousIsToolResults) {
				(previous.content as ToolResultBlockParam[]).push(resultBlock);
			} else {
				out.push({ role: 'user', content: [resultBlock] });
			}
			continue;
		}

		if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
			const blocks: ContentBlockParam[] = [];
			if (msg.content) {
				blocks.push({ type: 'text', text: msg.content });
			}
			for (const call of msg.toolCalls) {
				blocks.push({
					type: 'tool_use',
					id: call.id,
					name: call.name,
					input: call.arguments,
				});
			}
			out.push({ role: 'assistant', content: blocks });
			continue;
		}

		out.push({
			role: msg.role,
			content: toAnthropicContent(msg),
		});
	}

	return out;
}

/**
 * Converts toolkit tool definitions to Anthropic tools. Zod schemas become
 * inline JSON Schema (no `$ref` indirection).
 */
export function toAnthropicTools(tools: ToolDefinition[]): Tool[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: zodToJsonSchema(tool.parameters as never, {
			target: 'jsonSchema7',
			$refStrategy: 'none',
		}) as Tool['input_schema'],
	}));
}

/**
 * Maps the toolkit's `toolChoice` to Anthropic's `tool_choice` object.
 * Toolkit `'required'` is Anthropic `{ type: 'any' }`.
 */
export function toAnthropicToolChoice(
	choice?: 'auto' | 'required' | 'none'
): ToolChoice | undefined {
	switch (choice) {
		case 'auto':
			return { type: 'auto' };
		case 'required':
			return { type: 'any' };
		case 'none':
			return { type: 'none' };
		default:
			return undefined;
	}
}

/**
 * Extracts normalized {@link ToolCall}s from Anthropic response content
 * blocks. Returns `undefined` (not `[]`) when there are none.
 */
export function fromAnthropicToolUse(
	content: Array<{ type: string; [key: string]: unknown }>
): ToolCall[] | undefined {
	const toolUseBlocks = content.filter((block) => block.type === 'tool_use');
	if (toolUseBlocks.length === 0) {
		return undefined;
	}
	return toolUseBlocks.map((block) => ({
		id: block.id as string,
		name: block.name as string,
		arguments: (block.input ?? {}) as Record<string, unknown>,
	}));
}

/**
 * Normalizes Anthropic `stop_reason` into the toolkit {@link StopReason}.
 */
export function mapAnthropicStopReason(
	reason: string | null | undefined
): StopReason | undefined {
	if (reason == null) return undefined;
	switch (reason) {
		case 'end_turn':
		case 'stop_sequence':
			return 'stop';
		case 'tool_use':
			return 'tool_calls';
		case 'max_tokens':
			return 'length';
		default:
			return 'other';
	}
}
