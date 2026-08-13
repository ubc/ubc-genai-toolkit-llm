import type { LoggerInterface } from 'ubc-genai-toolkit-core';
import { LiteLLMGatewayProvider, ModelPurpose } from './litellm-gateway-provider';
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
export declare class UbcLlmSandboxProvider extends LiteLLMGatewayProvider {
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
    constructor(apiKey: string, endpoint: string, // Endpoint is mandatory for this provider
    defaultModel: string, logger: LoggerInterface, options?: {
        embeddingModel?: string;
    });
    /**
     * Reports only the approved models, in the order the gateway returned them.
     *
     * A key with broader entitlements will see extra models in a raw
     * `GET /v1/models`; they are deliberately hidden here so that everything this
     * provider advertises is also something it will accept on a request.
     */
    protected filterAvailableModels(ids: string[]): string[];
    /**
     * Enforces the approved-model allowlist for chat and embeddings alike,
     * covering both the configured default and a per-request `model` override.
     *
     * @throws {ConfigurationError} When the model is not approved.
     */
    protected validateModel(model: string, purpose: ModelPurpose): string;
    /** Names the approved ids rather than pointing at `getAvailableModels()`. */
    protected modelGuidance(purpose: ModelPurpose): string;
}
//# sourceMappingURL=ubc-llm-sandbox-provider.d.ts.map