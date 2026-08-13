/**
 * @fileoverview Deployment constants and policy for the UBC LLM Sandbox.
 *
 * The sandbox is a UBC-hosted, LiteLLM-fronted gateway presenting an
 * OpenAI-compatible API. Its 2026 (B300) deployment moved to
 * `ai.apps.ctlt.ubc.ca` (production) / `ai-stg.apps.ctlt.ubc.ca` (staging) and
 * swapped the model roster for self-hosted open-weights models.
 *
 * The sandbox is the **curated** of UBC's two gateways: it exposes only the
 * approved B300 models, whatever else the underlying key can reach. Use the
 * `ubc-llm-proxy` provider when you need the full entitlement of your key.
 *
 * Transport-level helpers (endpoint normalization, reasoning translation) are
 * shared with the proxy and live in `litellm-gateway-config`; this module keeps
 * the sandbox's names and its allowlist.
 *
 * Everything here is a pure function or constant — no client, no network — so
 * it is unit-testable in isolation.
 */

import { ConfigurationError } from 'ubc-genai-toolkit-core';
import type { ReasoningEffort } from '../types';
import { OpenAIReasoningCapability } from './openai-compat-mapping';
import {
	normalizeGatewayEndpoint,
	getGatewayReasoningCapability,
	coerceGatewayReasoningEffort,
	resolveGatewayReasoning,
	GatewayReasoningRequest,
} from './litellm-gateway-config';

/**
 * Base URLs for the UBC LLM Sandbox deployments.
 *
 * Both are the OpenAI-compatible root: append `/chat/completions`,
 * `/embeddings`, or `/models` to reach a specific route. Pass one of these
 * straight through as {@link LLMConfig.endpoint}.
 */
export const UBC_LLM_SANDBOX_ENDPOINTS = {
	/** Staging — use this for development and testing. */
	staging: 'https://ai-stg.apps.ctlt.ubc.ca/v1',
	/** Production — same service, same model roster, no `-stg`. */
	production: 'https://ai.apps.ctlt.ubc.ca/v1',
} as const;

export type UbcLlmSandboxEnvironment = keyof typeof UBC_LLM_SANDBOX_ENDPOINTS;

/**
 * **The** allowlist: every model the `ubc-llm-sandbox` provider will talk to.
 *
 * This is the single source of truth for sandbox model policy — `/models` is
 * filtered to it, and both the configured default and any per-request override
 * are checked against it, so a key with wider entitlements still only reaches
 * these models through this provider.
 *
 * These are the approved B300 deployment ids as of 2026-08-12. The gateway's
 * catalogue can change without a toolkit release: re-check
 * `GET {endpoint}/models` on staging before shipping a change here, and update
 * this list rather than working around it in a caller.
 *
 * Need a model that is not on this list? That is what `ubc-llm-proxy` is for.
 */
export const UBC_LLM_SANDBOX_APPROVED_MODELS = [
	'gpt-oss-120b',
	'qwen3.6-35b-a3b',
	'qwen3-embedding-0.6b',
] as const;

/** A model id the sandbox provider accepts. */
export type UbcLlmSandboxApprovedModel =
	(typeof UBC_LLM_SANDBOX_APPROVED_MODELS)[number];

const APPROVED_MODEL_SET: ReadonlySet<string> = new Set(
	UBC_LLM_SANDBOX_APPROVED_MODELS
);

/**
 * The approved models by role, for callers that would rather name a role than
 * an id. Every value is drawn from {@link UBC_LLM_SANDBOX_APPROVED_MODELS} —
 * the `satisfies` clause makes a typo here a compile error.
 */
export const UBC_LLM_SANDBOX_MODELS = {
	/** Reasoning model; accepts `reasoningEffort` of `low` | `medium` | `high`. */
	reasoning: 'gpt-oss-120b',
	/** General-purpose chat model (mixture-of-experts). */
	chat: 'qwen3.6-35b-a3b',
	/** Embedding model — set as `embeddingModel` to use `embed()`. */
	embedding: 'qwen3-embedding-0.6b',
} as const satisfies Record<string, UbcLlmSandboxApprovedModel>;

/**
 * Whether a model id is on the sandbox allowlist.
 *
 * Comparison is exact: an id is a token the gateway defines, so
 * `Qwen3.6-35b-a3b` or `qwen3.6-35b-a3b:latest` is a different model as far as
 * this check is concerned, and is rejected rather than repaired.
 */
export function isApprovedSandboxModel(
	model: string | undefined
): model is UbcLlmSandboxApprovedModel {
	return typeof model === 'string' && APPROVED_MODEL_SET.has(model);
}

/**
 * Narrows a model list (e.g. the gateway's `/models` response) to the approved
 * ids, preserving the gateway's own ordering and spelling.
 */
export function filterApprovedSandboxModels(models: string[]): string[] {
	return models.filter((model) => isApprovedSandboxModel(model));
}

/**
 * Throws unless `model` is on the sandbox allowlist.
 *
 * @param model The requested model id.
 * @param purpose Whether it was requested for chat or embeddings; used in the message.
 * @returns The model id, unchanged.
 * @throws {ConfigurationError} When the model is not approved.
 */
export function assertApprovedSandboxModel(
	model: string,
	purpose: 'chat' | 'embedding' = 'chat'
): string {
	if (!isApprovedSandboxModel(model)) {
		throw new ConfigurationError(
			`Model '${model}' is not approved for the 'ubc-llm-sandbox' provider ` +
				`(requested for ${purpose}). ${describeApprovedSandboxModels()}`,
			{
				provider: 'ubc-llm-sandbox',
				model,
				purpose,
				approvedModels: [...UBC_LLM_SANDBOX_APPROVED_MODELS],
			}
		);
	}
	return model;
}

/** Shared tail for sandbox model errors: what is allowed, and the way out. */
export function describeApprovedSandboxModels(): string {
	return (
		`Approved models: ${UBC_LLM_SANDBOX_APPROVED_MODELS.join(', ')}. ` +
		"Use the 'ubc-llm-proxy' provider to reach other models your API key is entitled to."
	);
}

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
export function normalizeSandboxEndpoint(endpoint: string): string {
	return normalizeGatewayEndpoint(endpoint, {
		label: 'UBC LLM Sandbox',
		example: UBC_LLM_SANDBOX_ENDPOINTS.staging,
	});
}

/**
 * Reasoning capability for a model reached through the sandbox.
 *
 * Shared with the proxy — see `getGatewayReasoningCapability`. Self-hosted
 * models are treated as reasoning-capable; OpenAI cloud models keep OpenAI's
 * stricter rules.
 */
export function getSandboxReasoningCapability(
	model: string
): OpenAIReasoningCapability {
	return getGatewayReasoningCapability(model);
}

/**
 * Maps a toolkit {@link ReasoningEffort} onto a value the target sandbox model
 * actually accepts (`gpt-oss` only knows `low` | `medium` | `high`).
 *
 * Shared with the proxy — see `coerceGatewayReasoningEffort`.
 */
export function coerceSandboxReasoningEffort(
	model: string,
	effort: ReasoningEffort | string | undefined
): ReasoningEffort | string | undefined {
	return coerceGatewayReasoningEffort(model, effort);
}

/**
 * How a sandbox model's reasoning should be expressed on the wire.
 *
 * @see GatewayReasoningRequest
 */
export type SandboxReasoningRequest = GatewayReasoningRequest;

/**
 * Translates a toolkit {@link ReasoningEffort} into whichever native mechanism
 * the target sandbox model uses — `reasoning_effort` for `gpt-oss`, a
 * `chat_template_kwargs` thinking toggle for Qwen3.
 *
 * Shared with the proxy — see `resolveGatewayReasoning`.
 */
export function resolveSandboxReasoning(
	model: string,
	effort: ReasoningEffort | string | undefined
): SandboxReasoningRequest {
	return resolveGatewayReasoning(model, effort);
}
