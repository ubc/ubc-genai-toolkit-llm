"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeGatewayEndpoint = normalizeGatewayEndpoint;
exports.getGatewayReasoningCapability = getGatewayReasoningCapability;
exports.coerceGatewayReasoningEffort = coerceGatewayReasoningEffort;
exports.resolveGatewayReasoning = resolveGatewayReasoning;
const ubc_genai_toolkit_core_1 = require("ubc-genai-toolkit-core");
const openai_compat_mapping_1 = require("./openai-compat-mapping");
/**
 * Route suffixes that get stripped when a caller configures a full request URL
 * (e.g. copied out of a `curl` example) instead of the API base.
 */
const OPENAI_ROUTE_SUFFIXES = [
    '/chat/completions',
    '/completions',
    '/embeddings',
    '/responses',
    '/models',
];
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
function normalizeGatewayEndpoint(endpoint, context) {
    const trimmed = (endpoint ?? '').trim();
    if (!trimmed) {
        throw new ubc_genai_toolkit_core_1.ConfigurationError(`endpoint is required for the ${context.label} provider ` +
            `(e.g. '${context.example}').`);
    }
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new ubc_genai_toolkit_core_1.ConfigurationError(`Invalid ${context.label} endpoint '${endpoint}': expected an absolute URL ` +
            `such as '${context.example}'.`);
    }
    let path = url.pathname.replace(/\/+$/, '');
    for (const suffix of OPENAI_ROUTE_SUFFIXES) {
        if (path.endsWith(suffix)) {
            path = path.slice(0, -suffix.length).replace(/\/+$/, '');
            break;
        }
    }
    const lastSegment = path.split('/').pop() ?? '';
    if (!/^v\d+$/.test(lastSegment)) {
        path = `${path}/v1`;
    }
    return `${url.origin}${path}`;
}
/**
 * True for models served by OpenAI's own API (whether called directly or
 * proxied through a gateway), whose parameter rules OpenAI enforces strictly.
 *
 * `gpt-oss-*` is deliberately excluded: despite the `gpt-` prefix it is an
 * open-weights model self-hosted behind the gateway, and it *does* take
 * `reasoning_effort`.
 *
 * Note this matches on the bare id only. A LiteLLM deployment that namespaces
 * its routes (`openai/gpt-4o`) is treated as "some other model" and gets the
 * permissive path below — the gateway is then the one to reject an unsupported
 * parameter. That is the intended trade-off: model ids are never rewritten to
 * make this check fire.
 */
function isOpenAICloudModel(id) {
    if (id.startsWith('gpt-oss')) {
        return false;
    }
    return /^(gpt-|o1|o3|o4-|chatgpt-)/.test(id);
}
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
function getGatewayReasoningCapability(model) {
    const id = (model ?? '').trim().toLowerCase();
    if (isOpenAICloudModel(id)) {
        return (0, openai_compat_mapping_1.getOpenAIReasoningCapability)(id);
    }
    return 'optional';
}
/**
 * The only efforts the gpt-oss harmony format understands.
 *
 * Measured against `ai-stg.apps.ctlt.ubc.ca` on 2026-08-05: `none`, `minimal`,
 * `xhigh` and `max` are all rejected with HTTP 400
 * (`"... is not supported by Harmony"`).
 */
const GPT_OSS_EFFORTS = new Set(['low', 'medium', 'high']);
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
function coerceGatewayReasoningEffort(model, effort) {
    if (effort === undefined) {
        return undefined;
    }
    const id = (model ?? '').trim().toLowerCase();
    if (!id.startsWith('gpt-oss')) {
        return effort;
    }
    if (GPT_OSS_EFFORTS.has(effort)) {
        return effort;
    }
    // 'none' and 'minimal' both mean "reason as little as possible"; gpt-oss
    // always reasons, so 'low' is the floor. 'xhigh'/'max' clamp to the ceiling.
    switch (effort) {
        case 'none':
        case 'minimal':
            return 'low';
        case 'xhigh':
        case 'max':
            return 'high';
        default:
            // Unknown value — leave it alone so the shared validator reports it.
            return effort;
    }
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
function resolveGatewayReasoning(model, effort) {
    const id = (model ?? '').trim().toLowerCase();
    if (id.startsWith('qwen3')) {
        if (effort === 'none') {
            return { chatTemplateKwargs: { enable_thinking: false } };
        }
        // Any other depth: leave the template at its default (thinking on) and
        // forward the effort in case the gateway grows support for it.
        return { reasoningEffort: effort };
    }
    return { reasoningEffort: coerceGatewayReasoningEffort(model, effort) };
}
//# sourceMappingURL=litellm-gateway-config.js.map