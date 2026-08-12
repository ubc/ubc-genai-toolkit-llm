# UBC GenAI Toolkit - LLM Module

## Overview

This module provides a standardized interface for interacting with various Large Language Models (LLMs). It follows the Facade pattern, simplifying interactions with different LLM providers like OpenAI, Anthropic, Ollama, the UBC LLM Sandbox, and the UBC LLM Proxy, while shielding your application from underlying SDK changes.

Applications can use this module to send single messages, manage conversation history, stream responses, and list available models, all through a consistent API.

## Installation

```bash
npm install ubc-genai-toolkit-llm ubc-genai-toolkit-core
```

## Core Concepts

-   **`LLMModule`**: The main class and entry point for interacting with LLMs. You configure it once with your provider details.
-   **Providers**: The module supports different LLM providers (`openai`, `anthropic`, `ollama`, `ubc-llm-sandbox`, `ubc-llm-proxy`). The specific provider implementation is handled internally based on your configuration.
-   **The two UBC gateways**: `ubc-llm-sandbox` and `ubc-llm-proxy` front the same OpenAI-compatible LiteLLM service and differ only in model policy — the sandbox serves the [approved B300 models](#models) and nothing else, while the proxy serves whatever your API key is entitled to. See [UBC LLM Proxy Provider](#ubc-llm-proxy-provider).
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
	provider: 'openai' | 'anthropic' | 'ollama' | 'ubc-llm-sandbox' | 'ubc-llm-proxy' | string; // Specify the provider
	apiKey?: string; // Required for OpenAI, Anthropic, UBC LLM Sandbox, UBC LLM Proxy
	endpoint?: string; // Required for Ollama, UBC LLM Sandbox, UBC LLM Proxy; optional for OpenAI-compatible APIs
	defaultModel?: string; // Default model ID; required by every provider except ubc-llm-proxy
	embeddingModel?: string; // Required before calling embed() on the UBC gateways
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

// UBC LLM Proxy (same LiteLLM API, no model allowlist, no default models)
const ubcProxyConfig: LLMConfig = {
	provider: 'ubc-llm-proxy',
	apiKey: process.env.UBC_LLM_PROXY_API_KEY, // The key decides which models you get
	endpoint: process.env.UBC_LLM_PROXY_ENDPOINT, // Issued with your key
	// defaultModel / embeddingModel are optional here — but a chat or embedding
	// call with neither a configured model nor a per-request `model` fails with a
	// ConfigurationError rather than guessing. Use an id from getAvailableModels().
	defaultModel: process.env.UBC_LLM_PROXY_MODEL,
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

The one exception to "not rewritten by this module" is the UBC gateways
(`ubc-llm-sandbox` and `ubc-llm-proxy`), which clamp efforts onto the target
model's native scale — see [UBC LLM Sandbox Provider](#ubc-llm-sandbox-provider).

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
- Supported on **OpenAI**, **UBC LLM Sandbox** and **UBC LLM Proxy**
  (OpenAI-compatible), **Anthropic**, and **Ollama** (vision-capable models such
  as `llava`). Sending images to a model that can't accept them surfaces the
  provider's own error.

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
| **ubc-llm-proxy**   | **Not supported**                                                    | Same as the sandbox — throws `501`. Ask for JSON with `responseFormat: 'json'` (or a raw `response_format`) and validate it yourself. |

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

### The two UBC gateways

`ubc-llm-sandbox` and `ubc-llm-proxy` are the same LiteLLM service and the same
code path (`./src/providers/litellm-gateway-provider.ts`). They differ in exactly
one thing — which models you may reach:

| | `ubc-llm-sandbox` | `ubc-llm-proxy` |
| --- | --- | --- |
| Models | Only the [approved B300 list](#models) | Anything the API key is entitled to |
| `getAvailableModels()` | Filtered to the approved list | Exactly what LiteLLM returns |
| Off-list model | `ConfigurationError` before the request is sent | Sent; the gateway decides |
| `defaultModel` | Required | Optional (needed before the first chat call) |
| `embeddingModel` | Required before `embed()` | Required before `embed()` |

Pick the sandbox when your application should be pinned to the approved,
UBC-hosted roster. Pick the proxy when the key's entitlement is the boundary you
want — for example a project with access to commercial models routed through the
gateway.

### UBC LLM Sandbox Provider

-   Connects to a service providing an OpenAI-compatible API (hosted with LiteLLM).
-   Requires `apiKey`, `endpoint`, and `defaultModel` in configuration.
-   **Restricted to the approved models** in `UBC_LLM_SANDBOX_APPROVED_MODELS`. `getAvailableModels()` reports only those, and any other id — configured as `defaultModel`/`embeddingModel` or passed as a per-request `model` — is rejected with a `ConfigurationError` before a request goes out, even when the underlying key could reach it. Use `ubc-llm-proxy` if you need a model outside the list.
-   Set `embeddingModel` before calling `embed()`; there is no fallback embedding model (see [Migrating from 0.6.x](#migrating-from-06x)).
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

`UBC_LLM_SANDBOX_APPROVED_MODELS` **is** the allowlist: `/models` is filtered to
it, and every model id used on a request is checked against it.
`UBC_LLM_SANDBOX_MODELS` is the same set addressed by role, for callers who would
rather name `chat` than `qwen3.6-35b-a3b`.

| Model                 | Role      | Notes                                                          |
| --------------------- | --------- | -------------------------------------------------------------- |
| `gpt-oss-120b`        | Reasoning | Takes `reasoningEffort` — `low`, `medium`, `high`. Tool calling works. |
| `qwen3.6-35b-a3b`     | Chat      | Thinks by default — see below. Tool calling needs `toolChoice: 'required'`. |
| `qwen3-embedding-0.6b`| Embedding | 1024 dimensions. Set as `embeddingModel` to use `embed()`.      |

Matching is exact — `GPT-OSS-120B`, `qwen3.6-35b-a3b:latest`, and
`openai/gpt-oss-120b` are all rejected rather than repaired, because a model id
is a token the gateway defines.

```typescript
import {
	UBC_LLM_SANDBOX_APPROVED_MODELS, // ['gpt-oss-120b', 'qwen3.6-35b-a3b', 'qwen3-embedding-0.6b']
	isApprovedSandboxModel,
} from 'ubc-genai-toolkit-llm';

isApprovedSandboxModel(userSuppliedModel); // check before you configure it
```

The gateway's catalogue can change without a toolkit release. When it does,
verify the ids against `GET {endpoint}/models` on staging and update
`UBC_LLM_SANDBOX_APPROVED_MODELS` — that constant is the single place the policy
lives.

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

### UBC LLM Proxy Provider

-   Connects to UBC's LiteLLM gateway with **no model allowlist**: whatever your API key is entitled to, this provider will send.
-   Requires `apiKey` and `endpoint`. Both come from your key issuance — there are no endpoint constants and no built-in model roster, because both depend on the deployment your key belongs to.
-   Has **no default chat or embedding model**. Configure `defaultModel` / `embeddingModel`, or pass `model` per request.
-   See `./src/providers/ubc-llm-proxy-provider.ts`.

#### Discovering models

The provider can be constructed with only a key and an endpoint, so a setup flow
can ask the gateway what the key can actually use before anything is configured:

```typescript
const llm = new LLMModule({
	provider: 'ubc-llm-proxy',
	apiKey: process.env.UBC_LLM_PROXY_API_KEY,
	endpoint: process.env.UBC_LLM_PROXY_ENDPOINT,
	logger: new ConsoleLogger(),
	// no defaultModel yet
});

const models = await llm.getAvailableModels();
// e.g. ['gpt-oss-120b', 'qwen3.6-35b-a3b', 'openai/gpt-4o', 'text-embedding-3-large']
```

Ids come back **exactly** as LiteLLM reported them — same spelling, same order,
nothing filtered. Namespaced route names (`openai/gpt-4o`), vendor-prefixed ids,
and ids carrying versions or colons are passed through unchanged, and whatever
you pass back as `model` is what goes on the wire. The toolkit never adds or
strips a suffix to make an id "look right".

#### Choosing a model

`defaultModel` and `embeddingModel` are optional at construction but required
before the corresponding call. A chat or embedding request with no model
anywhere fails with a `ConfigurationError` naming the setting to set — it never
substitutes a model for you:

```typescript
await llm.sendMessage('hi');
// ConfigurationError: No chat model is configured for the 'ubc-llm-proxy'
// provider. Set 'defaultModel' in the LLM config or pass 'model' in the request
// options. The proxy has no default models — call getAvailableModels() ...

await llm.sendMessage('hi', { model: 'openai/gpt-4o' }); // works
await llm.embed(['hello'], { model: 'text-embedding-3-large' }); // works
```

A model the key *cannot* reach is not pre-empted locally: the request goes out
and the gateway's own `404` surfaces as an `APIError`. That is deliberate — the
gateway is the authority on entitlements, and a local list would go stale.

#### Everything else

Reasoning translation, tool calling, images, streaming, endpoint normalization,
and error mapping are shared with the sandbox provider, so
[Reasoning on sandbox models](#reasoning-on-sandbox-models) and the tool-calling
and JSON notes above apply here too — for the models they name. Because the
proxy can also reach OpenAI cloud models, their stricter rules still hold:
`reasoningEffort` on `gpt-4o` fails fast with a `400`, and `gpt-5`/o-series
models get `max_completion_tokens` rather than `max_tokens`.

## Error Handling

The module uses the common error types from `ubc-genai-toolkit-core`:

-   `ConfigurationError`: Thrown when the configuration cannot support the call — a missing API key or endpoint at initialization, and (on the UBC gateways) a missing model or one the provider's policy rejects. `code` is `400`, and `details` carries `provider`, the offending `model`, and the `purpose` (`chat` / `embedding`).
-   `APIError`: Thrown during LLM interaction if the provider API returns an error or another issue occurs. Check the `code` (HTTP status) and `details` (often includes the original error) for more info.

Gateway failures keep their HTTP status through normalization, so authentication
and quota problems stay distinguishable without parsing messages:

```typescript
try {
	await llm.sendMessage('hi');
} catch (error) {
	if (error instanceof ConfigurationError) {
		// Model or credentials missing from your config — fix the config.
	} else if (error.code === 401) {
		// Bad or revoked API key. details.code is the gateway's own code.
	} else if (error.code === 429) {
		// Quota exhausted or rate limited — back off and retry.
	}
}
```

Always wrap calls to the module in `try...catch` blocks.

## Migrating from 0.6.x

Two behaviors changed for `ubc-llm-sandbox` in 0.7.0. Both surface as a
`ConfigurationError` at the call site, not silently.

1.  **Only the approved models are reachable.** If your app configured a model
    that is not in `UBC_LLM_SANDBOX_APPROVED_MODELS` (for example an OpenAI model
    the key happened to serve), switch to an approved id, or switch the provider
    to `ubc-llm-proxy` — same endpoint and key, no allowlist.
2.  **`embed()` no longer falls back to `nomic-embed-text`.** Set
    `embeddingModel: UBC_LLM_SANDBOX_MODELS.embedding` (`'qwen3-embedding-0.6b'`)
    in your config, or pass `model` on the `embed()` call. The old fallback named
    a model that is not on the current deployment, so it produced a gateway error
    about a model that appeared nowhere in your configuration; the failure is now
    immediate and names the setting to change.

Nothing changed for `openai`, `anthropic`, or `ollama`, and `LLMConfig.defaultModel`
becoming optional does not affect existing configs that set it.
