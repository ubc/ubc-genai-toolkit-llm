import type { LoggerInterface } from 'ubc-genai-toolkit-core';
import { LiteLLMGatewayProvider, ModelPurpose } from './litellm-gateway-provider';
/** Optional settings for {@link UbcLlmProxyProvider}. */
export interface UbcLlmProxyProviderOptions {
    /**
     * Model used for chat when a request does not name one. Optional — but with
     * neither this nor a per-request `model`, chat calls raise a
     * `ConfigurationError`.
     */
    defaultModel?: string;
    /**
     * Model used by `embed()` when the call does not name one. Optional, with
     * the same consequence for embedding calls.
     */
    embeddingModel?: string;
}
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
export declare class UbcLlmProxyProvider extends LiteLLMGatewayProvider {
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
    constructor(apiKey: string, endpoint: string, logger: LoggerInterface, options?: UbcLlmProxyProviderOptions);
    /**
     * Points a caller with no model configured at the discovery call, since the
     * valid ids depend entirely on their API key.
     */
    protected modelGuidance(purpose: ModelPurpose): string;
}
//# sourceMappingURL=ubc-llm-proxy-provider.d.ts.map