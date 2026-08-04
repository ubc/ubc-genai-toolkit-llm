/**
 * @fileoverview Pure mapping helpers shared by the OpenAI-compatible providers
 * ({@link OpenAIProvider} and {@link UbcLlmSandboxProvider}).
 *
 * Everything here is a pure function (no client, no network) so the
 * toolkit-neutral ⇄ OpenAI wire-format translation — including tool calling —
 * can be unit-tested without mocking an SDK.
 */

import OpenAI from 'openai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { APIError } from 'ubc-genai-toolkit-core';
import {
	LLMOptions,
	Message,
	ReasoningEffort,
	StopReason,
	ToolCall,
	ToolDefinition,
} from '../types';

/** Whether a model accepts / requires OpenAI `reasoning_effort`. */
export type OpenAIReasoningCapability = 'unsupported' | 'optional' | 'required';

const ALLOWED_REASONING_EFFORTS: ReadonlySet<string> = new Set<ReasoningEffort>([
	'none',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'max',
]);

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
export function separateOpenAIOptions(options: LLMOptions = {}) {
	const {
		model,
		temperature,
		maxTokens,
		systemPrompt,
		responseFormat,
		stream,
		reasoningEffort,
		tools,
		toolChoice,
		// Rename so it is not forwarded in `rest`; only structured calls need the name.
		structuredOutputName: _structuredOutputName,
		reasoning_effort: reasoningEffortSnake,
		max_completion_tokens: maxCompletionTokensSnake,
		max_tokens: maxTokensSnake,
		...rest
	} = options as LLMOptions & {
		structuredOutputName?: string;
		reasoning_effort?: ReasoningEffort | string;
		max_completion_tokens?: number;
		max_tokens?: number;
	};

	const known = {
		model,
		temperature,
		maxTokens: maxTokens ?? maxCompletionTokensSnake ?? maxTokensSnake,
		systemPrompt,
		responseFormat,
		stream,
		reasoningEffort: (reasoningEffort ??
			reasoningEffortSnake) as ReasoningEffort | undefined,
		tools,
		toolChoice,
		structuredOutputName: _structuredOutputName,
	};

	return { known, rest };
}

/**
 * Model-based reasoning support for OpenAI-compatible Chat Completions.
 * Capability is driven by the model id, not by which provider wrapper is used.
 *
 * - unsupported — classic chat models; omit reasoning; error if requested
 * - optional — gpt-5 / o-series; send `reasoning_effort` only when requested
 * - required — reserved; no production models seeded yet
 */
export function getOpenAIReasoningCapability(
	model: string
): OpenAIReasoningCapability {
	const id = model.toLowerCase();
	if (
		id.startsWith('gpt-5') ||
		id.startsWith('o1') ||
		id.startsWith('o3') ||
		id.startsWith('o4-mini')
	) {
		return 'optional';
	}
	return 'unsupported';
}

export interface OpenAICompatCompletionKnown {
	maxTokens?: number;
	reasoningEffort?: ReasoningEffort | string;
	temperature?: number;
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
export function buildOpenAICompatCompletionFields(
	model: string,
	known: OpenAICompatCompletionKnown = {}
): {
	temperature?: number;
	max_tokens?: number;
	max_completion_tokens?: number;
	reasoning_effort?: string;
} {
	const capability = getOpenAIReasoningCapability(model);
	const fields: {
		temperature?: number;
		max_tokens?: number;
		max_completion_tokens?: number;
		reasoning_effort?: string;
	} = {};

	if (known.temperature !== undefined) {
		fields.temperature = known.temperature;
	}

	if (known.maxTokens !== undefined) {
		if (capability === 'optional' || capability === 'required') {
			fields.max_completion_tokens = known.maxTokens;
		} else {
			fields.max_tokens = known.maxTokens;
		}
	}

	const effort = known.reasoningEffort;

	if (capability === 'required' && effort === undefined) {
		throw new APIError(
			`Model '${model}' requires reasoningEffort (or reasoning_effort); none was provided.`,
			400,
			{ model, capability }
		);
	}

	if (effort !== undefined) {
		if (capability === 'unsupported') {
			throw new APIError(
				`Model '${model}' does not support reasoningEffort; omit it or choose a reasoning-capable model.`,
				400,
				{ model, reasoningEffort: effort }
			);
		}
		if (!ALLOWED_REASONING_EFFORTS.has(effort)) {
			throw new APIError(
				`Unsupported reasoningEffort '${effort}' for model '${model}'. Allowed: ${[
					...ALLOWED_REASONING_EFFORTS,
				].join(', ')}.`,
				400,
				{ model, reasoningEffort: effort }
			);
		}
		fields.reasoning_effort = effort;
	}

	return fields;
}

/**
 * Message content for the OpenAI SDK: a plain string, or a multi-part array
 * (text + base64 `image_url` parts) when the message carries images.
 */
export function toOpenAIContent(
	msg: Message
): string | OpenAI.Chat.Completions.ChatCompletionContentPart[] {
	if (!msg.images || msg.images.length === 0) {
		return msg.content;
	}
	const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
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
export function toOpenAIMessages(
	messages: Message[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
	return messages.map((msg): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
		if (msg.role === 'tool') {
			if (!msg.toolCallId) {
				throw new APIError(
					"Tool-result message is missing 'toolCallId'; it must reference the ToolCall.id it answers.",
					400
				);
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
					type: 'function' as const,
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
		} as OpenAI.Chat.Completions.ChatCompletionMessageParam;
	});
}

/**
 * Converts toolkit tool definitions to OpenAI `function` tools. Zod schemas
 * become inline JSON Schema (no `$ref` indirection — maximum server
 * compatibility, matching the Ollama structured-output path).
 */
export function toOpenAITools(
	tools: ToolDefinition[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
	return tools.map((tool) => ({
		type: 'function' as const,
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

/** Minimal structural type: the slice of an OpenAI assistant message we read tool calls from. */
interface OpenAIToolCallCarrier {
	tool_calls?: Array<{
		id: string;
		type: string;
		function: { name: string; arguments: string };
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
export function fromOpenAIToolCalls(
	message: OpenAIToolCallCarrier | undefined
): ToolCall[] | undefined {
	const toolCalls = message?.tool_calls;
	if (!toolCalls || toolCalls.length === 0) {
		return undefined;
	}
	return toolCalls.map((call) => {
		let args: Record<string, unknown>;
		try {
			args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
		} catch {
			throw new APIError(
				`Model returned invalid JSON arguments for tool '${call.function.name}'.`,
				502,
				{ tool: call.function.name, raw: call.function.arguments.slice(0, 200) }
			);
		}
		return { id: call.id, name: call.function.name, arguments: args };
	});
}

/**
 * Normalizes OpenAI `finish_reason` into the toolkit {@link StopReason}.
 * Unknown reasons map to `'other'`; absent reasons map to `undefined`.
 */
export function mapOpenAIFinishReason(
	reason: string | null | undefined
): StopReason | undefined {
	if (reason == null) return undefined;
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
