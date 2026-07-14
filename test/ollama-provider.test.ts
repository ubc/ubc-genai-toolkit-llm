import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { NoopLogger } from 'ubc-genai-toolkit-core';

const chatMock = vi.fn();

vi.mock('ollama', () => ({
	Ollama: class {
		chat = chatMock;
		list = vi.fn();
		embed = vi.fn();
	},
}));

import { OllamaProvider } from '../src/providers/ollama-provider';

const calculator = {
	name: 'calculator',
	description: 'Evaluate arithmetic.',
	parameters: z.object({ expression: z.string() }),
};

beforeEach(() => chatMock.mockReset());

describe('OllamaProvider tool calling', () => {
	it('passes translated tools and normalizes tool_calls with synthesized ids', async () => {
		chatMock.mockResolvedValue({
			model: 'llama3.1',
			done: true,
			done_reason: 'stop',
			message: {
				role: 'assistant',
				content: '',
				tool_calls: [
					{ function: { name: 'calculator', arguments: { expression: '1+1' } } },
				],
			},
			prompt_eval_count: 10,
			eval_count: 5,
		});

		const provider = new OllamaProvider(
			'http://127.0.0.1:11434',
			'llama3.1',
			new NoopLogger()
		);
		const response = await provider.sendConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			{ tools: [calculator], toolChoice: 'auto' }
		);

		const params = chatMock.mock.calls[0][0];
		expect(params.tools[0].function.name).toBe('calculator');
		// toolChoice has no Ollama equivalent and must not reach the client (incl. via options passthrough)
		expect(params.tool_choice).toBeUndefined();
		expect(params.options.toolChoice).toBeUndefined();

		expect(response.toolCalls).toEqual([
			{ id: 'ollama_call_0', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});

	it('collects streamed tool_calls into the final response', async () => {
		async function* fakeStream() {
			yield { message: { content: '' }, done: false };
			yield {
				message: {
					content: '',
					tool_calls: [
						{ function: { name: 'calculator', arguments: { expression: '1+1' } } },
					],
				},
				done: true,
				done_reason: 'stop',
			};
		}
		chatMock.mockResolvedValue(fakeStream());

		const provider = new OllamaProvider(
			'http://127.0.0.1:11434',
			'llama3.1',
			new NoopLogger()
		);
		const response = await provider.streamConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			() => {},
			{ tools: [calculator] }
		);

		expect(response.toolCalls).toEqual([
			{ id: 'ollama_call_0', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});

	it('rejects tools on the structured path', async () => {
		const provider = new OllamaProvider(
			'http://127.0.0.1:11434',
			'llama3.1',
			new NoopLogger()
		);
		await expect(
			provider.sendStructuredConversation(
				[{ role: 'user', content: 'x' }],
				z.object({ a: z.string() }),
				{ tools: [calculator] }
			)
		).rejects.toThrowError(/structured/i);
	});
});
