# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
