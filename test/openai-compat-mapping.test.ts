import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
	separateOpenAIOptions,
	getOpenAIReasoningCapability,
	buildOpenAICompatCompletionFields,
	toOpenAIMessages,
	toOpenAITools,
	fromOpenAIToolCalls,
	mapOpenAIFinishReason,
} from '../src/providers/openai-compat-mapping';
import type { Message } from '../src/types';

describe('separateOpenAIOptions', () => {
	it('strips toolkit-managed fields (including tools/toolChoice/reasoningEffort) out of rest', () => {
		const { rest } = separateOpenAIOptions({
			model: 'gpt-4o',
			temperature: 0.5,
			reasoningEffort: 'low',
			tools: [
				{ name: 't', description: 'd', parameters: z.object({}) },
			],
			toolChoice: 'auto',
			custom_param: 42,
		});
		expect(rest).toEqual({ custom_param: 42 });
	});

	it('strips raw aliases from rest but retains normalized values in known', () => {
		const { known, rest } = separateOpenAIOptions({
			model: 'gpt-5-mini',
			reasoning_effort: 'low',
			max_completion_tokens: 1024,
			custom_param: 1,
		} as any);
		expect(rest).toEqual({ custom_param: 1 });
		expect(known.reasoningEffort).toBe('low');
		expect(known.maxTokens).toBe(1024);
	});

	it('prefers camelCase when both aliases are supplied', () => {
		const { known, rest } = separateOpenAIOptions({
			reasoningEffort: 'high',
			reasoning_effort: 'low',
			maxTokens: 500,
			max_completion_tokens: 2000,
			max_tokens: 100,
			passthrough: true,
		} as any);
		expect(known.reasoningEffort).toBe('high');
		expect(known.maxTokens).toBe(500);
		expect(rest).toEqual({ passthrough: true });
	});

	it('strips max_tokens from rest and folds it into known.maxTokens', () => {
		const { known, rest } = separateOpenAIOptions({
			max_tokens: 777,
			other: 1,
		} as any);
		expect(known.maxTokens).toBe(777);
		expect(rest).toEqual({ other: 1 });
	});
});

describe('getOpenAIReasoningCapability', () => {
	it('marks classic chat models as unsupported', () => {
		expect(getOpenAIReasoningCapability('gpt-4.1-mini')).toBe('unsupported');
		expect(getOpenAIReasoningCapability('gpt-4o')).toBe('unsupported');
	});

	it('marks gpt-5 and o-series as optional', () => {
		expect(getOpenAIReasoningCapability('gpt-5-nano')).toBe('optional');
		expect(getOpenAIReasoningCapability('gpt-5-mini')).toBe('optional');
		expect(getOpenAIReasoningCapability('o1-mini')).toBe('optional');
		expect(getOpenAIReasoningCapability('o3')).toBe('optional');
		expect(getOpenAIReasoningCapability('o4-mini')).toBe('optional');
	});
});

describe('buildOpenAICompatCompletionFields', () => {
	it('maps maxTokens to max_tokens for older models and omits reasoning', () => {
		const fields = buildOpenAICompatCompletionFields('gpt-4.1-mini', {
			maxTokens: 1000,
			temperature: 0.2,
		});
		expect(fields).toEqual({
			temperature: 0.2,
			max_tokens: 1000,
		});
	});

	it('maps maxTokens to max_completion_tokens for GPT-5 and sends reasoning when requested', () => {
		const fields = buildOpenAICompatCompletionFields('gpt-5-nano', {
			maxTokens: 2000,
			reasoningEffort: 'low',
		});
		expect(fields).toEqual({
			max_completion_tokens: 2000,
			reasoning_effort: 'low',
		});
	});

	it('omits reasoning_effort for optional models when not requested', () => {
		const fields = buildOpenAICompatCompletionFields('gpt-5-mini', {
			maxTokens: 100,
		});
		expect(fields.reasoning_effort).toBeUndefined();
		expect(fields.max_completion_tokens).toBe(100);
	});

	it('throws APIError when reasoning is requested on an unsupported model', () => {
		expect(() =>
			buildOpenAICompatCompletionFields('gpt-4.1-mini', {
				reasoningEffort: 'low',
			})
		).toThrowError(/does not support reasoningEffort/);
	});

	it('throws APIError for an invalid effort value on a reasoning model', () => {
		expect(() =>
			buildOpenAICompatCompletionFields('gpt-5-nano', {
				reasoningEffort: 'super-high' as any,
			})
		).toThrowError(/Unsupported reasoningEffort/);
	});
});

describe('toOpenAIMessages', () => {
	it('maps an assistant message with toolCalls to tool_calls with stringified arguments', () => {
		const messages: Message[] = [
			{ role: 'user', content: 'What is 15% of 847?' },
			{
				role: 'assistant',
				content: '',
				toolCalls: [
					{ id: 'call_1', name: 'calculator', arguments: { expression: '847*0.15' } },
				],
			},
		];
		const out = toOpenAIMessages(messages);
		expect(out[1]).toEqual({
			role: 'assistant',
			content: null,
			tool_calls: [
				{
					id: 'call_1',
					type: 'function',
					function: { name: 'calculator', arguments: '{"expression":"847*0.15"}' },
				},
			],
		});
	});

	it('maps a tool message to role tool with tool_call_id', () => {
		const out = toOpenAIMessages([
			{ role: 'tool', content: '127.05', toolCallId: 'call_1' },
		]);
		expect(out[0]).toEqual({
			role: 'tool',
			tool_call_id: 'call_1',
			content: '127.05',
		});
	});

	it('throws APIError 400 when a tool message is missing toolCallId', () => {
		expect(() =>
			toOpenAIMessages([{ role: 'tool', content: 'x' }])
		).toThrowError(/toolCallId/);
	});

	it('leaves plain user/system messages unchanged', () => {
		const out = toOpenAIMessages([
			{ role: 'system', content: 'be nice' },
			{ role: 'user', content: 'hi' },
		]);
		expect(out).toEqual([
			{ role: 'system', content: 'be nice' },
			{ role: 'user', content: 'hi' },
		]);
	});
});

describe('toOpenAITools', () => {
	it('converts a Zod schema into a function tool with JSON Schema parameters', () => {
		const tools = toOpenAITools([
			{
				name: 'calculator',
				description: 'Evaluate arithmetic.',
				parameters: z.object({ expression: z.string() }),
			},
		]);
		expect(tools[0].type).toBe('function');
		expect(tools[0].function.name).toBe('calculator');
		expect(tools[0].function.description).toBe('Evaluate arithmetic.');
		const params = tools[0].function.parameters as Record<string, any>;
		expect(params.type).toBe('object');
		expect(params.properties.expression.type).toBe('string');
	});
});

describe('fromOpenAIToolCalls', () => {
	it('parses tool_calls JSON arguments into ToolCall objects', () => {
		const calls = fromOpenAIToolCalls({
			tool_calls: [
				{
					id: 'call_1',
					type: 'function',
					function: { name: 'calculator', arguments: '{"expression":"1+1"}' },
				},
			],
		});
		expect(calls).toEqual([
			{ id: 'call_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
	});

	it('returns undefined when there are no tool calls', () => {
		expect(fromOpenAIToolCalls({})).toBeUndefined();
		expect(fromOpenAIToolCalls(undefined)).toBeUndefined();
	});

	it('throws APIError when arguments are not valid JSON', () => {
		expect(() =>
			fromOpenAIToolCalls({
				tool_calls: [
					{ id: 'x', type: 'function', function: { name: 'f', arguments: '{oops' } },
				],
			})
		).toThrowError(/JSON/);
	});
});

describe('mapOpenAIFinishReason', () => {
	it('maps finish reasons to normalized StopReason', () => {
		expect(mapOpenAIFinishReason('stop')).toBe('stop');
		expect(mapOpenAIFinishReason('tool_calls')).toBe('tool_calls');
		expect(mapOpenAIFinishReason('function_call')).toBe('tool_calls');
		expect(mapOpenAIFinishReason('length')).toBe('length');
		expect(mapOpenAIFinishReason('content_filter')).toBe('other');
		expect(mapOpenAIFinishReason(null)).toBeUndefined();
		expect(mapOpenAIFinishReason(undefined)).toBeUndefined();
	});
});
