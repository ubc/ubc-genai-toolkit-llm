/**
 * @fileoverview Configuration helpers shared by the UBC LiteLLM gateways
 * ({@link UbcLlmSandboxProvider} and {@link UbcLlmProxyProvider}).
 *
 * Both providers talk to a LiteLLM proxy presenting an OpenAI-compatible API,
 * so endpoint spellings and reasoning translation are identical for both. What
 * differs is *policy* — which models a caller is allowed to reach — and that
 * lives with each provider, not here.
 *
 * Everything in this module is a pure function or constant (no client, no
 * network), so it is unit-testable in isolation.
 */
import type { ReasoningEffort } from '../types';
import { OpenAIReasoningCapability } from './openai-compat-mapping';
/** Naming used in the error messages raised by {@link normalizeGatewayEndpoint}. */
export interface GatewayEndpointContext {
    /** Human-readable provider name, e.g. `'UBC LLM Sandbox'`. */
    label: string;
    /** A valid endpoint to show the caller, e.g. `'https://host/v1'`. */
    example: string;
}
/**
 * Normalizes a configured gateway endpoint into the base URL the OpenAI client
 * expects.
 *
 * These services document themselves with a full request URL
 * (`https://host/v1/chat/completions`), while the client needs the API root
 * (`https://host/v1`). Getting this wrong produces opaque 404s from the
 * gateway, so all the common spellings are accepted:
 *
 * - `https://host` → `/v1` appended
 * - `https://host/v1/` → trailing slash removed
 * - `https://host/v1/chat/completions` → route stripped
 *
 * An endpoint already ending in a version segment (`/v1`, `/v2`, …) is left
 * alone, so a gateway mounted under a path prefix still works.
 *
 * @param endpoint The endpoint as configured by the caller.
 * @param context Naming used in error messages.
 * @returns The normalized OpenAI-compatible base URL, without a trailing slash.
 * @throws {ConfigurationError} If the endpoint is empty or not a valid absolute URL.
 */
export declare function normalizeGatewayEndpoint(endpoint: string, context: GatewayEndpointContext): string;
/**
 * Reasoning capability for a model reached through a LiteLLM gateway.
 *
 * These gateways proxy two very different kinds of model, so the rule follows
 * the model id rather than the provider:
 *
 * - OpenAI cloud models keep OpenAI's rules — sending `reasoning_effort` to
 *   `gpt-4o` is a hard error there, and the toolkit should say so up front.
 * - Everything else (self-hosted open-weights: `gpt-oss-120b`, `qwen3*`, …) is
 *   treated as `optional`, i.e. reasoning is forwarded when asked for. This is
 *   deliberately permissive: gateway rosters change without a toolkit release,
 *   and the gateway is a better judge of what a given model accepts than a
 *   hardcoded list that would block valid models.
 */
export declare function getGatewayReasoningCapability(model: string): OpenAIReasoningCapability;
/**
 * Maps a toolkit {@link ReasoningEffort} onto a value the target model actually
 * accepts.
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
export declare function coerceGatewayReasoningEffort(model: string, effort: ReasoningEffort | string | undefined): ReasoningEffort | string | undefined;
/**
 * How a model's reasoning should be expressed on the wire.
 *
 * Two mutually exclusive mechanisms exist across these rosters, so callers get
 * one knob (`reasoningEffort`) and this decides which mechanism it drives.
 */
export interface GatewayReasoningRequest {
    /** Value for `reasoning_effort`, when the model reads that field. */
    reasoningEffort?: ReasoningEffort | string;
    /** Fields to merge into `chat_template_kwargs`, when it does not. */
    chatTemplateKwargs?: Record<string, unknown>;
}
/**
 * Translates a toolkit {@link ReasoningEffort} into whichever native mechanism
 * the target model actually uses.
 *
 * - **gpt-oss** reads `reasoning_effort`, clamped to its `low`/`medium`/`high`
 *   scale (see {@link coerceGatewayReasoningEffort}).
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
export declare function resolveGatewayReasoning(model: string, effort: ReasoningEffort | string | undefined): GatewayReasoningRequest;
//# sourceMappingURL=litellm-gateway-config.d.ts.map