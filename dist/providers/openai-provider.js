"use strict";
/**
 * @fileoverview OpenAI-backed implementation of {@link Provider}.
 *
 * ## Responsibilities
 *
 * - **Chat**: `sendMessage` / `sendConversation` / `streamConversation` map toolkit types to the
 *   official OpenAI Node SDK (`chat.completions.create`).
 * - **Structured output**: `sendStructuredConversation` uses `beta.chat.completions.parse` with
 *   `zodResponseFormat` so replies are validated against a caller-supplied Zod schema (requires a
 *   model that supports structured outputs / parse).
 * - **Embeddings**: `embed` delegates to `embeddings.create`.
 *
 * ## Options handling
 *
 * `LLMOptions` may include provider-specific fields (e.g. extra body params). We peel off fields
 * the toolkit manages explicitly so they are not duplicated inside `...rest`. `structuredOutputName`
 * is only for structured calls but is stripped here so it never leaks into generic `create` requests.
 *
 * @see {@link Provider} for the shared interface.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIProvider = void 0;
const openai_1 = __importDefault(require("openai"));
const zod_1 = require("openai/helpers/zod");
const ubc_genai_toolkit_core_1 = require("ubc-genai-toolkit-core");
const openai_compat_mapping_1 = require("./openai-compat-mapping");
class OpenAIProvider {
    /**
     * @param apiKey - OpenAI API key (or compatible proxy key).
     * @param defaultModel - Used when `options.model` is omitted.
     * @param logger - Toolkit logger for diagnostics.
     * @param options.endpoint - Optional base URL override (Azure OpenAI, proxies, etc.).
     * @param options.embeddingModel - Default embedding model when `embed` omits `options.model`.
     */
    constructor(apiKey, defaultModel, logger, options) {
        // Omit baseURL when unset so the client uses the default OpenAI API host; custom baseURL supports Azure-compatible proxies.
        this.client = new openai_1.default({
            apiKey,
            ...(options?.endpoint ? { baseURL: options.endpoint } : {}),
        });
        this.defaultModel = defaultModel;
        this.embeddingModel = options?.embeddingModel;
        this.logger = logger;
    }
    /**
     * Get the name of the provider
     * @returns The name of the provider
     */
    getName() {
        return 'openai';
    }
    /**
     * Get the available models for the OpenAI API
     * @returns The available models for the OpenAI API
     */
    async getAvailableModels() {
        try {
            const models = await this.client.models.list();
            return models.data.map((model) => model.id);
        }
        catch (error) {
            this.logger.error('Error fetching OpenAI models', { error });
            throw this.handleError(error);
        }
    }
    /**
     * Single-turn helper: builds `[{ role: 'user', ... }]` (plus optional system from `options`)
     * and delegates to {@link sendConversation}.
     */
    async sendMessage(message, options) {
        const messages = [{ role: 'user', content: message }];
        // Match sendConversation: inject system as a real message when callers use options.systemPrompt (not only via history).
        if (options?.systemPrompt) {
            messages.unshift({ role: 'system', content: options.systemPrompt });
        }
        return this.sendConversation(messages, options);
    }
    /**
     * Send a conversation to the OpenAI API
     * @param messages - The messages to send to the OpenAI API
     * @param options - The options for the OpenAI API
     * @returns The response from the OpenAI API
     */
    async sendConversation(messages, options) {
        try {
            const model = options?.model || this.defaultModel;
            // System filtering + tool_call / tool_result mapping live in openai-compat-mapping.
            const openaiMessages = (0, openai_compat_mapping_1.toOpenAIMessages)(messages);
            // Avoid duplicating system: if the transcript already has system, trust it; else prepend options.systemPrompt once.
            if (options?.systemPrompt && !messages.some((m) => m.role === 'system')) {
                openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
            }
            // Separate the options into known and unknown options
            const { rest } = (0, openai_compat_mapping_1.separateOpenAIOptions)(options);
            // Create a new response from the OpenAI API
            const response = await this.client.chat.completions.create({
                model,
                messages: openaiMessages,
                temperature: options?.temperature,
                max_tokens: options?.maxTokens,
                // OpenAI JSON mode is opt-in via response_format; omit entirely when not requested so the model stays unconstrained.
                response_format: options?.responseFormat === 'json'
                    ? { type: 'json_object' }
                    : undefined,
                // Tool calling: translate toolkit definitions into OpenAI function tools.
                tools: options?.tools && options.tools.length > 0
                    ? (0, openai_compat_mapping_1.toOpenAITools)(options.tools)
                    : undefined,
                tool_choice: options?.toolChoice,
                // Explicit false: callers might pass `stream` in `rest`; we need a non-streaming completion for normalizeResponse.
                stream: false,
                ...rest,
            });
            return this.normalizeResponse(response);
        }
        catch (error) {
            this.logger.error('Error calling OpenAI API', { error });
            throw this.handleError(error);
        }
    }
    /**
     * Send a structured conversation to the OpenAI API
     * @param messages - The messages to send to the OpenAI API
     * @param schema - The schema to use for the structured output
     * @param options - The options for the OpenAI API
     * @returns The response from the OpenAI API
     *
     */
    async sendStructuredConversation(messages, schema, options) {
        // Tools and structured output are mutually exclusive in 0.4.0: run the
        // tool loop with sendConversation, reserve structured for the final turn.
        // Thrown before the try so it propagates as-is; the catch's handleError
        // only preserves OpenAI.APIError and would otherwise mask this message.
        if (options?.tools && options.tools.length > 0) {
            throw new ubc_genai_toolkit_core_1.APIError('Tool calling is not supported with structured output; use sendConversation for the tool loop.', 400, { provider: 'openai' });
        }
        try {
            const model = options?.model || this.defaultModel;
            const openaiMessages = (0, openai_compat_mapping_1.toOpenAIMessages)(messages);
            if (options?.systemPrompt && !messages.some((m) => m.role === 'system')) {
                openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
            }
            const { rest } = (0, openai_compat_mapping_1.separateOpenAIOptions)(options);
            // SDK uses this label inside the response_format payload; default keeps logs and debugging consistent across callers.
            const formatName = options?.structuredOutputName ?? 'structured_output';
            const response = await this.client.beta.chat.completions.parse({
                model,
                messages: openaiMessages,
                temperature: options?.temperature,
                max_tokens: options?.maxTokens,
                response_format: (0, zod_1.zodResponseFormat)(schema, formatName),
                // parse() is non-streaming only; keep false so `...rest` cannot flip this to a stream by accident.
                stream: false,
                ...rest,
            });
            const message = response.choices[0]?.message;
            const refusal = message?.refusal;
            // Structured outputs can return a refusal string instead of parsed JSON; surface that explicitly vs a generic parse failure.
            if (refusal) {
                throw new ubc_genai_toolkit_core_1.APIError(`OpenAI model refused structured output: ${refusal}`, 400, { provider: 'openai', refusal });
            }
            // parse() should populate `parsed` when the model complies; missing means we cannot trust the payload as T.
            if (message?.parsed == null) {
                throw new ubc_genai_toolkit_core_1.APIError('OpenAI structured completion returned no parsed content', 502, { provider: 'openai', finish_reason: response.choices[0]?.finish_reason });
            }
            const base = this.normalizeResponse(response);
            return {
                ...base,
                // Prefer human-visible string content when the API sends it; otherwise expose the structured object as JSON text.
                content: typeof message.content === 'string'
                    ? message.content
                    : JSON.stringify(message.parsed),
                parsed: message.parsed,
            };
        }
        catch (error) {
            this.logger.error('Error calling OpenAI structured API', { error });
            throw this.handleError(error);
        }
    }
    /**
     * Token streaming: invokes `callback` for each text delta; returned {@link LLMResponse} holds
     * the full concatenated string. Usage fields are not filled for this path.
     * @param messages - The messages to send to the OpenAI API
     * @param callback - The callback to use for the OpenAI API
     * @param options - The options for the OpenAI API
     * @returns The response from the OpenAI API
     */
    async streamConversation(messages, callback, options) {
        try {
            const model = options?.model || this.defaultModel;
            const openaiMessages = (0, openai_compat_mapping_1.toOpenAIMessages)(messages);
            if (options?.systemPrompt && !messages.some((m) => m.role === 'system')) {
                openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
            }
            const { rest } = (0, openai_compat_mapping_1.separateOpenAIOptions)(options);
            const stream = await this.client.chat.completions.create({
                model,
                messages: openaiMessages,
                temperature: options?.temperature,
                max_tokens: options?.maxTokens,
                // Tool calling: translate toolkit definitions into OpenAI function tools.
                tools: options?.tools && options.tools.length > 0
                    ? (0, openai_compat_mapping_1.toOpenAITools)(options.tools)
                    : undefined,
                tool_choice: options?.toolChoice,
                stream: true,
                ...rest,
            });
            let fullContent = '';
            // Tool-call deltas arrive fragmented across chunks, keyed by index;
            // accumulate here and surface complete calls only on the final response.
            const toolCallAcc = [];
            let finishReason;
            for await (const chunk of stream) {
                const choice = chunk.choices[0];
                const content = choice?.delta?.content || '';
                // Skip empty deltas so callers are not spammed; OpenAI may emit choice/metadata-only chunks.
                if (content) {
                    fullContent += content;
                    callback(content);
                }
                if (choice?.delta?.tool_calls) {
                    for (const deltaCall of choice.delta.tool_calls) {
                        const i = deltaCall.index;
                        toolCallAcc[i] ?? (toolCallAcc[i] = { args: '' });
                        if (deltaCall.id)
                            toolCallAcc[i].id = deltaCall.id;
                        if (deltaCall.function?.name) {
                            toolCallAcc[i].name = (toolCallAcc[i].name ?? '') + deltaCall.function.name;
                        }
                        if (deltaCall.function?.arguments) {
                            toolCallAcc[i].args += deltaCall.function.arguments;
                        }
                    }
                }
                if (choice?.finish_reason) {
                    finishReason = choice.finish_reason;
                }
            }
            const toolCalls = toolCallAcc.length > 0
                ? (0, openai_compat_mapping_1.fromOpenAIToolCalls)({
                    tool_calls: toolCallAcc.map((acc, i) => ({
                        id: acc.id ?? `call_${i}`,
                        type: 'function',
                        function: { name: acc.name ?? '', arguments: acc.args || '{}' },
                    })),
                })
                : undefined;
            return {
                content: fullContent,
                toolCalls,
                stopReason: (0, openai_compat_mapping_1.mapOpenAIFinishReason)(finishReason),
                model: model,
                metadata: { provider: 'openai' },
            };
        }
        catch (error) {
            this.logger.error('Error streaming from OpenAI API', { error });
            throw this.handleError(error);
        }
    }
    /**
     * Text embeddings for one or more input strings. Extra fields on `EmbeddingOptions` (e.g.
     * `dimensions` for some models) are forwarded except `truncate`, which is not an OpenAI
     * embeddings API field and is stripped here.
     * @param texts - The texts to embed
     * @param options - The options for the OpenAI API
     * @returns The response from the OpenAI API
     */
    async embed(texts, options) {
        try {
            const model = options?.model || this.embeddingModel || 'text-embedding-3-small';
            // `truncate` is a toolkit convenience, not part of OpenAI's embeddings.create body — strip so the SDK does not reject unknown keys.
            const { truncate: _truncate, ...providerOptions } = options || {};
            // Model is passed as the top-level `model` argument below, not inside the spread.
            delete providerOptions.model;
            const response = await this.client.embeddings.create({
                model: model,
                input: texts,
                ...providerOptions,
            });
            return this.normalizeEmbeddingResponse(response);
        }
        catch (error) {
            this.logger.error('Error calling OpenAI Embeddings API', { error });
            throw this.handleError(error);
        }
    }
    /**
     * Normalize the response from the OpenAI API
     * @param response - The response from the OpenAI API
     * @returns The normalized response
     */
    normalizeResponse(response) {
        const choice = response.choices[0];
        return {
            // Empty string if the model returned only tool calls or an unexpected shape — keeps LLMResponse.content always a string.
            content: choice?.message?.content || '',
            toolCalls: (0, openai_compat_mapping_1.fromOpenAIToolCalls)(choice?.message),
            stopReason: (0, openai_compat_mapping_1.mapOpenAIFinishReason)(choice?.finish_reason),
            model: response.model,
            usage: {
                promptTokens: response.usage?.prompt_tokens,
                completionTokens: response.usage?.completion_tokens,
                totalTokens: response.usage?.total_tokens,
            },
            metadata: {
                provider: 'openai',
                id: response.id,
                created: response.created,
            },
        };
    }
    /** Maps OpenAI embeddings response to {@link EmbeddingResponse}. */
    normalizeEmbeddingResponse(response) {
        return {
            embeddings: response.data.map((item) => item.embedding),
            model: response.model,
            usage: {
                promptTokens: response.usage?.prompt_tokens,
                totalTokens: response.usage?.total_tokens,
            },
            metadata: {
                provider: 'openai',
            },
        };
    }
    /** Wraps `OpenAI.APIError` in {@link APIError}; everything else becomes a generic message. */
    handleError(error) {
        // Preserve status/code/param from the official client for observability; everything else stays a generic toolkit error.
        if (error instanceof openai_1.default.APIError) {
            return new ubc_genai_toolkit_core_1.APIError(error.message, error.status || 500, {
                type: error.name,
                code: error.code,
                param: error.param,
            });
        }
        return new ubc_genai_toolkit_core_1.APIError('Unknown error occurred while calling OpenAI API');
    }
}
exports.OpenAIProvider = OpenAIProvider;
//# sourceMappingURL=openai-provider.js.map