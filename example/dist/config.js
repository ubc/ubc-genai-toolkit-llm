"use strict";
/**
 * @fileoverview Loads **environment variables** into a config object for `LLMModule`.
 *
 * ## Why a separate file?
 *
 * Keeping config in one place makes it obvious what you must set before running the example,
 * and matches how a real app would load secrets (never hard-code API keys in source).
 *
 * ## `.env` file (optional but recommended)
 *
 * Create `example/.env` (this file is usually git-ignored) with lines like:
 *
 * ```
 * LLM_PROVIDER=openai
 * LLM_API_KEY=sk-...
 * LLM_DEFAULT_MODEL=gpt-4o
 * ```
 *
 * `dotenv.config()` runs when this module loads and copies those into `process.env`.
 *
 * ## Environment variables (quick reference)
 *
 * | Variable | Required? | Purpose |
 * |----------|-----------|---------|
 * | `LLM_PROVIDER` | No (default `openai`) | `openai` \| `anthropic` \| `ollama` \| `ubc-llm-sandbox` |
 * | `LLM_API_KEY` | Yes for OpenAI, Anthropic, sandbox | Secret token for the API |
 * | `LLM_ENDPOINT` | Yes for `ollama`, sandbox | Base URL (e.g. `http://127.0.0.1:11434` for Ollama) |
 * | `LLM_DEFAULT_MODEL` | Strongly recommended | Model id (e.g. `gpt-4o`, `claude-sonnet-4-5-20250929`) |
 * | `DEBUG` | No | Set to `true` for more verbose toolkit logging |
 *
 * If `LLM_DEFAULT_MODEL` is missing, some demos (e.g. `structured-paragraph-demo`) will error until you set it.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const dotenv_1 = __importDefault(require("dotenv"));
const ubc_genai_toolkit_core_1 = require("ubc-genai-toolkit-core");
// Load environment variables from a .env file into process.env
// Ensures that variables defined in .env are available for the configuration.
dotenv_1.default.config();
/**
 * Loads LLM configuration from environment variables.
 *
 * Reads environment variables prefixed typically with `LLM_` (e.g., `LLM_PROVIDER`, `LLM_API_KEY`)
 * and constructs an `LLMConfig` object suitable for initializing the `LLMModule`.
 * Provides default values for provider ('openai') if not specified.
 * Also initializes a `ConsoleLogger` for use within the LLM module.
 *
 * @returns {LLMConfig} The configuration object for the LLM module.
 */
function loadConfig() {
    // Backend selector for `LLMModule` (must match a registered provider name).
    const provider = (process.env.LLM_PROVIDER || 'openai');
    // Get the API key from environment variables. Required for providers like OpenAI.
    const apiKey = process.env.LLM_API_KEY;
    // Get the API endpoint URL. Required for providers like Ollama or self-hosted OpenAI compatible APIs.
    const endpoint = process.env.LLM_ENDPOINT;
    // Get the default model name. Specific default depends on provider if not set.
    const defaultModel = process.env.LLM_DEFAULT_MODEL;
    // Create a simple console logger instance.
    // This logger will be passed to the LLMModule for internal logging.
    const logger = new ubc_genai_toolkit_core_1.ConsoleLogger('LLMConversation');
    // Construct and return the LLMConfig object.
    return {
        provider, // 'openai', 'ollama', etc.
        apiKey, // API key (if applicable)
        endpoint, // Endpoint URL (if applicable)
        defaultModel, // Default model name (now potentially undefined)
        logger, // Logger instance
        debug: process.env.DEBUG === 'true', // Enable debug logging if DEBUG=true
    };
}
