"use strict";
/**
 * @fileoverview One-shot demo of tool calling with the LLM module.
 *
 * ## What this file does
 *
 * Defines a `calculator` tool (a tiny safe arithmetic evaluator), asks the
 * model a question that needs it, and runs the standard tool-calling loop:
 * send → execute requested tools → send results back → print the final answer.
 *
 * ## How to run
 *
 * From the `example/` folder (after `npm install` and `npm run build`):
 *
 * - `npm run tool-demo`
 *
 * Uses the same `.env` configuration as the main example app (see `config.ts`).
 * The configured model must support tool calling (most current OpenAI,
 * Anthropic, and larger Ollama models do).
 */
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const ubc_genai_toolkit_llm_1 = require("ubc-genai-toolkit-llm");
const config_1 = require("./config");
/**
 * Safe arithmetic evaluator: digits, whitespace, and + - * / ( ) . % only.
 * Never pass model-controlled strings to eval(); this allowlist keeps the
 * demo honest about that rule.
 */
function evaluateExpression(expression) {
    if (!/^[\d\s+\-*/().%]+$/.test(expression)) {
        throw new Error(`Unsupported characters in expression: ${expression}`);
    }
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${expression});`)();
}
const calculator = {
    name: 'calculator',
    description: 'Evaluate a basic arithmetic expression using + - * / ( ) and decimal numbers, e.g. "847 * 0.15".',
    parameters: zod_1.z.object({
        expression: zod_1.z.string().describe('The arithmetic expression to evaluate.'),
    }),
};
async function main() {
    const llm = new ubc_genai_toolkit_llm_1.LLMModule((0, config_1.loadConfig)());
    console.log(`Provider: ${llm.getProviderName()}`);
    const messages = [
        {
            role: 'user',
            content: 'A course has 847 students and 15% of them scored an A. How many students scored an A? Use the calculator tool.',
        },
    ];
    const maxIterations = 10;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
        const response = await llm.sendConversation(messages, {
            tools: [calculator],
        });
        if (!response.toolCalls || response.toolCalls.length === 0) {
            console.log(`\nAssistant: ${response.content}`);
            break;
        }
        messages.push({
            role: 'assistant',
            content: response.content,
            toolCalls: response.toolCalls,
        });
        for (const call of response.toolCalls) {
            console.log(`\n[tool call] ${call.name}(${JSON.stringify(call.arguments)})`);
            let resultText;
            try {
                const result = evaluateExpression(String(call.arguments.expression));
                resultText = String(result);
            }
            catch (error) {
                // Errors go back to the model as results so it can recover.
                resultText = `Error: ${error instanceof Error ? error.message : String(error)}`;
            }
            console.log(`[tool result] ${resultText}`);
            messages.push({
                role: 'tool',
                content: resultText,
                toolCallId: call.id,
            });
        }
    }
    console.log('\n--- What an end user would see ---');
    for (const msg of (0, ubc_genai_toolkit_llm_1.getDisplayMessages)(messages)) {
        console.log(`${msg.role}: ${msg.content}`);
    }
}
main().catch((error) => {
    console.error('Tool-calling demo failed:', error);
    process.exit(1);
});
