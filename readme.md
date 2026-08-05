# UBC GenAI Toolkit - LLM Module

## Overview

This module provides a standardized interface for interacting with various Large Language Models (LLMs). It follows the Facade pattern, simplifying interactions with different LLM providers like OpenAI, Anthropic, Ollama, and the UBC LLM Sandbox, while shielding your application from underlying SDK changes.

Applications can use this module to send single messages, manage conversation history, stream responses, and list available models, all through a consistent API.

## Installation

```bash
npm install ubc-genai-toolkit-llm ubc-genai-toolkit-core
```

## Core Concepts

-   **`LLMModule`**: The main class and entry point for interacting with LLMs. You configure it once with your provider details.
-   **Providers**: The module supports different LLM providers (`openai`, `anthropic`, `ollama`, `ubc-llm-sandbox`). The specific provider implementation is handled internally based on your configuration.
-   **`Conversation`**: A helper class obtained via `llmModule.createConversation()` to easily manage multi-turn chat history and interact with the LLM contextually.
-   **`LLMOptions`**: An interface defining parameters you can pass to customize LLM requests (e.g., `model`, `temperature`, `reasoningEffort`, `maxTokens`, `systemPrompt`).
-   **`LLMResponse`**: A standardized response format returned by the module, containing the LLM's content, model used, usage statistics (where available), and metadata.

## Configuration

The `LLMModule` is configured during instantiation with an `LLMConfig` object.

```typescript
import { LLMModule, LLMConfig } from 'ubc-genai-toolkit-llm';
import { ConsoleLogger } from 'ubc-genai-toolkit-core'; // Example logger

// General Structure
interface LLMConfig {
	provider: 'openai' | 'anthropic' | 'ollama' | 'ubc-llm-sandbox' | string; // Specify the provider
	apiKey?: string; // Required for OpenAI, Anthropic, UBC LLM Sandbox
	endpoint?: string; // Required for Ollama, UBC LLM Sandbox, optional for OpenAI-compatible APIs
	defaultModel: string; // Default model ID to use for requests
	logger?: LoggerInterface; // Optional: Provide a logger instance
	defaultOptions?: LLMOptions; // Optional: Default parameters for all requests
}

interface LLMOptions {
	model?: string; // Override the default model for a specific request
	temperature?: number; // Sampling temperature
	reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'; // Unified reasoning depth (provider-specific mapping)
	maxTokens?: number; // Maximum tokens to generate
	systemPrompt?: string; // System prompt to guide the model
	responseFormat?: 'text' | 'json'; // Specify response format (provider support varies)
	// Other provider-specific options might be passed here
	[key: string]: any;
}

// --- Example Configurations ---

// OpenAI
const openAIConfig: LLMConfig = {
	provider: 'openai',
	apiKey: process.env.OPENAI_API_KEY, // Use environment variables
	defaultModel: 'gpt-4o',
	logger: new ConsoleLogger(),
	defaultOptions: {
		temperature: 0.7,
	},
};

// Anthropic
const anthropicConfig: LLMConfig = {
	provider: 'anthropic',
	apiKey: process.env.ANTHROPIC_API_KEY, // Use environment variables
	defaultModel: 'claude-3-5-sonnet-20240620',
	logger: new ConsoleLogger(),
};

// Ollama
const ollamaConfig: LLMConfig = {
	provider: 'ollama',
	// Ensure the Ollama service is running at this endpoint
	endpoint: 'http://localhost:11434',
	// Ensure this model is pulled (`ollama pull llama3`)
	defaultModel: 'llama3',
	logger: new ConsoleLogger(),
};

// UBC LLM Sandbox (using an OpenAI-compatible API)
import { UBC_LLM_SANDBOX_ENDPOINTS, UBC_LLM_SANDBOX_MODELS } from 'ubc-genai-toolkit-llm';

const ubcSandboxConfig: LLMConfig = {
	provider: 'ubc-llm-sandbox',
	apiKey: process.env.UBC_LLM_SANDBOX_API_KEY, // Use environment variables
	// 'https://ai-stg.apps.ctlt.ubc.ca/v1' — see UBC LLM Sandbox Provider below
	endpoint: UBC_LLM_SANDBOX_ENDPOINTS.staging,
	defaultModel: UBC_LLM_SANDBOX_MODELS.chat, // 'qwen3.6-35b-a3b'
	embeddingModel: UBC_LLM_SANDBOX_MODELS.embedding, // 'qwen3-embedding-0.6b'
	logger: new ConsoleLogger(),
};

// Instantiate the module
// const llm = new LLMModule(openAIConfig);
// const llm = new LLMModule(anthropicConfig);
const llm = new LLMModule(ollamaConfig); // Example using Ollama
```

## Usage Examples

### Initialization

```typescript
import { LLMModule } from 'ubc-genai-toolkit-llm';
import { ConsoleLogger } from 'ubc-genai-toolkit-core';

const config: LLMConfig = {
	provider: 'ubc-llm-sandbox', // Or 'openai', 'anthropic', 'ollama'
	apiKey: process.env.UBC_LLM_SANDBOX_API_KEY,
	endpoint: process.env.UBC_LLM_SANDBOX_ENDPOINT,
	defaultModel: 'qwen3.6-35b-a3b', // Ensure this model is available in the sandbox
	logger: new ConsoleLogger(),
};

const llm = new LLMModule(config);
```

### Sending a Single Message

```typescript
async function askQuestion(question: string) {
	try {
		const response = await llm.sendMessage(question, {
			// Optional: override default model or add options
			// model: 'claude-3-haiku-20240307',
			temperature: 0.5,
			maxTokens: 150,
		});
		console.log('Assistant:', response.content);
		console.log('Usage:', response.usage);
	} catch (error) {
		console.error('Error sending message:', error);
	}
}

askQuestion('What is the UBC GenAI Toolkit?');
```

### Managing Conversations

```typescript
async function runConversation() {
	const conversation = llm.createConversation();

	conversation.addMessage('system', 'You are a helpful assistant.');
	conversation.addMessage('user', 'What is the capital of France?');

	try {
		let response = await conversation.send({ maxTokens: 50 });
		console.log('Assistant:', response.content);

		// The assistant's response is automatically added to history.
		console.log('History:', conversation.getHistory());

		conversation.addMessage('user', 'What is its population?');
		response = await conversation.send({ maxTokens: 100 });
		console.log('Assistant:', response.content);
	} catch (error) {
		console.error('Error during conversation:', error);
	}
}

runConversation();
```

### Streaming Responses

Use `streamConversation` directly or the `conversation.stream()` helper.

```typescript
async function streamChat() {
	const conversation = llm.createConversation();
	conversation.addMessage(
		'user',
		'Tell me a short story about a robot learning to paint.'
	);

	try {
		process.stdout.write('Assistant: ');
		const finalResponse = await conversation.stream(
			(chunk: string) => {
				// Process each chunk as it arrives
				process.stdout.write(chunk);
			},
			{ maxTokens: 500 }
		);
		process.stdout.write('\n'); // Add newline after stream finishes
		console.log('\n--- Stream Complete ---');
		// Note: finalResponse.usage will be undefined for streams
		console.log('Model used:', finalResponse.model);
	} catch (error) {
		console.error('\nError during streaming:', error);
	}
}

streamChat();
```

### Structured output (Zod)

`Conversation.sendStructured` / `LLMModule.sendStructuredConversation` ask the model for JSON that matches your Zod schema. **OpenAI** and **Anthropic** rely on the official SDK structured-parse path (`parsed` / `parsed_output`); if the API does not return a parsed payload, the call fails with an `APIError`. **Ollama** sends JSON Schema in `format`, then runs `JSON.parse` on the **entire** assistant `message.content` string and validates with `schema.safeParse`, so the body must be valid JSON only (no leading or trailing prose). Invalid or non-conforming output still fails with an `APIError`. UBC LLM Sandbox does not implement structured output in this version.

See **[Providers & Models](#providers--models)** for a per-provider table of who supports structured output.

### Reasoning effort & temperature

> **Warning:** Do not combine `temperature` with reasoning on models that reject sampling parameters. On some models, such as **gpt-5-mini**, temperature is unsupported when reasoning is active — omit `temperature` yourself or the API will return an error.

Use the unified `reasoningEffort` option on `LLMOptions`. Each provider maps it to native API fields; **you** choose a value supported by your model (see table below). Unsupported values are rejected by the provider API, not rewritten by this module.

| Model | Temperature | Reasoning effort | Docs |
|---|---|---|---|
| gpt-4o-mini | Yes | No | [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini) |
| gpt-5-mini | No (when reasoning active) | Yes — `minimal`, `low`, `medium`, `high` | [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini) |
| gpt-oss-120b (UBC LLM Sandbox) | Yes | Yes — `low`, `medium`, `high` (others clamped) | [UBC LLM Sandbox Provider](#ubc-llm-sandbox-provider) |

The one exception to "not rewritten by this module" is the UBC LLM Sandbox,
which clamps efforts onto the target model's native scale — see
[UBC LLM Sandbox Provider](#ubc-llm-sandbox-provider).

**Usage (OpenAI gpt-5-mini):**

```typescript
await llm.sendMessage('Explain quicksort.', {
	reasoningEffort: 'low',
	maxTokens: 1024,
});
```

On **Anthropic**, adaptive models (Sonnet 4.6+, Opus 4.7+, Sonnet 5) receive `thinking: { type: 'adaptive' }` plus `output_config.effort`. Older models fall back to approximate `budget_tokens` tiers. On **Ollama**, `think` is sent as a top-level chat field (`false` or `'low'`/`'medium'`/`'high'`/`'max'`). Model support varies — some Ollama models ignore `think: false`.

### Images (multi-modal input)

Any message can carry images for vision-capable models by adding an `images`
array alongside `content`. Each image is base64-encoded bytes plus a MIME type:

```typescript
import fs from 'fs';

const base64 = fs.readFileSync('chart.png').toString('base64');

const response = await llm.sendConversation(
	[
		{
			role: 'user',
			content: 'Describe this chart in two sentences.',
			images: [{ data: base64, mimeType: 'image/png' }],
		},
	],
	{ model: 'gpt-5-nano' }
);
```

- `data` is raw base64 **without** a `data:` URI prefix (e.g.
  `buffer.toString('base64')`); each provider wraps it as needed.
- Messages without `images` are sent as a plain text string exactly as before —
  this is fully backwards compatible.
- Images combine with **structured output**, so you can ask a vision model to
  return Zod-validated JSON describing an image.
- Supported on **OpenAI**, **UBC LLM Sandbox** (OpenAI-compatible), **Anthropic**,
  and **Ollama** (vision-capable models such as `llava`). Sending images to a
  model that can't accept them surfaces the provider's own error.

### Tool Calling

Tools let the model request that *your code* run something (a calculation, a
lookup) and then continue with the result. A tool is a name, a description the
model reads, and a Zod schema for its arguments:

```typescript
import { z } from 'zod';
import { LLMModule, Message, ToolDefinition } from 'ubc-genai-toolkit-llm';

const calculator: ToolDefinition = {
	name: 'calculator',
	description: 'Evaluate a basic arithmetic expression, e.g. "847 * 0.15".',
	parameters: z.object({ expression: z.string() }),
};
```

Tool calling is a loop: send the conversation with `tools`; if the response
carries `toolCalls`, execute them, append the results as `role: 'tool'`
messages, and call again. When the model stops calling tools, its text answer
is ready:

```typescript
const messages: Message[] = [
	{ role: 'user', content: 'What is 15% of 847?' },
];

for (let iteration = 0; iteration < 10; iteration++) {
	const response = await llm.sendConversation(messages, {
		tools: [calculator],
	});

	if (!response.toolCalls || response.toolCalls.length === 0) {
		console.log(response.content); // "15% of 847 is 127.05."
		break;
	}

	// Replay the assistant's tool request into history…
	messages.push({
		role: 'assistant',
		content: response.content,
		toolCalls: response.toolCalls,
	});

	// …execute each call and report the results.
	for (const call of response.toolCalls) {
		const result = myEvaluate(String(call.arguments.expression)); // your code
		messages.push({
			role: 'tool',
			content: String(result),
			toolCallId: call.id,
		});
	}
}
```

Notes:

-   `response.stopReason` is `'tool_calls'` when the model is requesting tools,
    `'stop'` when it finished normally.
-   Tool execution errors should be sent back as the tool message's `content`
    (e.g. `"Error: division by zero"`) so the model can recover.
-   `toolChoice: 'required'` forces at least one call; `'none'` disables
    calling; Ollama ignores `toolChoice` (no native equivalent).
-   `streamConversation` works with tools: text still streams via the callback,
    and any tool calls appear on the final returned response.
-   `sendStructuredConversation` does not accept `tools`.
-   When rendering a conversation, use `getDisplayMessages(history)` to hide
    tool machinery — end users should only see `user`/`assistant` text.

The upcoming `ubc-genai-toolkit-agents` module automates this loop; use this
API directly when you need full control.

### Using Provider-Specific Options

The `LLMOptions` object is designed to be extensible, allowing you to pass any parameter that a specific provider's API supports. The module will pass these options through to the underlying SDK.

This is useful for controlling provider-specific features, such as setting the context window size (`num_ctx`) in Ollama.

```typescript
async function askWithCustomOptions(question: string) {
	try {
		// This example assumes the `llm` module is configured for Ollama
		const response = await llm.sendMessage(question, {
			// Standard options
			temperature: 0.5,

			// Provider-specific options for Ollama
			// This sets the context window size for the request.
			// This option would be ignored by other providers like OpenAI.
			num_ctx: 4096,
		});
		console.log('Assistant:', response.content);
	} catch (error) {
		console.error('Error sending message:', error);
	}
}

askWithCustomOptions('Explain the importance of context windows in LLMs.');
```

### Listing Available Models

```typescript
async function listModels() {
	try {
		const models = await llm.getAvailableModels();
		console.log(`Available models for ${llm.getProviderName()}:`);
		models.forEach((model) => console.log(`- ${model}`));
	} catch (error) {
		console.error('Error listing models:', error);
	}
}

listModels();
```

## Providers & Models

The specific models available depend on the configured provider.

### Structured output (Zod) support by provider

`Conversation.sendStructured` / `LLMModule.sendStructuredConversation` require a provider that implements structured completions. Support in this module:

| Provider            | Structured output (`sendStructured` / `sendStructuredConversation`) | Notes |
| ------------------- | -------------------------------------------------------------------- | ----- |
| **openai**          | Supported                                                            | Uses OpenAI `beta.chat.completions.parse` with your Zod schema. Use a model that supports **structured outputs** / parse (see OpenAI docs). |
| **anthropic**       | Supported                                                            | Uses Anthropic `messages.parse` with `zodOutputFormat`. Model must support the Messages API structured output path you configure. |
| **ollama**          | Supported                                                            | Sends JSON Schema from Zod via Ollama `format`; the assistant message body must be **valid JSON only** before Zod runs. Depends on server/model honoring `format`. |
| **ubc-llm-sandbox** | **Not supported**                                                    | `sendStructuredConversation` throws `501` in this version. Use `openai`, `anthropic`, or `ollama` for Zod-structured replies. |

### Provider Interface

All providers implement the `Provider` interface defined in `./src/providers/provider-interface.ts`.

### OpenAI Provider

-   Requires `apiKey` and `defaultModel` in configuration.
-   Optionally supports `endpoint` for OpenAI-compatible APIs (like Azure OpenAI).
-   See `./src/providers/openai-provider.ts`.
-   Available Models: <https://platform.openai.com/docs/models>

### Anthropic Provider

-   Requires `apiKey` and `defaultModel` in configuration.
-   See `./src/providers/anthropic-provider.ts`.
-   Available Models: <https://docs.anthropic.com/en/docs/models-overview#model-comparison> (Check API for exact identifiers via `getAvailableModels()`)

### Ollama Provider

-   Requires `endpoint` (URL of your Ollama server) and `defaultModel` in configuration. `apiKey` is not used.
-   See `./src/providers/ollama-provider.ts`.
-   Available Models: Depends on what models you have downloaded on the Ollama server. Use `ollama list` in your terminal to view locally available models.

### UBC LLM Sandbox Provider

-   Connects to a service providing an OpenAI-compatible API (hosted with LiteLLM).
-   Requires `apiKey`, `endpoint`, and `defaultModel` in configuration.
-   Set `embeddingModel` if you plan to call `embed()`. It falls back to `nomic-embed-text` (and warns) for backwards compatibility, which is unlikely to be what you want on the current deployment.
-   See `./src/providers/ubc-llm-sandbox-provider.ts`.

#### Endpoints

Both environments run the same service and the same model roster; production is
simply the staging URL without `-stg`. Exported as `UBC_LLM_SANDBOX_ENDPOINTS`:

| Environment  | Base URL                                |
| ------------ | --------------------------------------- |
| `staging`    | `https://ai-stg.apps.ctlt.ubc.ca/v1`    |
| `production` | `https://ai.apps.ctlt.ubc.ca/v1`        |

The `endpoint` you configure is normalized before use, so a bare host
(`https://ai-stg.apps.ctlt.ubc.ca`), a trailing slash, or a full request URL
copied out of the sandbox docs (`.../v1/chat/completions`) all resolve to the
same API root. Requesting a key: <https://developer.ubc.ca/sandbox/llm>.

#### Models

Exported as `UBC_LLM_SANDBOX_MODELS`. This is a convenience roster, not a
validation allowlist — the sandbox catalogue changes without a toolkit release,
so call `getAvailableModels()` for the live list.

| Model                 | Role      | Notes                                                          |
| --------------------- | --------- | -------------------------------------------------------------- |
| `gpt-oss-120b`        | Reasoning | Takes `reasoningEffort` — `low`, `medium`, `high`. Tool calling works. |
| `qwen3.6-35b-a3b`     | Chat      | Thinks by default — see below. Tool calling needs `toolChoice: 'required'`. |
| `qwen3-embedding-0.6b`| Embedding | 1024 dimensions. Set as `embeddingModel` to use `embed()`.      |

#### Reasoning on sandbox models

`reasoningEffort` is forwarded for self-hosted sandbox models rather than
rejected, and the toolkit translates it to whatever mechanism the target model
actually uses. OpenAI models proxied through the sandbox keep OpenAI's own
rules, so `reasoningEffort` on `gpt-4o` still fails fast with a `400`.

**`gpt-oss-120b`** reads `reasoning_effort` and accepts only `low`, `medium`,
`high` — the gateway returns `400` for anything else. Values outside that scale
are clamped rather than rejected: `none`/`minimal` → `low`, `xhigh`/`max` → `high`.

```typescript
const response = await llm.sendMessage('Explain quicksort.', {
	model: 'gpt-oss-120b',
	reasoningEffort: 'medium',
	maxTokens: 2048,
});
```

**`qwen3.6-35b-a3b` thinks by default**, and its chain of thought is billed
against `maxTokens` *before* any visible content is produced. A request with a
tight budget therefore comes back with `stopReason: 'length'` and an **empty
string** — the tokens were all spent thinking. Measured on staging, the same
small JSON request cost ~1000 completion tokens with thinking on and 39 with it
off.

Qwen3 ignores `reasoning_effort`; thinking is a chat-template flag. Pass
`reasoningEffort: 'none'` and the provider translates it for you:

```typescript
// Sends chat_template_kwargs: { enable_thinking: false }
const response = await llm.sendMessage('Return a JSON object with ...', {
	model: 'qwen3.6-35b-a3b',
	reasoningEffort: 'none',
	maxTokens: 512,
});
```

So: either turn thinking off, or budget several thousand `maxTokens`. Leaving
thinking on with a small budget is the one combination that silently returns
nothing. An explicit `chat_template_kwargs` of your own always takes precedence.

#### Tool calling

`gpt-oss-120b` works with the default `toolChoice: 'auto'`.

`qwen3.6-35b-a3b` currently requires `toolChoice: 'required'`. With `'auto'`
the model emits its tool call as XML in the message body
(`<tool_call><function=...>`) rather than as a structured `tool_calls` array, so
`response.toolCalls` comes back empty. This is a server-side tool-call-parser
mismatch in the sandbox's vLLM configuration, not a model limitation — with
`'required'` the same request returns a correct `tool_calls` payload.

#### JSON output

`response_format: { type: 'json_object' }` and `{ type: 'json_schema', ... }`
both work. On `qwen3.6-35b-a3b`, combine them with `reasoningEffort: 'none'` or
a large `maxTokens`, for the reason described above.

## Error Handling

The module uses the common error types from `ubc-genai-toolkit-core`:

-   `ConfigurationError`: Thrown during initialization if the config is invalid (e.g., missing API key).
-   `APIError`: Thrown during LLM interaction if the provider API returns an error or another issue occurs. Check the `code` (HTTP status) and `details` (often includes the original error) for more info.

Always wrap calls to the module in `try...catch` blocks.
