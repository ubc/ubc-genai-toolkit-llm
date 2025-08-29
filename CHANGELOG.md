# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2025-08-29

### Fixed

-   Explicitly set `encoding_format: 'float'` in the `UbcLlmSandboxProvider` when making embedding requests. This prevents an error caused by a recent `openai` library update that defaults to `'base64'`, which is unsupported by Ollama-backed services on the UBC LLM Sandbox.

## [0.2.0] - 2025-08-29

### Added

-   Implemented pass-through support for provider-specific parameters in `LLMOptions` for all providers (`OpenAI`, `Anthropic`, `Ollama`, `UBC LLM Sandbox`). This allows for advanced control over provider features, such as setting the context window size (`num_ctx`).
-   Added a "Using Provider-Specific Options" section to `readme.md` to document this new feature.
-   Enhanced the example application to demonstrate the use of standard and provider-specific `LLMOptions`.

### Fixed

-   Corrected an issue where the `systemPrompt` option was not being applied correctly in the `OpenAIProvider`'s `sendConversation` and `streamConversation` methods.
