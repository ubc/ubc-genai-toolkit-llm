import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
	toAnthropicMessages,
	toAnthropicTools,
	toAnthropicToolChoice,
	fromAnthropicToolUse,
	mapAnthropicStopReason,
} from '../src/providers/anthropic-mapping';
import type { Message } from '../src/types';

describe('toAnthropicMessages', () => {
	it('filters system messages (they belong in the top-level system param)', () => {
		const out = toAnthropicMessages([
			{ role: 'system', content: 'be nice' },
			{ role: 'user', content: 'hi' },
		]);
		expect(out).toEqual([{ role: 'user', content: 'hi' }]);
	});

	it('maps assistant toolCalls to tool_use content blocks (text block only when content is non-empty)', () => {
		const messages: Message[] = [
			{
				role: 'assistant',
				content: 'Let me calculate.',
				toolCalls: [
					{ id: 'toolu_1', name: 'calculator', arguments: { expression: '1+1' } },
				],
			},
		];
		expect(toAnthropicMessages(messages)).toEqual([
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Let me calculate.' },
					{ type: 'tool_use', id: 'toolu_1', name: 'calculator', input: { expression: '1+1' } },
				],
			},
		]);
	});

	it('maps tool messages to user tool_result blocks and merges consecutive results into one user turn', () => {
		const out = toAnthropicMessages([
			{ role: 'tool', content: '2', toolCallId: 'toolu_1' },
			{ role: 'tool', content: '4', toolCallId: 'toolu_2' },
		]);
		// Parallel tool results MUST land in a single user message.
		expect(out).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'tool_result', tool_use_id: 'toolu_1', content: '2' },
					{ type: 'tool_result', tool_use_id: 'toolu_2', content: '4' },
				],
			},
		]);
	});

	it('throws when a tool message is missing toolCallId', () => {
		expect(() =>
			toAnthropicMessages([{ role: 'tool', content: 'x' }])
		).toThrowError(/toolCallId/);
	});
});

describe('toAnthropicTools', () => {
	it('produces name/description/input_schema tools', () => {
		const tools = toAnthropicTools([
			{
				name: 'calculator',
				description: 'Evaluate arithmetic.',
				parameters: z.object({ expression: z.string() }),
			},
		]);
		expect(tools[0].name).toBe('calculator');
		expect(tools[0].description).toBe('Evaluate arithmetic.');
		expect((tools[0].input_schema as any).type).toBe('object');
		expect((tools[0].input_schema as any).properties.expression.type).toBe('string');
	});
});

describe('toAnthropicToolChoice', () => {
	it('maps toolkit choices to Anthropic tool_choice objects', () => {
		expect(toAnthropicToolChoice('auto')).toEqual({ type: 'auto' });
		expect(toAnthropicToolChoice('required')).toEqual({ type: 'any' });
		expect(toAnthropicToolChoice('none')).toEqual({ type: 'none' });
		expect(toAnthropicToolChoice(undefined)).toBeUndefined();
	});
});

describe('fromAnthropicToolUse', () => {
	it('extracts tool_use blocks as ToolCalls', () => {
		const calls = fromAnthropicToolUse([
			{ type: 'text', text: 'Let me check.' },
			{ type: 'tool_use', id: 'toolu_1', name: 'calculator', input: { expression: '1+1' } },
		]);
		expect(calls).toEqual([
			{ id: 'toolu_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
	});

	it('returns undefined when there are none', () => {
		expect(fromAnthropicToolUse([{ type: 'text', text: 'hi' }])).toBeUndefined();
	});
});

describe('mapAnthropicStopReason', () => {
	it('maps stop reasons to normalized StopReason', () => {
		expect(mapAnthropicStopReason('end_turn')).toBe('stop');
		expect(mapAnthropicStopReason('stop_sequence')).toBe('stop');
		expect(mapAnthropicStopReason('tool_use')).toBe('tool_calls');
		expect(mapAnthropicStopReason('max_tokens')).toBe('length');
		expect(mapAnthropicStopReason('refusal')).toBe('other');
		expect(mapAnthropicStopReason(null)).toBeUndefined();
	});
});
