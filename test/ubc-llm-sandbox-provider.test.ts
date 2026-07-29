import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { NoopLogger } from 'ubc-genai-toolkit-core';

const createMock = vi.fn();

vi.mock('openai', () => {
	class MockAPIError extends Error {
		status = 500;
	}
	class MockOpenAI {
		static APIError = MockAPIError;
		chat = { completions: { create: createMock } };
		models = { list: vi.fn() };
		post = vi.fn();
	}
	return { default: MockOpenAI };
});

import { UbcLlmSandboxProvider } from '../src/providers/ubc-llm-sandbox-provider';

const calculator = {
	name: 'calculator',
	description: 'Evaluate arithmetic.',
	parameters: z.object({ expression: z.string() }),
};

beforeEach(() => createMock.mockReset());

describe('UbcLlmSandboxProvider tool calling', () => {
	it('passes translated tools to the SDK and normalizes toolCalls/stopReason', async () => {
		createMock.mockResolvedValue({
			id: 'x',
			created: 1,
			model: 'llama3.1',
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
								function: { name: 'calculator', arguments: '{"expression":"2*3"}' },
							},
						],
					},
				},
			],
		});
		const provider = new UbcLlmSandboxProvider(
			'key',
			'https://sandbox.example.ca/v1',
			'llama3.1',
			new NoopLogger()
		);
		const response = await provider.sendConversation(
			[{ role: 'user', content: '2*3?' }],
			{ tools: [calculator] }
		);
		expect(createMock.mock.calls[0][0].tools[0].function.name).toBe('calculator');
		expect(response.toolCalls).toEqual([
			{ id: 'call_1', name: 'calculator', arguments: { expression: '2*3' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});

	it('maps reasoningEffort with tools on stream without leaking camelCase keys', async () => {
		async function* fakeStream() {
			yield { choices: [{ delta: { content: 'hi' }, finish_reason: null }] };
			yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
		}
		createMock.mockResolvedValue(fakeStream());

		const provider = new UbcLlmSandboxProvider(
			'key',
			'https://sandbox.example.ca/v1',
			'llama3.1',
			new NoopLogger()
		);
		const chunks: string[] = [];
		await provider.streamConversation(
			[{ role: 'user', content: 'hi' }],
			(c) => chunks.push(c),
			{ tools: [calculator], reasoningEffort: 'low' }
		);

		const params = createMock.mock.calls[0][0];
		expect(params.reasoning_effort).toBe('low');
		expect(params.tools[0].function.name).toBe('calculator');
		expect(params.reasoningEffort).toBeUndefined();
		expect(params.toolChoice).toBeUndefined();
		expect(chunks).toEqual(['hi']);
	});
});
