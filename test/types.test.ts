import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type {
	Message,
	ToolDefinition,
	ToolCall,
	LLMOptions,
	LLMResponse,
	StopReason,
} from '../src/types';

describe('tool-calling types', () => {
	it('allows a tool-role message carrying a toolCallId', () => {
		const msg: Message = {
			role: 'tool',
			content: '127.05',
			toolCallId: 'call_abc',
		};
		expect(msg.role).toBe('tool');
	});

	it('allows an assistant message carrying toolCalls', () => {
		const call: ToolCall = {
			id: 'call_abc',
			name: 'calculator',
			arguments: { expression: '847 * 0.15' },
		};
		const msg: Message = { role: 'assistant', content: '', toolCalls: [call] };
		expect(msg.toolCalls).toHaveLength(1);
	});

	it('allows tools and toolChoice on LLMOptions and toolCalls/stopReason on LLMResponse', () => {
		const tool: ToolDefinition = {
			name: 'calculator',
			description: 'Evaluate an arithmetic expression.',
			parameters: z.object({ expression: z.string() }),
		};
		const options: LLMOptions = { tools: [tool], toolChoice: 'auto' };
		const stop: StopReason = 'tool_calls';
		const response: LLMResponse = {
			content: '',
			model: 'test',
			toolCalls: [{ id: 'x', name: 'calculator', arguments: {} }],
			stopReason: stop,
		};
		expect(options.tools).toHaveLength(1);
		expect(response.stopReason).toBe('tool_calls');
	});
});
