/**
 * @fileoverview Helper for rendering conversation histories that contain
 * tool-calling machinery.
 */

import { Message } from './types';

/**
 * Filters a conversation history down to what an end user should see: `user`
 * and `assistant` messages that carry text. System prompts, `role: 'tool'`
 * results, and tool-call-only assistant turns (empty `content`) are internal
 * machinery and are dropped.
 *
 * Apps that want to surface tool activity ("used calculator…") should read the
 * full history deliberately instead of using this helper.
 *
 * @param messages - Full conversation history, possibly including tool traffic.
 * @returns The user-visible subset, in order. The original array is untouched.
 */
export function getDisplayMessages(messages: Message[]): Message[] {
	return messages.filter(
		(msg) =>
			(msg.role === 'user' || msg.role === 'assistant') &&
			msg.content.trim().length > 0
	);
}
