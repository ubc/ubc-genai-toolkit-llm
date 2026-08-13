import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ConfigurationError, NoopLogger } from 'ubc-genai-toolkit-core';
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
import {
	UBC_LLM_SANDBOX_MODELS,
	UBC_LLM_SANDBOX_APPROVED_MODELS,
} from '../src/providers/ubc-llm-sandbox-config';

const calculator = {
	name: 'calculator',
	description: 'Evaluate arithmetic.',
	parameters: z.object({ expression: z.string() }),
};

function makeProvider(defaultModel: string = UBC_LLM_SANDBOX_MODELS.chat) {
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
			model: UBC_LLM_SANDBOX_MODELS.chat,
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
			{
				model: UBC_LLM_SANDBOX_MODELS.reasoning,
				tools: [calculator],
				reasoningEffort: 'low',
			}
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
		mockChatResponse(UBC_LLM_SANDBOX_MODELS.reasoning);

		const provider = makeProvider();
		await provider.sendConversation([{ role: 'user', content: 'hi' }], {
			model: UBC_LLM_SANDBOX_MODELS.reasoning,
			reasoning_effort: 'low',
			// Sandbox models are self-hosted, so the budget goes out as max_tokens
			// whichever spelling the caller used.
			max_completion_tokens: 2000,
		} as any);

		const params = createMock.mock.calls[0][0];
		expect(params.reasoning_effort).toBe('low');
		expect(params.max_tokens).toBe(2000);
		expect(params.max_completion_tokens).toBeUndefined();
		expect(params.stream).toBe(false);
	});

	it('preserves BiocBot raw response_format passthrough', async () => {
		mockChatResponse(UBC_LLM_SANDBOX_MODELS.chat);

		const provider = makeProvider();

		await provider.sendConversation(
			[{ role: 'user', content: 'generate JSON' }],
			{
				model: UBC_LLM_SANDBOX_MODELS.chat,
				reasoningEffort: 'none',
				max_completion_tokens: 4000,
				response_format: { type: 'json_object' },
			} as any
		);

		const params = createMock.mock.calls[0][0];

		expect(params.response_format).toEqual({
			type: 'json_object',
		});
	});

	it('maps maxTokens to max_tokens on stream for self-hosted models', async () => {
		async function* fakeStream() {
			yield { choices: [{ delta: { content: 'a' }, finish_reason: null }] };
			yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
		}
		createMock.mockResolvedValue(fakeStream());

		const provider = makeProvider();
		await provider.streamConversation(
			[{ role: 'user', content: 'hi' }],
			() => {},
			{ model: UBC_LLM_SANDBOX_MODELS.chat, maxTokens: 1000 }
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

	it('does not let passthrough override model, messages, or stream', async () => {
		mockChatResponse(UBC_LLM_SANDBOX_MODELS.chat);

		const provider = makeProvider();
		const messages: Message[] = [{ role: 'user', content: 'real' }];
		await provider.sendConversation(messages, {
			model: UBC_LLM_SANDBOX_MODELS.chat,
			messages: [{ role: 'user', content: 'hijack' }],
			stream: true,
		} as any);

		const params = createMock.mock.calls[0][0];
		expect(params.model).toBe(UBC_LLM_SANDBOX_MODELS.chat);
		expect(params.messages).toEqual([{ role: 'user', content: 'real' }]);
		expect(params.stream).toBe(false);
	});
});

describe('UbcLlmSandboxProvider approved-model policy', () => {
	/** A model the underlying key may well be entitled to, but the sandbox is not. */
	const OFF_POLICY_MODEL = 'gpt-4o';

	function mockModelList(provider: UbcLlmSandboxProvider, ids: string[]) {
		const list = (provider as any).client.models.list;
		list.mockResolvedValue({ data: ids.map((id) => ({ id })) });
		return list;
	}

	it('exposes only approved models from /models', async () => {
		const provider = makeProvider();
		mockModelList(provider, [
			'gpt-4o',
			UBC_LLM_SANDBOX_MODELS.chat,
			'claude-sonnet-4-5-20250929',
			UBC_LLM_SANDBOX_MODELS.reasoning,
			'nomic-embed-text',
			UBC_LLM_SANDBOX_MODELS.embedding,
		]);

		const models = await provider.getAvailableModels();

		expect(models).toEqual([
			UBC_LLM_SANDBOX_MODELS.chat,
			UBC_LLM_SANDBOX_MODELS.reasoning,
			UBC_LLM_SANDBOX_MODELS.embedding,
		]);
		expect(models).toHaveLength(UBC_LLM_SANDBOX_APPROVED_MODELS.length);
	});

	it('reports nothing when the gateway serves no approved model', async () => {
		const provider = makeProvider();
		mockModelList(provider, ['gpt-4o', 'gpt-4.1-mini']);

		expect(await provider.getAvailableModels()).toEqual([]);
	});

	it('rejects a disallowed per-request model even though the key can reach it', async () => {
		const provider = makeProvider();

		await expect(
			provider.sendConversation([{ role: 'user', content: 'hi' }], {
				model: OFF_POLICY_MODEL,
			})
		).rejects.toThrowError(/not approved for the 'ubc-llm-sandbox' provider/);
		// Rejected before anything left the process.
		expect(createMock).not.toHaveBeenCalled();
	});

	it('rejects a disallowed configured default model', async () => {
		const provider = makeProvider(OFF_POLICY_MODEL);

		await expect(
			provider.sendMessage('hi')
		).rejects.toThrowError(/not approved for the 'ubc-llm-sandbox' provider/);
		expect(createMock).not.toHaveBeenCalled();
	});

	it('rejects a disallowed model on the streaming path', async () => {
		const provider = makeProvider();

		await expect(
			provider.streamConversation([{ role: 'user', content: 'hi' }], () => {}, {
				model: OFF_POLICY_MODEL,
			})
		).rejects.toThrowError(/not approved/);
		expect(createMock).not.toHaveBeenCalled();
	});

	it('rejects a disallowed embedding model', async () => {
		const provider = new UbcLlmSandboxProvider(
			'key',
			'https://ai-stg.apps.ctlt.ubc.ca/v1',
			UBC_LLM_SANDBOX_MODELS.chat,
			new NoopLogger(),
			{ embeddingModel: 'text-embedding-3-large' }
		);
		const post = (provider as any).client.post;

		await expect(provider.embed(['hello'])).rejects.toThrowError(/not approved/);
		expect(post).not.toHaveBeenCalled();
	});

	it('matches approved ids exactly rather than repairing near-misses', async () => {
		const provider = makeProvider();

		for (const nearMiss of [
			'Qwen3.6-35b-a3b', // wrong case
			`${UBC_LLM_SANDBOX_MODELS.chat}:latest`, // added suffix
			' qwen3.6-35b-a3b', // stray whitespace
			'qwen3.6-35b', // truncated
		]) {
			await expect(
				provider.sendConversation([{ role: 'user', content: 'hi' }], {
					model: nearMiss,
				})
			).rejects.toThrowError(/not approved/);
		}
		expect(createMock).not.toHaveBeenCalled();
	});

	it('raises a ConfigurationError naming the approved models and the way out', async () => {
		const provider = makeProvider();

		const error = await provider
			.sendConversation([{ role: 'user', content: 'hi' }], {
				model: OFF_POLICY_MODEL,
			})
			.catch((e) => e);

		expect(error).toBeInstanceOf(ConfigurationError);
		expect(error.code).toBe(400);
		for (const approved of UBC_LLM_SANDBOX_APPROVED_MODELS) {
			expect(error.message).toContain(approved);
		}
		expect(error.message).toContain('ubc-llm-proxy');
		expect(error.details).toMatchObject({
			provider: 'ubc-llm-sandbox',
			model: OFF_POLICY_MODEL,
			purpose: 'chat',
		});
	});

	it('still applies OpenAI reasoning rules to an approved model that has them', async () => {
		// gpt-oss-120b looks like an OpenAI id but is self-hosted: reasoning is
		// forwarded rather than rejected. (The strict-OpenAI branch is exercised
		// through the proxy provider, which can reach those models.)
		mockChatResponse(UBC_LLM_SANDBOX_MODELS.reasoning);
		const provider = makeProvider();

		await provider.sendConversation([{ role: 'user', content: 'hi' }], {
			model: UBC_LLM_SANDBOX_MODELS.reasoning,
			reasoningEffort: 'low',
		});

		expect(createMock.mock.calls[0][0].reasoning_effort).toBe('low');
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
			() => new UbcLlmSandboxProvider('key', '', 'model', new NoopLogger())
		).toThrowError(/Endpoint is required/);
	});
});

describe('UbcLlmSandboxProvider embeddings', () => {
	it('fails with a clear error when no embedding model is configured', async () => {
		const provider = new UbcLlmSandboxProvider(
			'key',
			'https://ai-stg.apps.ctlt.ubc.ca/v1',
			UBC_LLM_SANDBOX_MODELS.chat,
			new NoopLogger()
		);
		const post = (provider as any).client.post;

		const error = await provider.embed(['hello']).catch((e) => e);

		expect(error).toBeInstanceOf(ConfigurationError);
		// Names the setting to change and the model to put in it, rather than
		// silently substituting one (pre-0.7.0 behavior).
		expect(error.message).toContain('embeddingModel');
		expect(error.message).toContain(UBC_LLM_SANDBOX_MODELS.embedding);
		expect(post).not.toHaveBeenCalled();
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

	it('accepts an approved embedding model passed per request', async () => {
		const provider = makeProvider();
		const post = (provider as any).client.post;
		post.mockResolvedValue({
			data: [{ embedding: [0.3] }],
			model: UBC_LLM_SANDBOX_MODELS.embedding,
			usage: {},
		});

		await provider.embed(['hello'], {
			model: UBC_LLM_SANDBOX_MODELS.embedding,
		});

		expect(post.mock.calls[0][1].body.model).toBe(
			UBC_LLM_SANDBOX_MODELS.embedding
		);
	});
});
