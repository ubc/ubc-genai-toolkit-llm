import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
	toOllamaMessages,
	toOllamaTools,
	fromOllamaToolCalls,
	mapOllamaDoneReason,
} from '../src/providers/ollama-mapping';
import type { Message } from '../src/types';

describe('toOllamaMessages', () => {
	it('maps assistant toolCalls to Ollama tool_calls (arguments stay objects)', () => {
		const messages: Message[] = [
			{
				role: 'assistant',
				content: '',
				toolCalls: [
					{ id: 'ollama_call_0', name: 'calculator', arguments: { expression: '1+1' } },
				],
			},
		];
		expect(toOllamaMessages(messages)).toEqual([
			{
				role: 'assistant',
				content: '',
				tool_calls: [
					{ function: { name: 'calculator', arguments: { expression: '1+1' } } },
				],
			},
		]);
	});

	it('maps tool messages to role tool (no id — Ollama matches by order)', () => {
		expect(
			toOllamaMessages([{ role: 'tool', content: '2', toolCallId: 'ollama_call_0' }])
		).toEqual([{ role: 'tool', content: '2' }]);
	});

	it('passes plain messages (and images) through', () => {
		const out = toOllamaMessages([
			{ role: 'user', content: 'hi', images: [{ data: 'AAA', mimeType: 'image/png' }] },
		]);
		expect(out).toEqual([{ role: 'user', content: 'hi', images: ['AAA'] }]);
	});
});

describe('toOllamaTools', () => {
	it('produces function tools with JSON Schema parameters', () => {
		const tools = toOllamaTools([
			{
				name: 'calculator',
				description: 'Evaluate arithmetic.',
				parameters: z.object({ expression: z.string() }),
			},
		]) as any[];
		expect(tools[0].type).toBe('function');
		expect(tools[0].function.name).toBe('calculator');
		expect(tools[0].function.parameters.type).toBe('object');
	});
});

describe('fromOllamaToolCalls', () => {
	it('synthesizes ids since Ollama provides none', () => {
		const calls = fromOllamaToolCalls([
			{ function: { name: 'calculator', arguments: { expression: '1+1' } } },
			{ function: { name: 'datetime', arguments: {} } },
		]);
		expect(calls).toEqual([
			{ id: 'ollama_call_0', name: 'calculator', arguments: { expression: '1+1' } },
			{ id: 'ollama_call_1', name: 'datetime', arguments: {} },
		]);
	});

	it('returns undefined when there are none', () => {
		expect(fromOllamaToolCalls(undefined)).toBeUndefined();
		expect(fromOllamaToolCalls([])).toBeUndefined();
	});
});

describe('mapOllamaDoneReason', () => {
	it('reports tool_calls when tool calls are present (Ollama says stop either way)', () => {
		expect(mapOllamaDoneReason('stop', true)).toBe('tool_calls');
		expect(mapOllamaDoneReason('stop', false)).toBe('stop');
		expect(mapOllamaDoneReason('length', false)).toBe('length');
		expect(mapOllamaDoneReason('weird', false)).toBe('other');
		expect(mapOllamaDoneReason(undefined, false)).toBeUndefined();
		expect(mapOllamaDoneReason(undefined, true)).toBe('tool_calls');
	});
});
