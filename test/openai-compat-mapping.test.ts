import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
	separateOpenAIOptions,
	toOpenAIMessages,
	toOpenAITools,
	fromOpenAIToolCalls,
	mapOpenAIFinishReason,
} from '../src/providers/openai-compat-mapping';
import type { Message } from '../src/types';

describe('separateOpenAIOptions', () => {
	it('strips toolkit-managed fields (including tools/toolChoice) out of rest', () => {
		const { rest } = separateOpenAIOptions({
			model: 'gpt-4o',
			temperature: 0.5,
			tools: [
				{ name: 't', description: 'd', parameters: z.object({}) },
			],
			toolChoice: 'auto',
			custom_param: 42,
		});
		expect(rest).toEqual({ custom_param: 42 });
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
