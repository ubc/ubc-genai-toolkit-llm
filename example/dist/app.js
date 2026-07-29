"use strict";
/**
 * @fileoverview Interactive CLI demo for the UBC GenAI Toolkit LLM module.
 *
 * ## What this file does
 *
 * 1. Shows a **menu** (arrow keys + Enter) so you can pick how to talk to the model.
 * 2. Runs one of three **modes**: normal streaming chat, or two demos that use
 *    **Zod schemas** so the model must reply in a fixed JSON shape.
 *
 * ## How to run
 *
 * From the `example/` folder (after `npm install` and `npm run build`):
 *
 * - `npm start` — this app (menu + chat).
 * - `npm run structured-demo` — separate one-shot script; see `structured-paragraph-demo.ts`.
 *
 * ## Libraries (why they exist)
 *
 * - **@inquirer/select** — draws the menu; Node’s built-in readline cannot move a highlight with ↑/↓.
 * - **readline-sync** — simple `You:` text prompts inside each mode after the menu.
 * - **zod** — describes the JSON shape we want from the model; the toolkit validates the reply.
 *
 * ## Provider note
 *
 * Structured modes need a provider that implements `sendStructuredConversation`. The
 * **ubc-llm-sandbox** provider does not (yet), so we show an error if you pick a structured mode there.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationApp = void 0;
const readline_sync_1 = __importDefault(require("readline-sync"));
const select_1 = __importDefault(require("@inquirer/select"));
const zod_1 = require("zod");
const ubc_genai_toolkit_llm_1 = require("ubc-genai-toolkit-llm");
const ubc_genai_toolkit_core_1 = require("ubc-genai-toolkit-core");
/**
 * JSON shape for the "Contextless Linguist" demo.
 * Property names include **spaces** on purpose — it shows that Zod keys can match odd JSON keys.
 */
const ContextlessLinguistSchema = zod_1.z.object({
    'Topic summary': zod_1.z.string(),
    'Number of words': zod_1.z.number(),
});
/**
 * JSON shape for the "Isolated Engineer / Scientist" demo (plain `answer` / `explanation` keys).
 */
const IsolatedEngineerSchema = zod_1.z.object({
    answer: zod_1.z.string(),
    explanation: zod_1.z.string(),
});
/**
 * Orchestrates the example CLI: menu, then the selected conversation mode.
 *
 * Flow: `run()` → `promptDemoMode()` → one of `runNormalConversation` or
 * `runStructuredConversationLoop` depending on the choice.
 */
class ConversationApp {
    /**
     * constructor for the ConversationApp class
     * @param config - Same shape as `loadConfig()` from `config.ts` (provider, keys, model, logger).
     *                  Passed straight into {@link LLMModule}.
     */
    constructor(config) {
        // Initialize the LLMModule with the given configuration.
        // The LLMModule acts as a facade to the underlying LLM provider (OpenAI, Ollama, etc.).
        this.llm = new ubc_genai_toolkit_llm_1.LLMModule(config);
    }
    /**
     * Entry point called from `index.ts`.
     *
     * Steps:
     * 1. Print banner and current provider name.
     * 2. Show the interactive menu (or exit if the user cancels with Ctrl+C).
     * 3. Branch to normal chat vs. structured demos; structured demos are blocked on sandbox.
     */
    async run() {
        console.log(`=== UBC GenAI Toolkit - LLM Conversation Example ===`);
        console.log(`Provider: ${this.llm.getProviderName()}`);
        const mode = await this.promptDemoMode();
        if (mode === undefined) {
            console.log('Cancelled.');
            return;
        }
        if (mode === 'normal') {
            await this.runNormalConversation();
            return;
        }
        if (this.llm.getProviderName() === 'ubc-llm-sandbox') {
            console.error('Structured modes (Contextless Linguist / Isolated Engineer) are not supported for ubc-llm-sandbox in this toolkit version. Use openai, anthropic, or ollama, or restart and choose Normal Conversation.');
            return;
        }
        if (mode === 'linguist') {
            await this.runStructuredConversationLoop(ContextlessLinguistSchema, 'Contextless Linguist', 'contextless_linguist', 'Paste or type text. The model returns JSON with "Topic summary" and "Number of words" only (no system prompt).');
            return;
        }
        await this.runStructuredConversationLoop(IsolatedEngineerSchema, 'Isolated Engineer / Scientist', 'isolated_engineer', 'Ask a question. The model returns JSON with "answer" and "explanation" only (no system prompt).');
    }
    /**
     * Shows the arrow-key menu. Returns `undefined` if the user aborts (e.g. Ctrl+C), which we treat as cancel.
     */
    async promptDemoMode() {
        try {
            return await (0, select_1.default)({
                // The message that will be displayed to the user to choose a mode.
                message: 'Choose a mode (use arrow keys, Enter to confirm)',
                // - Normal Conversation: Streaming chat, default system prompt, no structured JSON.
                // - Contextless Linguist: No system prompt; structured { "Topic summary": string, "Number of words": number }.
                // - Isolated Engineer / Scientist: No system prompt; structured { answer: string, explanation: string }.
                choices: [
                    {
                        value: 'normal',
                        name: 'Normal Conversation',
                        description: 'Streaming chat, default system prompt, no structured JSON',
                    },
                    {
                        value: 'linguist',
                        name: 'Contextless Linguist',
                        description: 'No system prompt; structured { "Topic summary": string, "Number of words": number }',
                    },
                    {
                        value: 'engineer',
                        name: 'Isolated Engineer / Scientist',
                        description: 'No system prompt; structured { answer: string, explanation: string }',
                    },
                ],
            });
        }
        catch {
            return undefined;
        }
    }
    /**
     * Options passed to {@link Conversation.stream} in normal mode.
     * `num_ctx` is an Ollama-only knob (context window); other providers ignore unknown fields where safe.
     */
    buildStreamOptions() {
        // Default options for the LLM.
        const opts = { temperature: 0.5 };
        // If the provider is Ollama, set the context window to 32768 tokens.
        if (this.llm.getProviderName() === 'ollama') {
            opts.num_ctx = 32768;
        }
        return opts;
    }
    /**
     * Options for {@link Conversation.sendStructured}. Includes `structuredOutputName` for OpenAI’s
     * JSON-schema name field; other providers may ignore it.
     */
    buildStructuredOptions(structuredOutputName) {
        const opts = {
            temperature: 0.3,
            maxTokens: 1024,
            structuredOutputName,
        };
        if (this.llm.getProviderName() === 'ollama') {
            opts.num_ctx = 32768;
        }
        return opts;
    }
    /**
     * **Normal mode** — closest to a classic chat app.
     *
     * - Adds a **system** message so the model behaves as a helpful assistant.
     * - Uses **streaming**: tokens print as they arrive (`conversation.stream`).
     */
    async runNormalConversation() {
        const conversation = this.llm.createConversation();
        conversation.addMessage('system', 'You are a helpful assistant that provides clear, concise answers.');
        const activeOptions = this.buildStreamOptions();
        console.log('\nNormal mode. Type exit or quit to leave.');
        console.log('Using LLM options:', activeOptions);
        try {
            while (true) {
                // Prompt the user for input.
                const userInput = readline_sync_1.default.question('\nYou: ');
                if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
                    console.log('Goodbye!');
                    break;
                }
                // Add the user's message to the conversation history.
                conversation.addMessage('user', userInput);
                console.log('\nAssistant: ');
                // Stream the LLM's response back to the console.
                await conversation.stream((chunk) => process.stdout.write(chunk), activeOptions);
                console.log('\n');
            }
        }
        catch (error) {
            this.logError(error);
        }
    }
    /**
     * **Structured mode** — no system message; each reply must match the given Zod `schema`.
     *
     * The toolkit asks the provider for JSON matching the schema, then exposes `result.parsed`
     * (already validated). We pretty-print it here.
     *
     * @param schema - Zod object describing allowed JSON keys and types.
     * @param modeTitle - Shown as a section header in the terminal.
     * @param structuredOutputName - Passed to the LLM layer (mainly for OpenAI’s schema `name`).
     * @param intro - Short instructions printed once when the mode starts.
     */
    async runStructuredConversationLoop(schema, modeTitle, structuredOutputName, intro) {
        const conversation = this.llm.createConversation();
        const options = this.buildStructuredOptions(structuredOutputName);
        // Print the mode title and introduction.
        console.log(`\n--- ${modeTitle} ---`);
        console.log(intro);
        console.log('Type exit or quit to leave.\n');
        try {
            while (true) {
                // Prompt the user for input.
                const userInput = readline_sync_1.default.question('You: ');
                if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
                    console.log('Goodbye!');
                    break;
                }
                // Add the user's message to the conversation history.
                conversation.addMessage('user', userInput);
                // Print the structured reply (parsed).
                console.log('\nStructured reply (parsed):');
                // Send the structured conversation to the LLM.
                const result = await conversation.sendStructured(schema, options);
                // Print the structured reply (parsed).
                console.log(JSON.stringify(result.parsed, null, 2));
                console.log('');
            }
        }
        catch (error) {
            this.logError(error);
        }
    }
    /**
     * Maps toolkit / provider errors to readable console output for learners.
     */
    logError(error) {
        // If the error is a ToolkitError, print the error message and details.
        if (error instanceof ubc_genai_toolkit_core_1.ToolkitError) {
            console.error(`Error: ${error.message} (Code: ${error.code})`);
            if (error.details) {
                console.error('Details:', error.details);
            }
            // If the error is an APIError, print the error message and details.
        }
        else if (error instanceof ubc_genai_toolkit_core_1.APIError) {
            console.error(`Error: ${error.message} (Code: ${error.code})`);
            if (error.details) {
                console.error('Details:', error.details);
            }
            // If the error is not a ToolkitError or APIError, print the error message.
        }
        else {
            console.error('An unexpected error occurred:', error);
        }
    }
}
exports.ConversationApp = ConversationApp;
