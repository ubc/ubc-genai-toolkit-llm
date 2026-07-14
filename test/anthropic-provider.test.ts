import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { NoopLogger } from 'ubc-genai-toolkit-core';

const createMock = vi.fn();
const parseMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
	class MockAPIError extends Error {
		status = 500;
	}
	class MockAnthropic {
		static APIError = MockAPIError;
		messages = { create: createMock, parse: parseMock };
		models = { list: vi.fn() };
	}
	return { default: MockAnthropic };
});

vi.mock('@anthropic-ai/sdk/helpers/zod', () => ({
	zodOutputFormat: vi.fn(() => ({ type: 'json_schema' })),
}));

import { AnthropicProvider } from '../src/providers/anthropic-provider';

const calculator = {
	name: 'calculator',
	description: 'Evaluate arithmetic.',
	parameters: z.object({ expression: z.string() }),
};

beforeEach(() => {
	createMock.mockReset();
	parseMock.mockReset();
});

describe('AnthropicProvider tool calling', () => {
	it('passes translated tools/tool_choice and normalizes tool_use blocks + stop_reason', async () => {
		createMock.mockResolvedValue({
			id: 'msg_1',
			model: 'claude-x',
			stop_reason: 'tool_use',
			stop_sequence: null,
			content: [
				{ type: 'text', text: 'Let me calculate.' },
				{ type: 'tool_use', id: 'toolu_1', name: 'calculator', input: { expression: '1+1' } },
			],
			usage: { input_tokens: 10, output_tokens: 5 },
		});

		const provider = new AnthropicProvider('key', 'claude-x', new NoopLogger());
		const response = await provider.sendConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			{ tools: [calculator], toolChoice: 'required' }
		);

		const params = createMock.mock.calls[0][0];
		expect(params.tools[0].name).toBe('calculator');
		expect(params.tool_choice).toEqual({ type: 'any' });
		expect(params.toolChoice).toBeUndefined(); // must not leak via rest

		expect(response.toolCalls).toEqual([
			{ id: 'toolu_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
		expect(response.content).toBe('Let me calculate.');
	});

	it('accumulates streamed tool_use input_json_delta into the final response', async () => {
		async function* fakeStream() {
			yield {
				type: 'content_block_start',
				index: 0,
				content_block: { type: 'tool_use', id: 'toolu_1', name: 'calculator' },
			};
			yield {
				type: 'content_block_delta',
				index: 0,
				delta: { type: 'input_json_delta', partial_json: '{"expres' },
			};
			yield {
				type: 'content_block_delta',
				index: 0,
				delta: { type: 'input_json_delta', partial_json: 'sion":"1+1"}' },
			};
			yield { type: 'content_block_stop', index: 0 };
			yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: {} };
		}
		createMock.mockResolvedValue(fakeStream());

		const provider = new AnthropicProvider('key', 'claude-x', new NoopLogger());
		const chunks: string[] = [];
		const response = await provider.streamConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			(c) => chunks.push(c),
			{ tools: [calculator] }
		);

		expect(chunks).toEqual([]);
		expect(response.toolCalls).toEqual([
			{ id: 'toolu_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});

	it('rejects tools on the structured path', async () => {
		const provider = new AnthropicProvider('key', 'claude-x', new NoopLogger());
		await expect(
			provider.sendStructuredConversation(
				[{ role: 'user', content: 'x' }],
				z.object({ a: z.string() }),
				{ tools: [calculator] }
			)
		).rejects.toThrowError(/structured/i);
	});
});
