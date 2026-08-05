/**
 * @fileoverview Deployment constants and configuration helpers for the UBC LLM
 * Sandbox.
 *
 * The sandbox is a UBC-hosted, LiteLLM-fronted gateway presenting an
 * OpenAI-compatible API. Its 2026 deployment moved to
 * `ai.apps.ctlt.ubc.ca` (production) / `ai-stg.apps.ctlt.ubc.ca` (staging) and
 * swapped the model roster for self-hosted open-weights models, so the
 * assumptions baked into the OpenAI mapping layer (only `gpt-5`/o-series can
 * reason) no longer describe it.
 *
 * Everything here is a pure function or constant — no client, no network — so
 * it is unit-testable in isolation.
 */
import type { ReasoningEffort } from '../types';
import { OpenAIReasoningCapability } from './openai-compat-mapping';
/**
 * Base URLs for the UBC LLM Sandbox deployments.
 *
 * Both are the OpenAI-compatible root: append `/chat/completions`,
 * `/embeddings`, or `/models` to reach a specific route. Pass one of these
 * straight through as {@link LLMConfig.endpoint}.
 */
export declare const UBC_LLM_SANDBOX_ENDPOINTS: {
    /** Staging — use this for development and testing. */
    readonly staging: "https://ai-stg.apps.ctlt.ubc.ca/v1";
    /** Production — same service, same model roster, no `-stg`. */
    readonly production: "https://ai.apps.ctlt.ubc.ca/v1";
};
export type UbcLlmSandboxEnvironment = keyof typeof UBC_LLM_SANDBOX_ENDPOINTS;
/**
 * Models served by the sandbox as of the 2026 deployment.
 *
 * This is a convenience roster, not a validation allowlist — the sandbox's
 * catalogue changes without a toolkit release, and any id the gateway accepts
 * works. Call {@link LLMModule.getAvailableModels} for the live list.
 */
export declare const UBC_LLM_SANDBOX_MODELS: {
    /** Reasoning model; accepts `reasoningEffort` of `low` | `medium` | `high`. */
    readonly reasoning: "gpt-oss-120b";
    /** General-purpose chat model (mixture-of-experts). */
    readonly chat: "qwen3.6-35b-a3b";
    /** Embedding model — set as `embeddingModel` to use `embed()`. */
    readonly embedding: "qwen3-embedding-0.6b";
};
/**
 * Normalizes a configured sandbox endpoint into the base URL the OpenAI client
 * expects.
 *
 * The sandbox documents itself with a full request URL
 * (`https://ai-stg.apps.ctlt.ubc.ca/v1/chat/completions`), while the client
 * needs the API root (`https://ai-stg.apps.ctlt.ubc.ca/v1`). Getting this wrong
 * produces opaque 404s from the gateway, so all three common spellings are
 * accepted:
 *
 * - `https://ai-stg.apps.ctlt.ubc.ca` → `/v1` appended
 * - `https://ai-stg.apps.ctlt.ubc.ca/v1/` → trailing slash removed
 * - `https://ai-stg.apps.ctlt.ubc.ca/v1/chat/completions` → route stripped
 *
 * An endpoint already ending in a version segment (`/v1`, `/v2`, …) is left
 * alone, so a gateway mounted under a path prefix still works.
 *
 * @param endpoint The endpoint as configured by the caller.
 * @returns The normalized OpenAI-compatible base URL, without a trailing slash.
 * @throws {ConfigurationError} If the endpoint is empty or not a valid absolute URL.
 */
export declare function normalizeSandboxEndpoint(endpoint: string): string;
/**
 * Reasoning capability for a model reached through the sandbox.
 *
 * The sandbox proxies two very different kinds of model, so the rule follows
 * the model id rather than the provider:
 *
 * - OpenAI cloud models keep OpenAI's rules — sending `reasoning_effort` to
 *   `gpt-4o` is a hard error there, and the toolkit should say so up front.
 * - Everything else (self-hosted open-weights: `gpt-oss-120b`, `qwen3*`, …) is
 *   treated as `optional`, i.e. reasoning is forwarded when asked for. This is
 *   deliberately permissive: the sandbox roster changes without a toolkit
 *   release, and the gateway is a better judge of what a given model accepts
 *   than a hardcoded list that would block valid models.
 */
export declare function getSandboxReasoningCapability(model: string): OpenAIReasoningCapability;
/**
 * Maps a toolkit {@link ReasoningEffort} onto a value the target sandbox model
 * actually accepts.
 *
 * `gpt-oss` only knows `low` | `medium` | `high`; the toolkit's wider scale
 * (inherited from OpenAI's gpt-5 family) would otherwise produce a 400 from the
 * gateway for perfectly reasonable callers — BiocBot, for instance, defaults to
 * `minimal`. Efforts are clamped to the nearest supported depth rather than
 * dropped, so the caller's intent survives.
 *
 * Models with no known constraint pass through untouched: the gateway rejects
 * what it cannot serve, which beats guessing here.
 *
 * @returns The effort to send, or `undefined` when none was requested.
 */
export declare function coerceSandboxReasoningEffort(model: string, effort: ReasoningEffort | string | undefined): ReasoningEffort | string | undefined;
/**
 * How a sandbox model's reasoning should be expressed on the wire.
 *
 * Two mutually exclusive mechanisms exist across the roster, so callers get one
 * knob (`reasoningEffort`) and this decides which mechanism it drives.
 */
export interface SandboxReasoningRequest {
    /** Value for `reasoning_effort`, when the model reads that field. */
    reasoningEffort?: ReasoningEffort | string;
    /** Fields to merge into `chat_template_kwargs`, when it does not. */
    chatTemplateKwargs?: Record<string, unknown>;
}
/**
 * Translates a toolkit {@link ReasoningEffort} into whichever native mechanism
 * the target sandbox model actually uses.
 *
 * - **gpt-oss** reads `reasoning_effort`, clamped to its `low`/`medium`/`high`
 *   scale (see {@link coerceSandboxReasoningEffort}).
 * - **Qwen3** ignores `reasoning_effort` entirely and toggles thinking through
 *   its chat template, so `reasoningEffort: 'none'` becomes
 *   `chat_template_kwargs: { enable_thinking: false }`.
 *
 * That second case is not a nicety. Qwen3 thinks by default and the chain of
 * thought is billed against `max_tokens` before any visible content is emitted,
 * so a request with a modest budget returns `finish_reason: 'length'` and an
 * **empty string** — measured on staging as ~1000 completion tokens for a
 * two-field JSON object, versus 39 with thinking off. Callers asking for
 * `'none'` would otherwise silently keep paying that cost.
 */
export declare function resolveSandboxReasoning(model: string, effort: ReasoningEffort | string | undefined): SandboxReasoningRequest;
//# sourceMappingURL=ubc-llm-sandbox-config.d.ts.map