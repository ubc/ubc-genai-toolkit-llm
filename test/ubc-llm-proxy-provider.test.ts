import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { APIError, ConfigurationError, NoopLogger } from 'ubc-genai-toolkit-core';
import type { Message } from '../src/types';

const createMock = vi.fn();
const clientOptions: any[] = [];

vi.mock('openai', () => {
	/** Stand-in for OpenAI.APIError: carries the fields handleError reads. */
	class MockAPIError extends Error {
		status: number;
		code?: string;
		param?: string | null;
		constructor(
			message: string,
			status = 500,
			code?: string,
			name = 'MockAPIError'
		) {
			super(message);
			this.name = name;
			this.status = status;
			this.code = code;
		}
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

import OpenAI from 'openai';
import { UbcLlmProxyProvider } from '../src/providers/ubc-llm-proxy-provider';
import { LLMModule } from '../src/llm-module';

const ENDPOINT = 'https://litellm.example.ca/v1';

/**
 * Ids in the shapes a LiteLLM deployment actually returns: route-namespaced,
 * vendor-prefixed, dotted, versioned, and one carrying a colon. If any of these
 * come back changed, the provider is rewriting model names.
 */
const GATEWAY_MODEL_IDS = [
	'gpt-oss-120b',
	'qwen3.6-35b-a3b',
	'openai/gpt-4o',
	'azure/gpt-4o-mini',
	'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
	'ubc/qwen3-embedding-0.6b',
	'text-embedding-3-large',
];

const calculator = {
	name: 'calculator',
	description: 'Evaluate arithmetic.',
	parameters: z.object({ expression: z.string() }),
};

function makeProvider(options?: {
	defaultModel?: string;
	embeddingModel?: string;
}) {
	return new UbcLlmProxyProvider('key', ENDPOINT, new NoopLogger(), options);
}

function mockChatResponse(model: string, content = 'ok') {
	createMock.mockResolvedValue({
		id: 'x',
		created: 1,
		model,
		choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
		usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
	});
}

function mockModelList(provider: UbcLlmProxyProvider, ids: string[]) {
	const list = (provider as any).client.models.list;
	list.mockResolvedValue({ data: ids.map((id) => ({ id })) });
	return list;
}

/** Builds the mocked OpenAI.APIError a gateway failure would surface as. */
function gatewayError(
	message: string,
	status: number,
	code: string,
	name: string
) {
	return new (OpenAI as any).APIError(message, status, code, name);
}

beforeEach(() => {
	createMock.mockReset();
	clientOptions.length = 0;
});

describe('UbcLlmProxyProvider initialization', () => {
	it('constructs with only an API key and endpoint', () => {
		const provider = makeProvider();

		expect(provider.getName()).toBe('ubc-llm-proxy');
		expect(clientOptions[0]).toMatchObject({ apiKey: 'key', baseURL: ENDPOINT });
	});

	it('can list models before any model has been chosen', async () => {
		// The setup flow this provider exists for: construct, discover, then
		// configure a model from what came back.
		const provider = makeProvider();
		mockModelList(provider, GATEWAY_MODEL_IDS);

		await expect(provider.getAvailableModels()).resolves.toEqual(
			GATEWAY_MODEL_IDS
		);
	});

	it('requires an API key', () => {
		expect(
			() => new UbcLlmProxyProvider('', ENDPOINT, new NoopLogger())
		).toThrowError(ConfigurationError);
		expect(
			() => new UbcLlmProxyProvider('   ', ENDPOINT, new NoopLogger())
		).toThrowError(/apiKey is required/);
	});

	it('requires an endpoint', () => {
		expect(
			() => new UbcLlmProxyProvider('key', '', new NoopLogger())
		).toThrowError(/endpoint is required for the UBC LLM Proxy provider/);
	});

	it('rejects an endpoint that is not an absolute URL', () => {
		expect(
			() => new UbcLlmProxyProvider('key', 'litellm.example.ca', new NoopLogger())
		).toThrowError(/absolute URL/);
	});
});

describe('UbcLlmProxyProvider endpoint normalization', () => {
	function baseUrlFor(endpoint: string) {
		new UbcLlmProxyProvider('key', endpoint, new NoopLogger());
		return clientOptions[clientOptions.length - 1].baseURL;
	}

	it('appends /v1 to a bare host', () => {
		expect(baseUrlFor('https://litellm.example.ca')).toBe(
			'https://litellm.example.ca/v1'
		);
	});

	it('strips trailing slashes and pasted route suffixes', () => {
		expect(baseUrlFor('https://litellm.example.ca/v1/')).toBe(
			'https://litellm.example.ca/v1'
		);
		expect(baseUrlFor('https://litellm.example.ca/v1/chat/completions')).toBe(
			'https://litellm.example.ca/v1'
		);
		expect(baseUrlFor('https://litellm.example.ca/v1/models')).toBe(
			'https://litellm.example.ca/v1'
		);
		expect(baseUrlFor('https://litellm.example.ca/v1/embeddings')).toBe(
			'https://litellm.example.ca/v1'
		);
	});

	it('preserves a path prefix and an existing version segment', () => {
		expect(baseUrlFor('https://gateway.example.ca/llm')).toBe(
			'https://gateway.example.ca/llm/v1'
		);
		expect(baseUrlFor('https://gateway.example.ca/llm/v2')).toBe(
			'https://gateway.example.ca/llm/v2'
		);
	});

	it('trims surrounding whitespace', () => {
		expect(baseUrlFor('  https://litellm.example.ca/v1  ')).toBe(
			'https://litellm.example.ca/v1'
		);
	});
});

describe('UbcLlmProxyProvider model discovery', () => {
	it('returns the ids from /models exactly as LiteLLM reported them', async () => {
		const provider = makeProvider();
		mockModelList(provider, GATEWAY_MODEL_IDS);

		const models = await provider.getAvailableModels();

		// Same ids, same order, same spelling — no filtering, no sorting.
		expect(models).toEqual(GATEWAY_MODEL_IDS);
	});

	it('does not add, strip, or rewrite any part of a model id', async () => {
		const provider = makeProvider();
		mockModelList(provider, GATEWAY_MODEL_IDS);

		const models = await provider.getAvailableModels();

		for (const [i, id] of GATEWAY_MODEL_IDS.entries()) {
			expect(models[i]).toBe(id);
			expect(models[i]).toHaveLength(id.length);
		}
		// Nothing was normalized into a "friendlier" form.
		expect(models).not.toContain('gpt-4o');
		expect(models).not.toContain('qwen3-embedding-0.6b');
	});

	it('reports an empty roster rather than inventing defaults', async () => {
		const provider = makeProvider();
		mockModelList(provider, []);

		expect(await provider.getAvailableModels()).toEqual([]);
	});
});

describe('UbcLlmProxyProvider chat', () => {
	it('sends an explicitly supplied model and normalizes the response', async () => {
		mockChatResponse('openai/gpt-4o', 'hello there');
		const provider = makeProvider();

		const response = await provider.sendConversation(
			[{ role: 'user', content: 'hi' }],
			{ model: 'openai/gpt-4o', temperature: 0.2, maxTokens: 100 }
		);

		const params = createMock.mock.calls[0][0];
		expect(params.model).toBe('openai/gpt-4o');
		expect(params.messages).toEqual([{ role: 'user', content: 'hi' }]);
		expect(params.temperature).toBe(0.2);
		expect(params.stream).toBe(false);
		expect(response.content).toBe('hello there');
		expect(response.model).toBe('openai/gpt-4o');
		expect(response.stopReason).toBe('stop');
		expect(response.usage).toEqual({
			promptTokens: 5,
			completionTokens: 7,
			totalTokens: 12,
		});
		expect(response.metadata?.provider).toBe('ubc-llm-proxy');
	});

	it('puts unusual model ids on the wire byte for byte', async () => {
		const provider = makeProvider();

		for (const id of GATEWAY_MODEL_IDS) {
			createMock.mockReset();
			mockChatResponse(id);
			await provider.sendMessage('hi', { model: id });
			expect(createMock.mock.calls[0][0].model).toBe(id);
		}
	});

	it('reports the model the gateway echoed back, unmodified', async () => {
		// LiteLLM may answer with a fully-qualified id; it is passed through.
		mockChatResponse('bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0');
		const provider = makeProvider();

		const response = await provider.sendMessage('hi', {
			model: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
		});

		expect(response.model).toBe(
			'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0'
		);
	});

	it('uses a configured defaultModel when the request does not name one', async () => {
		mockChatResponse('qwen3.6-35b-a3b');
		const provider = makeProvider({ defaultModel: 'qwen3.6-35b-a3b' });

		await provider.sendMessage('hi');

		expect(createMock.mock.calls[0][0].model).toBe('qwen3.6-35b-a3b');
	});

	it('lets a per-request model override the configured default', async () => {
		mockChatResponse('openai/gpt-4o');
		const provider = makeProvider({ defaultModel: 'qwen3.6-35b-a3b' });

		await provider.sendMessage('hi', { model: 'openai/gpt-4o' });

		expect(createMock.mock.calls[0][0].model).toBe('openai/gpt-4o');
	});

	it('accepts any model the key can reach — there is no allowlist', async () => {
		const provider = makeProvider();

		for (const id of ['gpt-4o', 'claude-sonnet-4-5-20250929', 'llama3.1:70b']) {
			createMock.mockReset();
			mockChatResponse(id);
			await expect(provider.sendMessage('hi', { model: id })).resolves.toBeTruthy();
			expect(createMock.mock.calls[0][0].model).toBe(id);
		}
	});

	it('translates tools and normalizes tool calls', async () => {
		createMock.mockResolvedValue({
			id: 'x',
			created: 1,
			model: 'qwen3.6-35b-a3b',
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
		const provider = makeProvider({ defaultModel: 'qwen3.6-35b-a3b' });

		const response = await provider.sendConversation(
			[{ role: 'user', content: '2*3?' }],
			{ tools: [calculator], toolChoice: 'required' }
		);

		const params = createMock.mock.calls[0][0];
		expect(params.tools[0].function.name).toBe('calculator');
		expect(params.tool_choice).toBe('required');
		expect(response.toolCalls).toEqual([
			{ id: 'call_1', name: 'calculator', arguments: { expression: '2*3' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});

	it('streams with an explicitly supplied model', async () => {
		async function* fakeStream() {
			yield { choices: [{ delta: { content: 'he' }, finish_reason: null }] };
			yield { choices: [{ delta: { content: 'llo' }, finish_reason: 'stop' }] };
		}
		createMock.mockResolvedValue(fakeStream());
		const provider = makeProvider();

		const chunks: string[] = [];
		const response = await provider.streamConversation(
			[{ role: 'user', content: 'hi' }],
			(c) => chunks.push(c),
			{ model: 'openai/gpt-4o' }
		);

		expect(createMock.mock.calls[0][0].model).toBe('openai/gpt-4o');
		expect(createMock.mock.calls[0][0].stream).toBe(true);
		expect(chunks).toEqual(['he', 'llo']);
		expect(response.content).toBe('hello');
		expect(response.model).toBe('openai/gpt-4o');
		expect(response.metadata?.provider).toBe('ubc-llm-proxy');
	});

	it('does not let passthrough options override model, messages, or stream', async () => {
		mockChatResponse('openai/gpt-4o');
		const provider = makeProvider();
		const messages: Message[] = [{ role: 'user', content: 'real' }];

		await provider.sendConversation(messages, {
			model: 'openai/gpt-4o',
			messages: [{ role: 'user', content: 'hijack' }],
			stream: true,
		} as any);

		const params = createMock.mock.calls[0][0];
		expect(params.model).toBe('openai/gpt-4o');
		expect(params.messages).toEqual([{ role: 'user', content: 'real' }]);
		expect(params.stream).toBe(false);
	});
});

describe('UbcLlmProxyProvider reasoning mapping', () => {
	// The proxy shares the sandbox's reasoning translation, and can also reach
	// the OpenAI cloud models whose stricter rules that translation preserves.
	it('keeps OpenAI rules for OpenAI models: max_completion_tokens on gpt-5', async () => {
		mockChatResponse('gpt-5-nano');
		const provider = makeProvider();

		await provider.sendConversation([{ role: 'user', content: 'hi' }], {
			model: 'gpt-5-nano',
			reasoning_effort: 'low',
			max_completion_tokens: 2000,
		} as any);

		const params = createMock.mock.calls[0][0];
		expect(params.reasoning_effort).toBe('low');
		expect(params.max_completion_tokens).toBe(2000);
		expect(params.max_tokens).toBeUndefined();
	});

	it('maps maxTokens to max_tokens for older OpenAI models', async () => {
		mockChatResponse('gpt-4.1-mini');
		const provider = makeProvider();

		await provider.sendMessage('hi', { model: 'gpt-4.1-mini', maxTokens: 1000 });

		const params = createMock.mock.calls[0][0];
		expect(params.max_tokens).toBe(1000);
		expect(params.max_completion_tokens).toBeUndefined();
		expect(params.reasoning_effort).toBeUndefined();
	});

	it('rejects reasoningEffort on an OpenAI model that cannot reason', async () => {
		const provider = makeProvider();

		await expect(
			provider.sendConversation([{ role: 'user', content: 'hi' }], {
				model: 'gpt-4o',
				reasoningEffort: 'low',
			})
		).rejects.toThrowError(/does not support reasoningEffort/);
		expect(createMock).not.toHaveBeenCalled();
	});

	it('clamps efforts into the gpt-oss scale', async () => {
		mockChatResponse('gpt-oss-120b');
		const provider = makeProvider();

		await provider.sendMessage('hi', {
			model: 'gpt-oss-120b',
			reasoningEffort: 'minimal',
		});

		expect(createMock.mock.calls[0][0].reasoning_effort).toBe('low');
	});

	it("turns reasoningEffort 'none' into the qwen3 thinking toggle", async () => {
		mockChatResponse('qwen3.6-35b-a3b');
		const provider = makeProvider();

		await provider.sendMessage('hi', {
			model: 'qwen3.6-35b-a3b',
			reasoningEffort: 'none',
		});

		const params = createMock.mock.calls[0][0];
		expect(params.chat_template_kwargs).toEqual({ enable_thinking: false });
		expect(params.reasoning_effort).toBeUndefined();
	});
});

describe('UbcLlmProxyProvider embeddings', () => {
	it('embeds with an explicitly supplied model', async () => {
		const provider = makeProvider();
		const post = (provider as any).client.post;
		post.mockResolvedValue({
			data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
			model: 'ubc/qwen3-embedding-0.6b',
			usage: { prompt_tokens: 4, total_tokens: 4 },
		});

		const response = await provider.embed(['a', 'b'], {
			model: 'ubc/qwen3-embedding-0.6b',
		});

		expect(post.mock.calls[0][0]).toBe('/embeddings');
		expect(post.mock.calls[0][1].body).toEqual({
			model: 'ubc/qwen3-embedding-0.6b',
			input: ['a', 'b'],
		});
		expect(response.embeddings).toEqual([
			[0.1, 0.2],
			[0.3, 0.4],
		]);
		expect(response.model).toBe('ubc/qwen3-embedding-0.6b');
		expect(response.usage).toEqual({ promptTokens: 4, totalTokens: 4 });
		expect(response.metadata?.provider).toBe('ubc-llm-proxy');
	});

	it('uses a configured embeddingModel, and lets a request override it', async () => {
		const provider = makeProvider({ embeddingModel: 'text-embedding-3-large' });
		const post = (provider as any).client.post;
		post.mockResolvedValue({
			data: [{ embedding: [0.1] }],
			model: 'text-embedding-3-large',
			usage: {},
		});

		await provider.embed(['a']);
		expect(post.mock.calls[0][1].body.model).toBe('text-embedding-3-large');

		await provider.embed(['a'], { model: 'ubc/qwen3-embedding-0.6b' });
		expect(post.mock.calls[1][1].body.model).toBe('ubc/qwen3-embedding-0.6b');
	});

	it('forwards provider-specific embedding options', async () => {
		const provider = makeProvider({ embeddingModel: 'text-embedding-3-large' });
		const post = (provider as any).client.post;
		post.mockResolvedValue({
			data: [{ embedding: [0.1] }],
			model: 'text-embedding-3-large',
			usage: {},
		});

		await provider.embed(['a'], { dimensions: 256 });

		expect(post.mock.calls[0][1].body).toEqual({
			model: 'text-embedding-3-large',
			input: ['a'],
			dimensions: 256,
		});
	});
});

describe('UbcLlmProxyProvider missing-model errors', () => {
	function expectMissingModelError(error: any, configKey: string) {
		expect(error).toBeInstanceOf(ConfigurationError);
		expect(error.code).toBe(400);
		expect(error.message).toContain('ubc-llm-proxy');
		expect(error.message).toContain(configKey);
		// Points at the one call that can answer "so which model may I use?".
		expect(error.message).toContain('getAvailableModels()');
	}

	it('fails clearly when a chat call has no model at all', async () => {
		const provider = makeProvider();

		const error = await provider.sendMessage('hi').catch((e) => e);

		expectMissingModelError(error, 'defaultModel');
		expect(error.details).toMatchObject({
			provider: 'ubc-llm-proxy',
			purpose: 'chat',
		});
		expect(createMock).not.toHaveBeenCalled();
	});

	it('fails clearly on sendConversation and streamConversation too', async () => {
		const provider = makeProvider();

		expectMissingModelError(
			await provider
				.sendConversation([{ role: 'user', content: 'hi' }])
				.catch((e) => e),
			'defaultModel'
		);
		expectMissingModelError(
			await provider
				.streamConversation([{ role: 'user', content: 'hi' }], () => {})
				.catch((e) => e),
			'defaultModel'
		);
		expect(createMock).not.toHaveBeenCalled();
	});

	it('fails clearly when an embedding call has no model at all', async () => {
		const provider = makeProvider();
		const post = (provider as any).client.post;

		const error = await provider.embed(['hi']).catch((e) => e);

		expectMissingModelError(error, 'embeddingModel');
		expect(error.details).toMatchObject({
			provider: 'ubc-llm-proxy',
			purpose: 'embedding',
		});
		expect(post).not.toHaveBeenCalled();
	});

	it('does not treat a blank model as a configured one', async () => {
		const provider = makeProvider({ defaultModel: '   ' });

		await expect(provider.sendMessage('hi')).rejects.toThrowError(
			ConfigurationError
		);
		await expect(
			provider.sendMessage('hi', { model: '' })
		).rejects.toThrowError(ConfigurationError);
		expect(createMock).not.toHaveBeenCalled();
	});

	it('a missing chat model does not block model discovery', async () => {
		const provider = makeProvider();
		mockModelList(provider, GATEWAY_MODEL_IDS);

		await expect(provider.getAvailableModels()).resolves.toEqual(
			GATEWAY_MODEL_IDS
		);
	});
});

describe('UbcLlmProxyProvider error mapping', () => {
	it('keeps an authentication failure identifiable', async () => {
		createMock.mockRejectedValue(
			gatewayError(
				'Incorrect API key provided',
				401,
				'invalid_api_key',
				'AuthenticationError'
			)
		);
		const provider = makeProvider({ defaultModel: 'gpt-oss-120b' });

		const error = await provider.sendMessage('hi').catch((e) => e);

		expect(error).toBeInstanceOf(APIError);
		expect(error.code).toBe(401);
		expect(error.message).toContain('Incorrect API key provided');
		expect(error.details).toMatchObject({
			provider: 'ubc-llm-proxy',
			code: 'invalid_api_key',
			type: 'AuthenticationError',
		});
	});

	it('keeps a quota / rate-limit rejection identifiable', async () => {
		createMock.mockRejectedValue(
			gatewayError(
				'You exceeded your current quota',
				429,
				'insufficient_quota',
				'RateLimitError'
			)
		);
		const provider = makeProvider({ defaultModel: 'gpt-oss-120b' });

		const error = await provider.sendMessage('hi').catch((e) => e);

		expect(error).toBeInstanceOf(APIError);
		expect(error.code).toBe(429);
		expect(error.details).toMatchObject({
			provider: 'ubc-llm-proxy',
			code: 'insufficient_quota',
			type: 'RateLimitError',
		});
		// Distinguishable from an auth failure without parsing the message.
		expect(error.code).not.toBe(401);
	});

	it('keeps auth and quota status codes on the discovery and embedding paths', async () => {
		const provider = makeProvider({ embeddingModel: 'text-embedding-3-large' });
		(provider as any).client.models.list.mockRejectedValue(
			gatewayError('Invalid API key', 401, 'invalid_api_key', 'AuthenticationError')
		);
		(provider as any).client.post.mockRejectedValue(
			gatewayError('Rate limit reached', 429, 'rate_limit_exceeded', 'RateLimitError')
		);

		const listError = await provider.getAvailableModels().catch((e) => e);
		const embedError = await provider.embed(['hi']).catch((e) => e);

		expect(listError.code).toBe(401);
		expect(listError.details.code).toBe('invalid_api_key');
		expect(embedError.code).toBe(429);
		expect(embedError.details.code).toBe('rate_limit_exceeded');
	});

	it('surfaces a model the gateway rejects as an API error, not a config error', async () => {
		// The proxy trusts the gateway on entitlements: an unknown model is a 404
		// from LiteLLM, kept as such rather than pre-empted by a local list.
		createMock.mockRejectedValue(
			gatewayError('model not found', 404, 'model_not_found', 'NotFoundError')
		);
		const provider = makeProvider();

		const error = await provider
			.sendMessage('hi', { model: 'not-a-real-model' })
			.catch((e) => e);

		expect(error).toBeInstanceOf(APIError);
		expect(error).not.toBeInstanceOf(ConfigurationError);
		expect(error.code).toBe(404);
		expect(createMock.mock.calls[0][0].model).toBe('not-a-real-model');
	});

	it('reports structured output as unsupported in this version', async () => {
		const provider = makeProvider({ defaultModel: 'gpt-oss-120b' });

		const error = await provider
			.sendStructuredConversation(
				[{ role: 'user', content: 'hi' }],
				z.object({ answer: z.string() })
			)
			.catch((e) => e);

		expect(error).toBeInstanceOf(APIError);
		expect(error.code).toBe(501);
		expect(error.details).toMatchObject({ provider: 'ubc-llm-proxy' });
	});
});

describe('LLMModule with the ubc-llm-proxy provider', () => {
	it('initializes with only an API key and endpoint', async () => {
		const llm = new LLMModule({
			provider: 'ubc-llm-proxy',
			apiKey: 'key',
			endpoint: ENDPOINT,
			logger: new NoopLogger(),
		});

		expect(llm.getProviderName()).toBe('ubc-llm-proxy');
		const provider = (llm as any).provider;
		mockModelList(provider, GATEWAY_MODEL_IDS);
		await expect(llm.getAvailableModels()).resolves.toEqual(GATEWAY_MODEL_IDS);
	});

	it('requires apiKey and endpoint', () => {
		expect(
			() =>
				new LLMModule({
					provider: 'ubc-llm-proxy',
					endpoint: ENDPOINT,
					logger: new NoopLogger(),
				})
		).toThrowError(/apiKey is required for UBC LLM Proxy/);
		expect(
			() =>
				new LLMModule({
					provider: 'ubc-llm-proxy',
					apiKey: 'key',
					logger: new NoopLogger(),
				})
		).toThrowError(/endpoint is required for UBC LLM Proxy/);
	});

	it('sends the model configured on the module', async () => {
		mockChatResponse('qwen3.6-35b-a3b');
		const llm = new LLMModule({
			provider: 'ubc-llm-proxy',
			apiKey: 'key',
			endpoint: ENDPOINT,
			defaultModel: 'qwen3.6-35b-a3b',
			logger: new NoopLogger(),
		});

		await llm.sendMessage('hi');

		expect(createMock.mock.calls[0][0].model).toBe('qwen3.6-35b-a3b');
	});

	it('fails with a configuration error when no model was ever set', async () => {
		const llm = new LLMModule({
			provider: 'ubc-llm-proxy',
			apiKey: 'key',
			endpoint: ENDPOINT,
			logger: new NoopLogger(),
		});

		await expect(llm.sendMessage('hi')).rejects.toThrowError(ConfigurationError);
		expect(createMock).not.toHaveBeenCalled();
	});
});
