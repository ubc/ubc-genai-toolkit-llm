/**
 * @fileoverview Configuration helpers for the UBC LLM Proxy.
 *
 * The proxy is the *uncurated* half of UBC's LiteLLM estate: it serves whatever
 * models the presented API key is entitled to, at whatever endpoint the key was
 * issued for. So — unlike the sandbox — there are no endpoint constants and no
 * model roster here on purpose. Both come from the deployment:
 *
 * - the endpoint is issued with the key, and
 * - the model ids come from `GET {endpoint}/models` at runtime.
 *
 * Hard-coding either would be a guess this toolkit has no business making, and
 * a stale default is worse than a required setting.
 */
/**
 * Normalizes a configured proxy endpoint into the base URL the OpenAI client
 * expects.
 *
 * Same rules as the sandbox (see `normalizeGatewayEndpoint`): a bare host gets
 * `/v1` appended, trailing slashes are dropped, and a full request URL pasted
 * from a `curl` example (`.../v1/chat/completions`, `.../v1/models`) is reduced
 * to the API root. An existing version segment is respected, so a LiteLLM
 * instance mounted under a path prefix keeps working.
 *
 * @param endpoint The endpoint as configured by the caller.
 * @returns The normalized OpenAI-compatible base URL, without a trailing slash.
 * @throws {ConfigurationError} If the endpoint is empty or not a valid absolute URL.
 */
export declare function normalizeProxyEndpoint(endpoint: string): string;
//# sourceMappingURL=ubc-llm-proxy-config.d.ts.map