# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-08-10

### Added

-   **Support for the 2026 UBC LLM Sandbox deployment** (`ai.apps.ctlt.ubc.ca` / `ai-stg.apps.ctlt.ubc.ca`). New exports `UBC_LLM_SANDBOX_ENDPOINTS` (`staging`, `production`) and `UBC_LLM_SANDBOX_MODELS` (`gpt-oss-120b`, `qwen3.6-35b-a3b`, `qwen3-embedding-0.6b`) so applications no longer hardcode URLs and model ids. The model roster is a convenience, not a validation allowlist — `getAvailableModels()` remains the source of truth.
-   **Endpoint normalization** for the sandbox provider (`normalizeSandboxEndpoint`). A bare host, a trailing slash, or a full request URL pasted from the sandbox docs (`.../v1/chat/completions`) now all resolve to the API base instead of producing opaque 404s.

### Fixed

-   **`reasoningEffort` no longer fails on sandbox reasoning models.** The mapping layer previously recognized only `gpt-5`/o-series as reasoning-capable, so `gpt-oss-120b` was rejected with a client-side `400` before the request left the process. The reasoning gate is now separate from the token-field choice (`max_tokens` vs `max_completion_tokens`), and the sandbox resolves capability permissively for self-hosted models while keeping OpenAI's stricter rules for OpenAI models it proxies.
-   **Reasoning efforts are clamped to the target model's scale** for the sandbox: `gpt-oss-120b` accepts only `low`/`medium`/`high` (verified against staging — the gateway returns `400 "... is not supported by Harmony"` for `none`, `minimal`, `xhigh` and `max`), so `none`/`minimal` clamp to `low` and `xhigh`/`max` clamp to `high` instead of erroring.
-   **`reasoningEffort: 'none'` now actually disables thinking on Qwen3 models.** Qwen3 ignores `reasoning_effort` and toggles thinking through its chat template, so the request was previously a no-op and the model kept thinking. It now sends `chat_template_kwargs: { enable_thinking: false }` (a caller-supplied `chat_template_kwargs` still wins). This matters because Qwen3's chain of thought is billed against `max_tokens` before any visible content: on staging, a small JSON request cost ~1000 completion tokens with thinking on versus 39 with it off, and at `max_tokens: 512` returned `finish_reason: 'length'` with an empty string.

### Changed

-   **`embed()` on the sandbox provider now warns when it falls back to the default embedding model.** The `nomic-embed-text` fallback is unchanged and still works, so existing callers are unaffected; it simply logs a warning naming the current sandbox embedding model (`qwen3-embedding-0.6b`), because otherwise an unset `embeddingModel` surfaces as a gateway error about a model that appears nowhere in the caller's configuration. Setting `embeddingModel` explicitly silences it.

## [0.5.0] - 2026-08-04

- Reasoning effort for some model providers

## [0.4.0] - 2026-07-14

### Added

-   **Tool calling (function calling) across all providers.** `LLMOptions` accepts `tools` (an array of `ToolDefinition` — name, description, Zod `parameters` schema) and `toolChoice` (`'auto' | 'required' | 'none'`). When the model requests tool invocations, `LLMResponse.toolCalls` carries normalized `ToolCall` objects (`id`, `name`, parsed `arguments`) and `LLMResponse.stopReason` is `'tool_calls'`. Results are sent back as `role: 'tool'` messages with `toolCallId`. Supported by OpenAI, Anthropic, Ollama, and UBC LLM Sandbox providers, in both `sendConversation` and `streamConversation` (tool calls surface on the final streamed response, not mid-stream). `sendStructuredConversation` rejects `tools` (mutually exclusive in this release). Fully backwards compatible: code that never passes `tools` is unchanged.
-   **`Message.role` widened** to include `'tool'`, plus optional `Message.toolCalls` / `Message.toolCallId` fields for replaying tool-calling turns in history.
-   **`LLMResponse.stopReason`** (`'stop' | 'tool_calls' | 'length' | 'other'`), normalized across providers, so callers can tell why generation ended without parsing content.
-   **`getDisplayMessages(history)`** helper: filters a tool-aware history down to the user-visible `user`/`assistant` text messages for rendering.
-   **Test infrastructure**: vitest unit tests for the provider mapping layers (`npm test`).

## [0.3.0] - 2026-06-09

### Added

-   **Multi-modal image input.** `Message` now accepts an optional `images` array (`{ data: base64, mimeType }`). When present, each provider builds a multi-part request combining the text `content` with the image(s): OpenAI / UBC LLM Sandbox use base64 `image_url` data URLs, Anthropic uses base64 `image` content blocks, and Ollama attaches base64 strings via the message `images` field. Works across `sendConversation`, `streamConversation`, and (OpenAI/Anthropic) `sendStructuredConversation`. Messages without `images` are unchanged and fully backwards compatible.

## [0.2.4] - 2026-05-12

### Changed

-   **Structured output behavior:** Ollama structured chat again requires the model’s full `message.content` to be valid JSON before Zod validation (prose-wrapped or fenced JSON in the same string fails at `JSON.parse`). OpenAI and Anthropic structured paths no longer recover from missing `parsed` / `parsed_output` by scanning message text.

## [0.2.3] - 2025-08-30

### Fixed

-   Modified the `UbcLlmSandboxProvider` to use a raw `post` request for embeddings. This bypasses the `embeddings.create` helper method in the `openai` library, which automatically adds an `encoding_format` parameter that is unsupported by the UBC LLM Sandbox.

## [0.2.2] - 2025-08-29

### Fixed

-   Republished fix from `0.2.1` with corrected build artifacts.

## [0.2.1] - 2025-08-29 [YANKED]

### Fixed

-   Explicitly set `encoding_format: 'float'` in the `UbcLlmSandboxProvider` when making embedding requests. This prevents an error caused by a recent `openai` library update that defaults to `'base64'`, which is unsupported by Ollama-backed services on the UBC LLM Sandbox. This release was yanked due to a build error where the fix was not included in the published package.

## [0.2.0] - 2025-08-29

### Added

-   Implemented pass-through support for provider-specific parameters in `LLMOptions` for all providers (`OpenAI`, `Anthropic`, `Ollama`, `UBC LLM Sandbox`). This allows for advanced control over provider features, such as setting the context window size (`num_ctx`).
-   Added a "Using Provider-Specific Options" section to `readme.md` to document this new feature.
-   Enhanced the example application to demonstrate the use of standard and provider-specific `LLMOptions`.

### Fixed

-   Corrected an issue where the `systemPrompt` option was not being applied correctly in the `OpenAIProvider`'s `sendConversation` and `streamConversation` methods.
