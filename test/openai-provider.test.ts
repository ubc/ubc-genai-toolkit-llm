import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { NoopLogger } from 'ubc-genai-toolkit-core';
import type { Message } from '../src/types';

const createMock = vi.fn();

vi.mock('openai', () => {
	class MockAPIError extends Error {
		status = 500;
	}
	class MockOpenAI {
		static APIError = MockAPIError;
		chat = { completions: { create: createMock } };
		beta = { chat: { completions: { parse: vi.fn() } } };
		models = { list: vi.fn() };
		embeddings = { create: vi.fn() };
	}
	return { default: MockOpenAI };
});

vi.mock('openai/helpers/zod', () => ({
	zodResponseFormat: vi.fn(() => ({ type: 'json_schema' })),
}));

import { OpenAIProvider } from '../src/providers/openai-provider';

function makeProvider() {
	return new OpenAIProvider('sk-test', 'gpt-4o', new NoopLogger());
}

const calculator = {
	name: 'calculator',
	description: 'Evaluate arithmetic.',
	parameters: z.object({ expression: z.string() }),
};

beforeEach(() => {
	createMock.mockReset();
});

describe('OpenAIProvider tool calling', () => {
	it('passes translated tools and tool_choice to the SDK and normalizes toolCalls/stopReason', async () => {
		createMock.mockResolvedValue({
			id: 'chatcmpl-1',
			created: 1,
			model: 'gpt-4o',
			choices: [
				{
					finish_reason: 'tool_calls',
					message: {
						role: 'assistant',
						content: null,
						tool_calls: [
							{
								id: 'call_1',
								type: 'function',
								function: { name: 'calculator', arguments: '{"expression":"1+1"}' },
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		});

		const provider = makeProvider();
		const response = await provider.sendConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			{ tools: [calculator], toolChoice: 'auto' }
		);

		const params = createMock.mock.calls[0][0];
		expect(params.tools[0].function.name).toBe('calculator');
		expect(params.tool_choice).toBe('auto');
		// tools/toolChoice must NOT leak through `rest` as raw toolkit objects
		expect(params.toolChoice).toBeUndefined();

		expect(response.toolCalls).toEqual([
			{ id: 'call_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
		expect(response.content).toBe('');
	});

	it('sends tool-result messages in OpenAI format', async () => {
		createMock.mockResolvedValue({
			id: 'chatcmpl-2',
			created: 1,
			model: 'gpt-4o',
			choices: [
				{ finish_reason: 'stop', message: { role: 'assistant', content: '2' } },
			],
		});
		const provider = makeProvider();
		const history: Message[] = [
			{ role: 'user', content: 'What is 1+1?' },
			{
				role: 'assistant',
				content: '',
				toolCalls: [{ id: 'call_1', name: 'calculator', arguments: { expression: '1+1' } }],
			},
			{ role: 'tool', content: '2', toolCallId: 'call_1' },
		];
		const response = await provider.sendConversation(history, { tools: [calculator] });

		const params = createMock.mock.calls[0][0];
		expect(params.messages[1].tool_calls[0].id).toBe('call_1');
		expect(params.messages[2]).toEqual({
			role: 'tool',
			tool_call_id: 'call_1',
			content: '2',
		});
		expect(response.stopReason).toBe('stop');
		expect(response.toolCalls).toBeUndefined();
	});

	it('accumulates streamed tool-call deltas into the final response', async () => {
		async function* fakeStream() {
			yield {
				choices: [
					{
						delta: {
							tool_calls: [
								{ index: 0, id: 'call_1', function: { name: 'calculator', arguments: '{"expr' } },
							],
						},
					},
				],
			};
			yield {
				choices: [
					{
						delta: {
							tool_calls: [{ index: 0, function: { arguments: 'ession":"1+1"}' } }],
						},
					},
				],
			};
			yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
		}
		createMock.mockResolvedValue(fakeStream());

		const provider = makeProvider();
		const chunks: string[] = [];
		const response = await provider.streamConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			(c) => chunks.push(c),
			{ tools: [calculator] }
		);

		expect(chunks).toEqual([]); // no text deltas in this stream
		expect(response.toolCalls).toEqual([
			{ id: 'call_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});

	it('rejects tools on the structured path', async () => {
		const provider = makeProvider();
		await expect(
			provider.sendStructuredConversation(
				[{ role: 'user', content: 'x' }],
				z.object({ a: z.string() }),
				{ tools: [calculator] }
			)
		).rejects.toThrowError(/structured/i);
	});
});
