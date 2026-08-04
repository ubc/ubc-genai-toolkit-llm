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

function makeProvider(defaultModel = 'llama3.1') {
	return new UbcLlmSandboxProvider(
		'key',
		'https://sandbox.example.ca/v1',
		defaultModel,
		new NoopLogger()
	);
}

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
		const provider = makeProvider();
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

		const provider = makeProvider();
		const chunks: string[] = [];
		await provider.streamConversation(
			[{ role: 'user', content: 'hi' }],
			(c) => chunks.push(c),
			{ model: 'gpt-5-mini', tools: [calculator], reasoningEffort: 'low' }
		);

		const params = createMock.mock.calls[0][0];
		expect(params.reasoning_effort).toBe('low');
		expect(params.tools[0].function.name).toBe('calculator');
		expect(params.reasoningEffort).toBeUndefined();
		expect(params.toolChoice).toBeUndefined();
		expect(chunks).toEqual(['hi']);
	});
});

describe('UbcLlmSandboxProvider option mapping', () => {
	it('preserves BiocBot snake_case fields on sendConversation', async () => {
		createMock.mockResolvedValue({
			id: 'x',
			created: 1,
			model: 'gpt-5-nano',
			choices: [
				{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } },
			],
		});

		const provider = makeProvider();
		await provider.sendConversation(
			[{ role: 'user', content: 'hi' }],
			{
				model: 'gpt-5-nano',
				reasoning_effort: 'low',
				max_completion_tokens: 2000,
			} as any
		);

		const params = createMock.mock.calls[0][0];
		expect(params.reasoning_effort).toBe('low');
		expect(params.max_completion_tokens).toBe(2000);
		expect(params.max_tokens).toBeUndefined();
		expect(params.stream).toBe(false);
	});

	it('preserves BiocBot raw response_format passthrough', async () => {
		createMock.mockResolvedValue({
			id: 'x',
			created: 1,
			model: 'gpt-5-nano',
			choices: [
				{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } },
			],
		});

		const provider = makeProvider();

		await provider.sendConversation(
			[{ role: 'user', content: 'generate JSON' }],
			{
				model: 'gpt-5-nano',
				reasoning_effort: 'low',
				max_completion_tokens: 4000,
				response_format: { type: 'json_object' },
			} as any
		);

		const params = createMock.mock.calls[0][0];

		expect(params.response_format).toEqual({
			type: 'json_object',
		});
	});

	it('maps older-model maxTokens to max_tokens on stream', async () => {
		async function* fakeStream() {
			yield { choices: [{ delta: { content: 'a' }, finish_reason: null }] };
			yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
		}
		createMock.mockResolvedValue(fakeStream());

		const provider = makeProvider();
		await provider.streamConversation(
			[{ role: 'user', content: 'hi' }],
			() => {},
			{ model: 'gpt-4.1-mini', maxTokens: 1000 }
		);

		const params = createMock.mock.calls[0][0];
		expect(params.max_tokens).toBe(1000);
		expect(params.max_completion_tokens).toBeUndefined();
		expect(params.reasoning_effort).toBeUndefined();
		expect(params.stream).toBe(true);
	});

	it('does not let passthrough override model, messages, or stream', async () => {
		createMock.mockResolvedValue({
			id: 'x',
			created: 1,
			model: 'gpt-4o',
			choices: [
				{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } },
			],
		});

		const provider = makeProvider();
		const messages: Message[] = [{ role: 'user', content: 'real' }];
		await provider.sendConversation(messages, {
			model: 'gpt-4o',
			messages: [{ role: 'user', content: 'hijack' }],
			stream: true,
		} as any);

		const params = createMock.mock.calls[0][0];
		expect(params.model).toBe('gpt-4o');
		expect(params.messages).toEqual([{ role: 'user', content: 'real' }]);
		expect(params.stream).toBe(false);
	});
});
