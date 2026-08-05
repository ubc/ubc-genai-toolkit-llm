import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { NoopLogger } from 'ubc-genai-toolkit-core';
import type { Message } from '../src/types';

const createMock = vi.fn();
const clientOptions: any[] = [];

vi.mock('openai', () => {
	class MockAPIError extends Error {
		status = 500;
	}
	class MockOpenAI {
		static APIError = MockAPIError;
		chat = { completions: { create: createMock } };
		models = { list: vi.fn() };
		post = vi.fn();
		constructor(options: any) {
			clientOptions.push(options);
		}
	}
	return { default: MockOpenAI };
});

import { UbcLlmSandboxProvider } from '../src/providers/ubc-llm-sandbox-provider';
import { UBC_LLM_SANDBOX_MODELS } from '../src/providers/ubc-llm-sandbox-config';

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

beforeEach(() => {
	createMock.mockReset();
	clientOptions.length = 0;
});

function mockChatResponse(model: string, content = 'ok') {
	createMock.mockResolvedValue({
		id: 'x',
		created: 1,
		model,
		choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
	});
}

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

	it('sends reasoning_effort for gpt-oss-120b instead of rejecting it', async () => {
		mockChatResponse(UBC_LLM_SANDBOX_MODELS.reasoning);

		const provider = makeProvider();
		await provider.sendConversation([{ role: 'user', content: 'hi' }], {
			model: UBC_LLM_SANDBOX_MODELS.reasoning,
			reasoningEffort: 'high',
			maxTokens: 2000,
		});

		const params = createMock.mock.calls[0][0];
		expect(params.reasoning_effort).toBe('high');
		// gpt-oss is served by the sandbox, not OpenAI: it takes max_tokens.
		expect(params.max_tokens).toBe(2000);
		expect(params.max_completion_tokens).toBeUndefined();
	});

	it("clamps BiocBot's default 'minimal' effort into the gpt-oss scale", async () => {
		mockChatResponse(UBC_LLM_SANDBOX_MODELS.reasoning);

		const provider = makeProvider();
		await provider.sendConversation([{ role: 'user', content: 'hi' }], {
			model: UBC_LLM_SANDBOX_MODELS.reasoning,
			reasoning_effort: 'minimal',
		} as any);

		expect(createMock.mock.calls[0][0].reasoning_effort).toBe('low');
	});

	it('forwards reasoningEffort for chat models the roster may add later', async () => {
		mockChatResponse(UBC_LLM_SANDBOX_MODELS.chat);

		const provider = makeProvider();
		await provider.sendConversation([{ role: 'user', content: 'hi' }], {
			model: UBC_LLM_SANDBOX_MODELS.chat,
			reasoningEffort: 'medium',
		});

		expect(createMock.mock.calls[0][0].reasoning_effort).toBe('medium');
	});

	it("maps reasoningEffort 'none' on qwen3 to a chat-template toggle", async () => {
		mockChatResponse(UBC_LLM_SANDBOX_MODELS.chat);

		const provider = makeProvider();
		await provider.sendConversation([{ role: 'user', content: 'hi' }], {
			model: UBC_LLM_SANDBOX_MODELS.chat,
			reasoningEffort: 'none',
			maxTokens: 512,
		});

		const params = createMock.mock.calls[0][0];
		// Qwen3 ignores reasoning_effort; thinking is a chat-template flag.
		expect(params.chat_template_kwargs).toEqual({ enable_thinking: false });
		expect(params.reasoning_effort).toBeUndefined();
	});

	it('lets an explicit chat_template_kwargs from the caller win', async () => {
		mockChatResponse(UBC_LLM_SANDBOX_MODELS.chat);

		const provider = makeProvider();
		await provider.sendConversation([{ role: 'user', content: 'hi' }], {
			model: UBC_LLM_SANDBOX_MODELS.chat,
			reasoningEffort: 'none',
			chat_template_kwargs: { enable_thinking: true, custom_flag: 1 },
		} as any);

		expect(createMock.mock.calls[0][0].chat_template_kwargs).toEqual({
			enable_thinking: true,
			custom_flag: 1,
		});
	});

	it('does not send chat_template_kwargs when thinking was not addressed', async () => {
		mockChatResponse(UBC_LLM_SANDBOX_MODELS.chat);

		const provider = makeProvider();
		await provider.sendConversation([{ role: 'user', content: 'hi' }], {
			model: UBC_LLM_SANDBOX_MODELS.chat,
		});

		expect(createMock.mock.calls[0][0].chat_template_kwargs).toBeUndefined();
	});

	it('applies the thinking toggle on the streaming path too', async () => {
		async function* fakeStream() {
			yield { choices: [{ delta: { content: 'a' }, finish_reason: 'stop' }] };
		}
		createMock.mockResolvedValue(fakeStream());

		const provider = makeProvider();
		await provider.streamConversation(
			[{ role: 'user', content: 'hi' }],
			() => {},
			{ model: UBC_LLM_SANDBOX_MODELS.chat, reasoningEffort: 'none' }
		);

		expect(createMock.mock.calls[0][0].chat_template_kwargs).toEqual({
			enable_thinking: false,
		});
	});

	it('still rejects reasoning on OpenAI models proxied through the sandbox', async () => {
		const provider = makeProvider();
		await expect(
			provider.sendConversation([{ role: 'user', content: 'hi' }], {
				model: 'gpt-4o',
				reasoningEffort: 'low',
			})
		).rejects.toThrowError(/does not support reasoningEffort/);
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

describe('UbcLlmSandboxProvider endpoint handling', () => {
	it('normalizes the configured endpoint into the OpenAI base URL', () => {
		new UbcLlmSandboxProvider(
			'key',
			'https://ai-stg.apps.ctlt.ubc.ca/v1/chat/completions',
			UBC_LLM_SANDBOX_MODELS.chat,
			new NoopLogger()
		);
		expect(clientOptions[0].baseURL).toBe('https://ai-stg.apps.ctlt.ubc.ca/v1');
	});

	it('appends /v1 when only the host is configured', () => {
		new UbcLlmSandboxProvider(
			'key',
			'https://ai.apps.ctlt.ubc.ca',
			UBC_LLM_SANDBOX_MODELS.chat,
			new NoopLogger()
		);
		expect(clientOptions[0].baseURL).toBe('https://ai.apps.ctlt.ubc.ca/v1');
	});

	it('rejects a missing endpoint', () => {
		expect(
			() =>
				new UbcLlmSandboxProvider('key', '', 'model', new NoopLogger())
		).toThrowError(/Endpoint is required/);
	});
});

describe('UbcLlmSandboxProvider embeddings', () => {
	it('keeps the legacy default model but warns, naming the current one', async () => {
		const logger = new NoopLogger();
		const warn = vi.spyOn(logger, 'warn');
		const provider = new UbcLlmSandboxProvider(
			'key',
			'https://ai-stg.apps.ctlt.ubc.ca/v1',
			UBC_LLM_SANDBOX_MODELS.chat,
			logger
		);
		const post = (provider as any).client.post;
		post.mockResolvedValue({
			data: [{ embedding: [0.1] }],
			model: 'nomic-embed-text',
			usage: {},
		});

		await provider.embed(['hello']);

		// Backwards compatible: the request still goes out with the old default...
		expect(post.mock.calls[0][1].body.model).toBe('nomic-embed-text');
		// ...but the caller is told, and pointed at the current sandbox model.
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toContain('nomic-embed-text');
		expect(warn.mock.calls[0][0]).toContain(UBC_LLM_SANDBOX_MODELS.embedding);
	});

	it('does not warn when an embedding model is configured', async () => {
		const logger = new NoopLogger();
		const warn = vi.spyOn(logger, 'warn');
		const provider = new UbcLlmSandboxProvider(
			'key',
			'https://ai-stg.apps.ctlt.ubc.ca/v1',
			UBC_LLM_SANDBOX_MODELS.chat,
			logger,
			{ embeddingModel: UBC_LLM_SANDBOX_MODELS.embedding }
		);
		const post = (provider as any).client.post;
		post.mockResolvedValue({ data: [{ embedding: [0.1] }], model: 'm', usage: {} });

		await provider.embed(['hello']);

		expect(warn).not.toHaveBeenCalled();
	});

	it('uses the configured embedding model', async () => {
		const provider = new UbcLlmSandboxProvider(
			'key',
			'https://ai-stg.apps.ctlt.ubc.ca/v1',
			UBC_LLM_SANDBOX_MODELS.chat,
			new NoopLogger(),
			{ embeddingModel: UBC_LLM_SANDBOX_MODELS.embedding }
		);
		const post = (provider as any).client.post;
		post.mockResolvedValue({
			data: [{ embedding: [0.1, 0.2] }],
			model: UBC_LLM_SANDBOX_MODELS.embedding,
			usage: { prompt_tokens: 3, total_tokens: 3 },
		});

		const response = await provider.embed(['hello']);

		expect(post.mock.calls[0][0]).toBe('/embeddings');
		expect(post.mock.calls[0][1].body).toEqual({
			model: UBC_LLM_SANDBOX_MODELS.embedding,
			input: ['hello'],
		});
		expect(response.embeddings).toEqual([[0.1, 0.2]]);
	});
});
