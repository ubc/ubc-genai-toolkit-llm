"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UbcLlmSandboxProvider = void 0;
/**
 * @fileoverview Implements the Provider interface for the UBC LLM Sandbox service.
 *
 * The UBC LLM Sandbox provides access to a **curated** set of large language
 * models hosted within UBC's infrastructure. This provider acts as a facade,
 * interacting with the underlying service (which uses a LiteLLM proxy compatible
 * with the OpenAI API) to offer a standardized way for applications to use these
 * models for chat completions and embeddings.
 *
 * Key Features:
 * - Connects to a specified UBC LLM Sandbox endpoint.
 * - Uses an API key for authentication.
 * - **Restricted to the approved B300 models** ({@link UBC_LLM_SANDBOX_APPROVED_MODELS}):
 *   `/models` reports only those, and any other id is rejected before a request
 *   is sent, even when the API key could reach it. Applications that need the
 *   full entitlement of their key should use the `ubc-llm-proxy` provider.
 * - Supports standard chat completion (`sendMessage`, `sendConversation`).
 * - Supports streaming chat completion (`streamConversation`).
 * - Supports tool calling and multi-modal (image) messages.
 * - Supports reasoning models via `reasoningEffort` (e.g. `gpt-oss-120b`).
 * - Supports text embedding generation (`embed`).
 * - Maps UBC LLM Sandbox API responses and errors to the toolkit's standard interfaces.
 * - Requires an explicit endpoint URL during instantiation, unlike some other providers.
 * - Does not support Zod structured output (Coming soon)
 *
 * The 2026 sandbox deployment lives at `ai.apps.ctlt.ubc.ca` (production) and
 * `ai-stg.apps.ctlt.ubc.ca` (staging) — see {@link UBC_LLM_SANDBOX_ENDPOINTS}
 * and {@link UBC_LLM_SANDBOX_MODELS} for the current URLs and model roster.
 *
 * The OpenAI-compatible transport itself is shared with the proxy provider; see
 * {@link LiteLLMGatewayProvider}.
 *
 * @see {Provider} Interface definition for LLM providers.
 * @see {@link https://developer.ubc.ca/sandbox/llm} For more information about the UBC LLM Sandbox.
 */
const ubc_genai_toolkit_core_1 = require("ubc-genai-toolkit-core");
const litellm_gateway_provider_1 = require("./litellm-gateway-provider");
const ubc_llm_sandbox_config_1 = require("./ubc-llm-sandbox-config");
/**
 * Provides access to the approved UBC LLM Sandbox models.
 *
 * This class implements the `Provider` interface, offering methods to interact
 * with LLMs for tasks like generating text responses (chat completions) and
 * creating text embeddings. It specifically targets the UBC LLM Sandbox,
 * which uses a LiteLLM proxy layer presenting an OpenAI-compatible API.
 *
 * Usage typically involves creating an instance with the necessary API key,
 * endpoint URL, a default model name, and a logger. Once instantiated, methods
 * like `sendConversation` or `embed` can be called.
 *
 * @implements {Provider}
 */
class UbcLlmSandboxProvider extends litellm_gateway_provider_1.LiteLLMGatewayProvider {
    /**
     * Initializes a new instance of the UbcLlmSandboxProvider.
     *
     * Configures the provider to communicate with a specific UBC LLM Sandbox endpoint.
     * Requires an API key for authentication and an endpoint URL. A default model must
     * be specified for chat completions when no model is provided in the options.
     * An optional embedding model can also be specified.
     *
     * The default model is *not* validated here: an application configured for a
     * model the sandbox no longer approves should still be able to start up and
     * call `getAvailableModels()`. The check happens when a request is made.
     *
     * @param {string} apiKey - The API key for accessing the UBC LLM Sandbox.
     * @param {string} endpoint - The base URL of the UBC LLM Sandbox API endpoint. This is
     *   mandatory. It is normalized via {@link normalizeSandboxEndpoint}, so the documented
     *   request URL (`.../v1/chat/completions`) and the bare host both resolve to the API root.
     * @param {string} defaultModel - The identifier of the default LLM to use for chat completions if not specified in options.
     * @param {LoggerInterface} logger - An instance of a logger conforming to the LoggerInterface for logging messages.
     * @param {object} [options] - Optional configuration settings.
     * @param {string} [options.embeddingModel] - The identifier of the default model to use for embeddings if not specified in options.
     * @throws {APIError} If the endpoint URL is not provided.
     * @throws {ConfigurationError} If the endpoint URL is not a valid absolute URL.
     */
    constructor(apiKey, endpoint, // Endpoint is mandatory for this provider
    defaultModel, logger, options) {
        if (!endpoint) {
            throw new ubc_genai_toolkit_core_1.APIError('Endpoint is required for UBC LLM Sandbox provider', 400);
        }
        super({
            providerName: 'ubc-llm-sandbox',
            displayName: 'UBC LLM Sandbox',
            apiKey,
            // Accept the endpoint spellings people actually paste from the sandbox docs.
            baseURL: (0, ubc_llm_sandbox_config_1.normalizeSandboxEndpoint)(endpoint),
            logger,
            defaultModel,
            embeddingModel: options?.embeddingModel,
        });
    }
    /**
     * Reports only the approved models, in the order the gateway returned them.
     *
     * A key with broader entitlements will see extra models in a raw
     * `GET /v1/models`; they are deliberately hidden here so that everything this
     * provider advertises is also something it will accept on a request.
     */
    filterAvailableModels(ids) {
        return (0, ubc_llm_sandbox_config_1.filterApprovedSandboxModels)(ids);
    }
    /**
     * Enforces the approved-model allowlist for chat and embeddings alike,
     * covering both the configured default and a per-request `model` override.
     *
     * @throws {ConfigurationError} When the model is not approved.
     */
    validateModel(model, purpose) {
        return (0, ubc_llm_sandbox_config_1.assertApprovedSandboxModel)(model, purpose);
    }
    /** Names the approved ids rather than pointing at `getAvailableModels()`. */
    modelGuidance(purpose) {
        if (purpose === 'embedding') {
            return (`The approved embedding model is '${ubc_llm_sandbox_config_1.UBC_LLM_SANDBOX_MODELS.embedding}'. ` +
                (0, ubc_llm_sandbox_config_1.describeApprovedSandboxModels)());
        }
        return (0, ubc_llm_sandbox_config_1.describeApprovedSandboxModels)();
    }
}
exports.UbcLlmSandboxProvider = UbcLlmSandboxProvider;
//# sourceMappingURL=ubc-llm-sandbox-provider.js.map