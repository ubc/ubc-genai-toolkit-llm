/**
 * @fileoverview **Non-interactive** smoke test for `LLMModule.sendStructuredConversation`.
 *
 * ## Difference from `npm start` (`index.ts` → `app.ts`)
 *
 * | | Main CLI (`npm start`) | This script (`npm run structured-demo`) |
 * |-|------------------------|------------------------------------------|
 * | Interaction | Menu + chat loops | Runs once, then exits |
 * | Goal | Teach modes (normal vs Zod demos) | Prove one Zod schema end-to-end |
 *
 * ## What it does
 *
 * 1. Loads the same env config as the main app (`loadConfig()`).
 * 2. Sends a **fixed sample paragraph** plus a short instruction.
 * 3. Expects JSON matching `ParagraphAnalysisSchema` (`topic`, `numberOfWord`).
 * 4. **Asserts** types at runtime and prints the parsed object (or throws).
 *
 * ## Prerequisites
 *
 * - Build the parent package and this example (`npm run build` in repo root and in `example/`).
 * - Set the same env vars as the main app; **`LLM_DEFAULT_MODEL` is required** here.
 * - Use a provider that supports structured output (not `ubc-llm-sandbox` for this path).
 */

import { z } from 'zod';
import { LLMModule, LLMConfig } from 'ubc-genai-toolkit-llm';
import { ConfigurationError } from 'ubc-genai-toolkit-core';
import { loadConfig } from './config';

/** Expected JSON shape returned by the model for the sample paragraph task. */
const ParagraphAnalysisSchema = z.object({
	topic: z.string(),
	numberOfWord: z.number(),
});

const SAMPLE_PARAGRAPH =
	'Machine learning helps systems improve from experience without explicit programming. ' +
	'Applications range from vision to language understanding.';

/** Small helper so failed assertions read clearly in the console. */
function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`);
	}
}

async function main(): Promise<void> {
	const config = loadConfig();

	if (!config.defaultModel) {
		throw new ConfigurationError(
			'LLM_DEFAULT_MODEL is required for structured-paragraph-demo'
		);
	}

	const llm = new LLMModule(config as Partial<LLMConfig>);

	const messages = [
		{
			role: 'user' as const,
			content:
				'Analyze the following paragraph. Reply only as JSON matching the schema (topic = short main theme, numberOfWord = word count of the paragraph).\n\n' +
				SAMPLE_PARAGRAPH,
		},
	];

	const result = await llm.sendStructuredConversation(
		messages,
		ParagraphAnalysisSchema,
		{
			temperature: 0.2,
			maxTokens: 256,
			structuredOutputName: 'paragraph_analysis',
		}
	);

	const { parsed } = result;
	assert(typeof parsed.topic === 'string', 'parsed.topic must be string');
	assert(typeof parsed.numberOfWord === 'number', 'parsed.numberOfWord must be number');

	console.log('Provider:', llm.getProviderName());
	console.log('Parsed:', JSON.stringify(parsed, null, 2));
	console.log('Raw content length:', result.content.length);
	console.log('Structured paragraph demo: OK');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
