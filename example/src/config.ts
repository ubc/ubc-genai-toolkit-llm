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
 * | `LLM_EMBEDDING_MODEL` | Yes if you call `embed()` | Embedding model id |
 * | `DEBUG` | No | Set to `true` for more verbose toolkit logging |
 *
 * If `LLM_DEFAULT_MODEL` is missing, some demos (e.g. `structured-paragraph-demo`) will error until you set it.
 *
 * ## UBC LLM Sandbox
 *
 * ```
 * LLM_PROVIDER=ubc-llm-sandbox
 * LLM_API_KEY=<your sandbox key>
 * LLM_ENDPOINT=https://ai-stg.apps.ctlt.ubc.ca/v1   # production: https://ai.apps.ctlt.ubc.ca/v1
 * LLM_DEFAULT_MODEL=qwen3.6-35b-a3b                 # or gpt-oss-120b for reasoning
 * LLM_EMBEDDING_MODEL=qwen3-embedding-0.6b
 * ```
 */

import dotenv from 'dotenv';
import { LLMConfig } from 'ubc-genai-toolkit-llm';
import { ConsoleLogger } from 'ubc-genai-toolkit-core';

// Load environment variables from a .env file into process.env
// Ensures that variables defined in .env are available for the configuration.
dotenv.config();

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
export function loadConfig(): Partial<LLMConfig> {
	// Backend selector for `LLMModule` (must match a registered provider name).
	const provider = (process.env.LLM_PROVIDER || 'openai') as
		| 'openai'
		| 'anthropic'
		| 'ollama'
		| 'ubc-llm-sandbox';

	// Get the API key from environment variables. Required for providers like OpenAI.
	const apiKey = process.env.LLM_API_KEY;

	// Get the API endpoint URL. Required for providers like Ollama or self-hosted OpenAI compatible APIs.
	const endpoint = process.env.LLM_ENDPOINT;

	// Get the default model name. Specific default depends on provider if not set.
	const defaultModel = process.env.LLM_DEFAULT_MODEL;

	// Model used by `embed()`. Providers fall back to 'nomic-embed-text' when this
	// is unset, which is rarely what you want — set it explicitly.
	const embeddingModel = process.env.LLM_EMBEDDING_MODEL;

	// Create a simple console logger instance.
	// This logger will be passed to the LLMModule for internal logging.
	const logger = new ConsoleLogger('LLMConversation');

	// Construct and return the LLMConfig object.
	return {
		provider,    // 'openai', 'ollama', etc.
		apiKey,      // API key (if applicable)
		endpoint,    // Endpoint URL (if applicable)
		defaultModel,// Default model name (now potentially undefined)
		embeddingModel, // Embedding model name (if applicable)
		logger,      // Logger instance
		debug: process.env.DEBUG === 'true', // Enable debug logging if DEBUG=true
	};
}
