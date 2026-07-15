"use strict";
/**
 * @fileoverview Helper for rendering conversation histories that contain
 * tool-calling machinery.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDisplayMessages = getDisplayMessages;
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
function getDisplayMessages(messages) {
    return messages.filter((msg) => (msg.role === 'user' || msg.role === 'assistant') &&
        msg.content.trim().length > 0);
}
//# sourceMappingURL=display.js.map