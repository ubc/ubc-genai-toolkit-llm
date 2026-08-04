import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { NoopLogger } from 'ubc-genai-toolkit-core';
import type { Message } from '../src/types';

const createMock = vi.fn();
const parseMock = vi.fn();

vi.mock('openai', () => {
	class MockAPIError extends Error {
		status = 500;
	}
	class MockOpenAI {
		static APIError = MockAPIError;
		chat = { completions: { create: createMock } };
		beta = { chat: { completions: { parse: parseMock } } };
		models = { list: vi.fn() };
		embeddings = { create: vi.fn() };
	}
	return { default: MockOpenAI };
});

vi.mock('openai/helpers/zod', () => ({
	zodResponseFormat: vi.fn(() => ({ type: 'json_schema' })),
}));

import { OpenAIProvider } from '../src/providers/openai-provider';

function makeProvider(defaultModel = 'gpt-4o') {
	return new OpenAIProvider('sk-test', defaultModel, new NoopLogger());
}

const calculator = {
	name: 'calculator',
	description: 'Evaluate arithmetic.',
	parameters: z.object({ expression: z.string() }),
};

function mockStopResponse(model = 'gpt-4o') {
	return {
		id: 'chatcmpl-1',
		created: 1,
		model,
		choices: [
			{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } },
		],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	};
}

beforeEach(() => {
	createMock.mockReset();
	parseMock.mockReset();
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

	it('maps reasoningEffort and keeps tools without leaking camelCase keys into rest', async () => {
		createMock.mockResolvedValue(mockStopResponse('gpt-5-mini'));

		const provider = makeProvider();
		await provider.sendConversation(
			[{ role: 'user', content: 'Explain quicksort.' }],
			{
				model: 'gpt-5-mini',
				tools: [calculator],
				reasoningEffort: 'low',
				maxTokens: 1024,
			}
		);

		const params = createMock.mock.calls[0][0];
		expect(params.reasoning_effort).toBe('low');
		expect(params.max_completion_tokens).toBe(1024);
		expect(params.tools[0].function.name).toBe('calculator');
		expect(params.reasoningEffort).toBeUndefined();
		expect(params.toolChoice).toBeUndefined();
	});
});

describe('OpenAIProvider option mapping', () => {
	it('preserves BiocBot snake_case reasoning_effort and max_completion_tokens', async () => {
		createMock.mockResolvedValue(mockStopResponse('gpt-5-nano'));

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
	});

	it('preserves BiocBot raw response_format passthrough', async () => {
		createMock.mockResolvedValue(mockStopResponse('gpt-5-nano'));

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

	it('maps older model maxTokens to max_tokens without reasoning', async () => {
		createMock.mockResolvedValue(mockStopResponse('gpt-4.1-mini'));

		const provider = makeProvider();
		await provider.sendConversation(
			[{ role: 'user', content: 'hi' }],
			{ model: 'gpt-4.1-mini', maxTokens: 1000 }
		);

		const params = createMock.mock.calls[0][0];
		expect(params.max_tokens).toBe(1000);
		expect(params.max_completion_tokens).toBeUndefined();
		expect(params.reasoning_effort).toBeUndefined();
	});

	it('maps GPT-5 camelCase reasoningEffort and maxTokens to wire fields', async () => {
		createMock.mockResolvedValue(mockStopResponse('gpt-5-nano'));

		const provider = makeProvider();
		await provider.sendConversation(
			[{ role: 'user', content: 'hi' }],
			{ model: 'gpt-5-nano', reasoningEffort: 'low', maxTokens: 2000 }
		);

		const params = createMock.mock.calls[0][0];
		expect(params.reasoning_effort).toBe('low');
		expect(params.max_completion_tokens).toBe(2000);
		expect(params.max_tokens).toBeUndefined();
	});

	it('prefers camelCase when both aliases are supplied', async () => {
		createMock.mockResolvedValue(mockStopResponse('gpt-5-nano'));

		const provider = makeProvider();
		await provider.sendConversation(
			[{ role: 'user', content: 'hi' }],
			{
				model: 'gpt-5-nano',
				reasoningEffort: 'high',
				reasoning_effort: 'low',
				maxTokens: 111,
				max_completion_tokens: 999,
			} as any
		);

		const params = createMock.mock.calls[0][0];
		expect(params.reasoning_effort).toBe('high');
		expect(params.max_completion_tokens).toBe(111);
	});

	it('rejects unsupported model/effort combinations with a clear APIError', async () => {
		const provider = makeProvider();
		await expect(
			provider.sendConversation(
				[{ role: 'user', content: 'hi' }],
				{ model: 'gpt-4.1-mini', reasoningEffort: 'low' }
			)
		).rejects.toThrowError(/does not support reasoningEffort/);
	});

	it('applies the same mapping on structured and streaming calls', async () => {
		parseMock.mockResolvedValue({
			id: 'chatcmpl-structured',
			created: 1,
			model: 'gpt-5-nano',
			choices: [
				{
					finish_reason: 'stop',
					message: {
						role: 'assistant',
						content: '{"a":"b"}',
						parsed: { a: 'b' },
					},
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		});

		async function* fakeStream() {
			yield { choices: [{ delta: { content: 'x' }, finish_reason: null }] };
			yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
		}
		createMock.mockResolvedValue(fakeStream());

		const provider = makeProvider();
		await provider.sendStructuredConversation(
			[{ role: 'user', content: 'hi' }],
			z.object({ a: z.string() }),
			{ model: 'gpt-5-nano', reasoningEffort: 'minimal', maxTokens: 50 }
		);
		expect(parseMock.mock.calls[0][0].reasoning_effort).toBe('minimal');
		expect(parseMock.mock.calls[0][0].max_completion_tokens).toBe(50);
		expect(parseMock.mock.calls[0][0].stream).toBe(false);

		await provider.streamConversation(
			[{ role: 'user', content: 'hi' }],
			() => {},
			{ model: 'gpt-5-nano', reasoningEffort: 'low', maxTokens: 75 }
		);
		expect(createMock.mock.calls[0][0].reasoning_effort).toBe('low');
		expect(createMock.mock.calls[0][0].max_completion_tokens).toBe(75);
		expect(createMock.mock.calls[0][0].stream).toBe(true);
	});

	it('does not let passthrough fields override model, messages, or stream', async () => {
		createMock.mockResolvedValue(mockStopResponse('gpt-4o'));

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
