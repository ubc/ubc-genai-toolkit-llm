import { describe, it, expect } from 'vitest';
import { getDisplayMessages } from '../src/display';
import type { Message } from '../src/types';

describe('getDisplayMessages', () => {
	it('keeps user/assistant text and drops system, tool, and tool-call-only messages', () => {
		const history: Message[] = [
			{ role: 'system', content: 'be nice' },
			{ role: 'user', content: 'What is 15% of 847?' },
			{
				role: 'assistant',
				content: '',
				toolCalls: [{ id: 'c1', name: 'calculator', arguments: {} }],
			},
			{ role: 'tool', content: '127.05', toolCallId: 'c1' },
			{ role: 'assistant', content: '15% of 847 is 127.05.' },
		];
		expect(getDisplayMessages(history)).toEqual([
			{ role: 'user', content: 'What is 15% of 847?' },
			{ role: 'assistant', content: '15% of 847 is 127.05.' },
		]);
	});

	it('keeps an assistant message that has BOTH text and toolCalls (the text is user-visible)', () => {
		const history: Message[] = [
			{
				role: 'assistant',
				content: 'Let me check that for you.',
				toolCalls: [{ id: 'c1', name: 'calculator', arguments: {} }],
			},
		];
		expect(getDisplayMessages(history)).toHaveLength(1);
	});
});
