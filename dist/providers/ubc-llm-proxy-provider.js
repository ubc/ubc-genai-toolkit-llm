"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UbcLlmProxyProvider = void 0;
/**
 * @fileoverview Implements the Provider interface for the UBC LLM Proxy.
 *
 * The proxy is UBC's LiteLLM gateway in its uncurated form: it serves every
 * model the presented API key is entitled to, which may include commercial
 * models routed through the gateway as well as UBC-hosted open-weights ones.
 * It speaks the same OpenAI-compatible API as the sandbox (`/models`,
 * `/chat/completions`, `/embeddings`) and shares its transport — see
 * {@link LiteLLMGatewayProvider}. What differs is policy, in two ways:
 *
 * 1. **No allowlist.** Whatever the key can reach, this provider will send.
 *    (`ubc-llm-sandbox` is the restricted counterpart, limited to the approved
 *    B300 models.)
 * 2. **No default models.** There is no sensible default when the roster
 *    depends on the key, so a model must be configured or passed per request;
 *    chat and embeddings otherwise fail with a `ConfigurationError` rather than
 *    guessing.
 *
 * That second rule is why the provider can be constructed with only an API key
 * and endpoint: a setup flow can instantiate it, call `getAvailableModels()` to
 * discover what the key is entitled to, and only then choose a model.
 *
 * Model ids are treated as opaque. Whatever `/models` returns is what
 * `getAvailableModels()` reports and what a request may name — LiteLLM route
 * names (`openai/gpt-4o`), versioned ids, and vendor-prefixed ids are passed
 * through byte for byte, with no suffix added, removed, or rewritten.
 *
 * @see {Provider} Interface definition for LLM providers.
 */
const ubc_genai_toolkit_core_1 = require("ubc-genai-toolkit-core");
const litellm_gateway_provider_1 = require("./litellm-gateway-provider");
const ubc_llm_proxy_config_1 = require("./ubc-llm-proxy-config");
/**
 * Provides access to every model a UBC LLM Proxy API key is entitled to.
 *
 * Construct it with just a key and endpoint during setup:
 *
 * ```typescript
 * const provider = new UbcLlmProxyProvider(apiKey, endpoint, logger);
 * const models = await provider.getAvailableModels(); // exact ids from LiteLLM
 * ```
 *
 * ...then configure `defaultModel` / `embeddingModel` (or pass `model` per
 * request) with an id from that list.
 *
 * @implements {Provider}
 */
class UbcLlmProxyProvider extends litellm_gateway_provider_1.LiteLLMGatewayProvider {
    /**
     * Initializes a new instance of the UbcLlmProxyProvider.
     *
     * @param {string} apiKey - The API key for the proxy. Required: it determines
     *   both authentication and which models are reachable.
     * @param {string} endpoint - The proxy's base URL, issued alongside the key.
     *   Required. Normalized via {@link normalizeProxyEndpoint}, so a bare host or
     *   a full request URL both resolve to the API root.
     * @param {LoggerInterface} logger - Logger conforming to the LoggerInterface.
     * @param {UbcLlmProxyProviderOptions} [options] - Optional default chat and
     *   embedding models. Omit them to construct a discovery-only client.
     * @throws {ConfigurationError} If the API key is missing, or the endpoint is
     *   missing or not a valid absolute URL.
     */
    constructor(apiKey, endpoint, logger, options) {
        if (!apiKey || apiKey.trim() === '') {
            throw new ubc_genai_toolkit_core_1.ConfigurationError("apiKey is required for the UBC LLM Proxy provider: it selects which models the endpoint will serve.", { provider: 'ubc-llm-proxy' });
        }
        super({
            providerName: 'ubc-llm-proxy',
            displayName: 'UBC LLM Proxy',
            apiKey,
            // Throws a ConfigurationError when the endpoint is missing or malformed.
            baseURL: (0, ubc_llm_proxy_config_1.normalizeProxyEndpoint)(endpoint),
            logger,
            defaultModel: options?.defaultModel,
            embeddingModel: options?.embeddingModel,
        });
    }
    /**
     * Points a caller with no model configured at the discovery call, since the
     * valid ids depend entirely on their API key.
     */
    modelGuidance(purpose) {
        const kind = purpose === 'embedding' ? 'embedding models' : 'models';
        return (`The proxy has no default ${kind} — call getAvailableModels() to list the ids ` +
            'this API key can use, and configure one of them.');
    }
}
exports.UbcLlmProxyProvider = UbcLlmProxyProvider;
//# sourceMappingURL=ubc-llm-proxy-provider.js.map