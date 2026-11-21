/**
 * Runs the OpenAI-backed providers against the *real* `openai` SDK, pointed at
 * a local HTTP server. The other provider tests mock the SDK module, so they
 * cannot notice when an SDK major moves or renames a method; these do.
 * No external API is called.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { z as z4 } from 'zod';
import { z as z3 } from 'zod/v3';
import { APIError, NoopLogger } from 'ubc-genai-toolkit-core';
import { OpenAIProvider } from '../src/providers/openai-provider';
import { UbcLlmProxyProvider } from '../src/providers/ubc-llm-proxy-provider';

interface Recorded {
	method: string;
	path: string;
	body: any;
}

let server: http.Server;
let baseURL: string;
const requests: Recorded[] = [];
/** Per-test reply: status + JSON body, or a list of SSE chunks. */
let reply: { status?: number; json?: unknown; sse?: unknown[] };

const completion = (message: Record<string, unknown>, finish = 'stop') => ({
	id: 'chatcmpl-1',
	object: 'chat.completion',
	created: 1,
	model: 'test-model',
	choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', ...message } }],
	usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
});

const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
	id: 'chatcmpl-1',
	object: 'chat.completion.chunk',
	created: 1,
	model: 'test-model',
	choices: [{ index: 0, delta, finish_reason: finish }],
});

beforeAll(async () => {
	server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (d) => (raw += d));
		req.on('end', () => {
			requests.push({
				method: req.method ?? '',
				path: req.url ?? '',
				body: raw ? JSON.parse(raw) : undefined,
			});
			if (reply.sse) {
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				for (const c of reply.sse) res.write(`data: ${JSON.stringify(c)}\n\n`);
				res.end('data: [DONE]\n\n');
				return;
			}
			res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(reply.json));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
	requests.length = 0;
	reply = {};
});

const weatherTool = (z: any) => ({
	name: 'weather',
	description: 'Get weather.',
	parameters: z.object({ city: z.string() }),
});

describe.each([
	[
		'openai',
		() =>
			new OpenAIProvider('test-key', 'test-model', new NoopLogger(), {
				endpoint: baseURL,
				embeddingModel: 'embed-model',
			}),
	],
	[
		'ubc-llm-proxy',
		() =>
			new UbcLlmProxyProvider('test-key', baseURL, new NoopLogger(), {
				defaultModel: 'test-model',
				embeddingModel: 'embed-model',
			}),
	],
])('%s provider on the real openai SDK', (_name, makeProvider) => {
	it('sends a chat completion and normalizes the response', async () => {
		reply = { json: completion({ content: 'hello' }) };

		const response = await makeProvider().sendConversation(
			[{ role: 'user', content: 'hi' }],
			{ temperature: 0.2 }
		);

		expect(requests[0]).toMatchObject({
			method: 'POST',
			path: '/v1/chat/completions',
			body: {
				model: 'test-model',
				messages: [{ role: 'user', content: 'hi' }],
				temperature: 0.2,
			},
		});
		expect(response.content).toBe('hello');
		expect(response.stopReason).toBe('stop');
		expect(response.usage).toEqual({
			promptTokens: 5,
			completionTokens: 7,
			totalTokens: 12,
		});
	});

	it.each([
		['Zod 3', z3],
		['Zod 4', z4],
	])('sends %s tools and returns the tool calls', async (_l, z) => {
		reply = {
			json: completion(
				{
					content: null,
					tool_calls: [
						{
							id: 'call_1',
							type: 'function',
							function: { name: 'weather', arguments: '{"city":"Vancouver"}' },
						},
					],
				},
				'tool_calls'
			),
		};

		const response = await makeProvider().sendConversation(
			[{ role: 'user', content: 'weather?' }],
			{ tools: [weatherTool(z)] }
		);

		const sent = requests[0].body.tools[0];
		expect(sent.type).toBe('function');
		expect(sent.function.name).toBe('weather');
		expect(sent.function.parameters).toMatchObject({
			type: 'object',
			properties: { city: { type: 'string' } },
			required: ['city'],
		});
		expect(response.toolCalls).toEqual([
			{ id: 'call_1', name: 'weather', arguments: { city: 'Vancouver' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});

	it('streams text deltas and assembles fragmented tool calls', async () => {
		reply = {
			sse: [
				chunk({ role: 'assistant', content: 'Hel' }),
				chunk({ content: 'lo' }),
				chunk({
					tool_calls: [
						{ index: 0, id: 'call_1', type: 'function', function: { name: 'weather', arguments: '{"ci' } },
					],
				}),
				chunk({ tool_calls: [{ index: 0, function: { arguments: 'ty":"Vancouver"}' } }] }),
				chunk({}, 'tool_calls'),
			],
		};
		const deltas: string[] = [];

		const response = await makeProvider().streamConversation(
			[{ role: 'user', content: 'hi' }],
			(text) => deltas.push(text),
			{ tools: [weatherTool(z4)] }
		);

		expect(requests[0].body.stream).toBe(true);
		expect(deltas).toEqual(['Hel', 'lo']);
		expect(response.content).toBe('Hello');
		expect(response.toolCalls).toEqual([
			{ id: 'call_1', name: 'weather', arguments: { city: 'Vancouver' } },
		]);
	});

	it('lists models', async () => {
		reply = {
			json: { object: 'list', data: [{ id: 'a', object: 'model' }, { id: 'openai/b', object: 'model' }] },
		};

		expect(await makeProvider().getAvailableModels()).toEqual(['a', 'openai/b']);
		expect(requests[0]).toMatchObject({ method: 'GET', path: '/v1/models' });
	});

	it('requests embeddings', async () => {
		reply = {
			json: {
				object: 'list',
				model: 'embed-model',
				data: [{ object: 'embedding', index: 0, embedding: [0.25, -0.5] }],
				usage: { prompt_tokens: 2, total_tokens: 2 },
			},
		};

		const response = await makeProvider().embed(['hello']);

		expect(requests[0]).toMatchObject({
			method: 'POST',
			path: '/v1/embeddings',
			body: { model: 'embed-model', input: ['hello'] },
		});
		expect(response.embeddings).toEqual([[0.25, -0.5]]);
	});

	it('preserves the HTTP status and error code of an API failure', async () => {
		reply = {
			status: 401,
			json: { error: { message: 'bad key', type: 'auth_error', code: 'invalid_api_key' } },
		};

		const error = await makeProvider()
			.sendConversation([{ role: 'user', content: 'hi' }])
			.catch((e) => e);

		expect(error).toBeInstanceOf(APIError);
		expect(error.message).toContain('bad key');
		expect(error.code).toBe(401);
		expect(error.details.code).toBe('invalid_api_key');
	});
});

describe('OpenAIProvider structured output on the real openai SDK', () => {
	const provider = () =>
		new OpenAIProvider('test-key', 'test-model', new NoopLogger(), { endpoint: baseURL });

	it.each([
		['Zod 3', z3],
		['Zod 4', z4],
	])('parses a structured completion against a %s schema', async (_l, z) => {
		reply = { json: completion({ content: '{"title":"T","score":4}' }) };
		const schema = z.object({ title: z.string(), score: z.number() });

		const response = await provider().sendStructuredConversation(
			[{ role: 'user', content: 'rate it' }],
			schema
		);

		const format = requests[0].body.response_format;
		expect(requests[0].path).toBe('/v1/chat/completions');
		expect(format.type).toBe('json_schema');
		expect(format.json_schema).toMatchObject({
			name: 'structured_output',
			strict: true,
			schema: {
				type: 'object',
				properties: { title: { type: 'string' }, score: { type: 'number' } },
				required: ['title', 'score'],
				additionalProperties: false,
			},
		});
		expect(response.parsed).toEqual({ title: 'T', score: 4 });
		expect(response.content).toBe('{"title":"T","score":4}');
	});

	it('surfaces a refusal as an APIError', async () => {
		reply = { json: completion({ content: null, refusal: 'no' }) };

		await expect(
			provider().sendStructuredConversation(
				[{ role: 'user', content: 'x' }],
				z4.object({ a: z4.string() })
			)
		).rejects.toThrow(/refused structured output: no/);
	});
});
