"use strict";
/**
 * @fileoverview Ollama (local or remote) implementation of {@link Provider}.
 *
 * ## Responsibilities
 *
 * - **Chat**: Uses the official `ollama` npm client against `host` (your `LLM_ENDPOINT`).
 * - **Structured output**: Converts Zod → JSON Schema (`zod-to-json-schema`), passes it as `format`,
 *   then `JSON.parse` on the full assistant message string and validates with `schema.safeParse`.
 *   Ollama must support schema `format` for your model; the entire `message.content` must be valid JSON.
 * - **JSON mode**: When `responseFormat === 'json'`, `format: 'json'` is set (no schema).
 * - **Embeddings**: `embed` calls `client.embed`.
 *
 * ## Options mapping
 *
 * - Toolkit `maxTokens` → Ollama generate option `num_predict` (max tokens to predict).
 * - Toolkit `temperature` → Ollama `options.temperature`.
 * - Other keys on `LLMOptions` may pass through via `rest` into `options` (e.g. `num_ctx` for context).
 * - `structuredOutputName` is stripped in {@link separateOptions} so it is never sent to Ollama.
 *
 * @see {@link Provider} for the shared interface.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaProvider = void 0;
const ubc_genai_toolkit_core_1 = require("ubc-genai-toolkit-core");
const ollama_1 = require("ollama");
const zod_to_json_schema_1 = require("zod-to-json-schema");
const ollama_mapping_1 = require("./ollama-mapping");
/**
 * Pulls toolkit-managed fields off `LLMOptions`, maps temperature / maxTokens into Ollama’s
 * `options` object shape, and returns the remainder as `rest` for merging.
 */
function separateOptions(options = {}) {
    const { model, temperature, maxTokens, systemPrompt, responseFormat, stream, 
    // Not an Ollama generate field; strip so it cannot be forwarded inside `rest`.
    // Toolkit-managed: tools are translated natively; Ollama has no toolChoice
    // equivalent. Both are stripped so they never reach `rest`/`finalOptions`.
    tools, toolChoice, structuredOutputName: _structuredOutputName, ...rest } = options;
    // Create a new object with the known options
    const known = {
        model,
        temperature,
        maxTokens,
        systemPrompt,
        responseFormat,
        stream,
        tools,
        toolChoice,
        structuredOutputName: _structuredOutputName,
    };
    const ollamaSpecific = {};
    if (temperature !== undefined)
        ollamaSpecific.temperature = temperature;
    // Ollama names this differently from OpenAI/Anthropic `max_tokens`; map here so callers keep using `maxTokens`.
    if (maxTokens !== undefined)
        ollamaSpecific.num_predict = maxTokens;
    return {
        known,
        ollamaSpecific,
        rest,
    };
}
class OllamaProvider {
    /**
     * @param endpoint - Ollama server URL, e.g. `http://127.0.0.1:11434`.
     * @param defaultModel - Used when `options.model` is omitted.
     * @param logger - Toolkit logger for diagnostics.
     * @param options.embeddingModel - Default for `embed` when `options.model` is omitted.
     */
    constructor(endpoint, defaultModel, logger, options) {
        // Instantiate the client here with the host
        this.client = new ollama_1.Ollama({ host: endpoint });
        this.endpoint = endpoint;
        this.defaultModel = defaultModel;
        this.embeddingModel = options?.embeddingModel;
        this.logger = logger;
        this.logger.debug('OllamaProvider initialized', {
            endpoint,
            defaultModel,
            embeddingModel: this.embeddingModel,
        });
    }
    /**
     * Get the name of the provider
     * @returns The name of the provider
     */
    getName() {
        return 'ollama';
    }
    /** Returns model names from `GET /api/tags` (via SDK `list()`). */
    async getAvailableModels() {
        try {
            this.logger.debug('Fetching available Ollama models', { endpoint: this.endpoint });
            // Use the stored client instance directly
            const response = await this.client.list();
            return response.models.map((model) => model.name);
        }
        catch (error) {
            this.logger.error('Error fetching Ollama models', { error });
            throw this.handleError(error);
        }
    }
    /**
     * Send a single message to the Ollama API
     * @param message - The message to send to the Ollama API
     * @param options - The options for the Ollama API
     * @returns The response from the Ollama API
     */
    async sendMessage(message, options) {
        const messages = [{ role: 'user', content: message }];
        // Ollama accepts system as a normal chat message; inject when options carry it and history does not already.
        if (options?.systemPrompt) {
            messages.unshift({ role: 'system', content: options.systemPrompt });
        }
        this.logger.debug('Sending single message via sendConversation', {
            messageCount: messages.length,
        });
        return this.sendConversation(messages, options);
    }
    /**
     * Non-streaming chat. Merges `ollamaSpecific` + `rest` into the `options` field of the chat
     * request. Sets `format: 'json'` only when `responseFormat === 'json'`.
     *
     * @param messages - The messages to send to the Ollama API
     * @param options - The options for the Ollama API
     * @returns The response from the Ollama API
     */
    async sendConversation(messages, options) {
        const model = options?.model || this.defaultModel;
        this.logger.debug('Sending conversation to Ollama', {
            model,
            messageCount: messages.length,
            options,
        });
        try {
            // Convert the messages to the Ollama format
            const ollamaMessages = (0, ollama_mapping_1.toOllamaMessages)(messages);
            // Separate known, Ollama-specific, and passthrough options
            const { ollamaSpecific, rest } = separateOptions(options);
            // Merge Ollama-specific options with the rest of the passthrough options
            const finalOptions = { ...rest, ...ollamaSpecific };
            // Handle system prompt if not already in messages (from known options)
            if (options?.systemPrompt && !messages.some(m => m.role === 'system')) {
                ollamaMessages.unshift({ role: 'system', content: options.systemPrompt });
            }
            // Ollama has no tool_choice equivalent; honor the contract by logging, not failing.
            if (options?.toolChoice) {
                this.logger.debug('Ollama does not support toolChoice; ignoring.', { toolChoice: options.toolChoice });
            }
            // Use the stored client instance directly
            const response = await this.client.chat({
                model: model,
                messages: ollamaMessages,
                stream: false,
                // `format: 'json'` is Ollama's loose JSON mode; structured chat uses a JSON Schema object instead (see sendStructuredConversation).
                format: options?.responseFormat === 'json' ? 'json' : undefined,
                tools: options?.tools && options.tools.length > 0
                    ? (0, ollama_mapping_1.toOllamaTools)(options.tools)
                    : undefined,
                options: finalOptions,
            });
            return this.normalizeResponse(response, model);
        }
        catch (error) {
            this.logger.error('Error sending conversation to Ollama', { error });
            throw this.handleError(error);
        }
    }
    /**
     * Sends `format` as a JSON Schema derived from `schema`, then parses and validates the model
     * output with Zod. Requires a server/model that honors JSON Schema in `format`.
     *
     * `schema as never` avoids a TypeScript depth issue with `zodToJsonSchema` generics; the cast
     * on the result narrows to a plain object for Ollama.
     * @param messages - The messages to send to the Ollama API
     * @param schema - The schema to use for the structured output
     * @param options - The options for the Ollama API
     * @returns The response from the Ollama API
     */
    async sendStructuredConversation(messages, schema, options) {
        // Tools and structured output are mutually exclusive in 0.4.0: run the
        // tool loop with sendConversation, reserve structured for the final turn.
        // Thrown before the try so it propagates as-is.
        if (options?.tools && options.tools.length > 0) {
            throw new ubc_genai_toolkit_core_1.APIError('Tool calling is not supported with structured output; use sendConversation for the tool loop.', 400, { provider: 'ollama' });
        }
        const model = options?.model || this.defaultModel;
        this.logger.debug('Sending structured conversation to Ollama', {
            model,
            messageCount: messages.length,
        });
        try {
            // Convert the messages to the Ollama format
            const ollamaMessages = (0, ollama_mapping_1.toOllamaMessages)(messages);
            // Separate known, Ollama-specific, and passthrough options
            const { ollamaSpecific, rest } = separateOptions(options);
            // Merge Ollama-specific options with the rest of the passthrough options
            const finalOptions = { ...rest, ...ollamaSpecific };
            // Handle system prompt if not already in messages (from known options)
            if (options?.systemPrompt && !messages.some((m) => m.role === 'system')) {
                ollamaMessages.unshift({ role: 'system', content: options.systemPrompt });
            }
            // Cast breaks TS "excessively deep" instantiation on some zod versions; runtime shape is still a valid JSON Schema object.
            const jsonSchema = (0, zod_to_json_schema_1.zodToJsonSchema)(schema, {
                // Ollama expects JSON Schema compatible objects; avoid $ref indirection the server may not resolve.
                target: 'jsonSchema7',
                $refStrategy: 'none',
            });
            // Use the stored client instance directly
            const response = await this.client.chat({
                model,
                messages: ollamaMessages,
                stream: false,
                format: jsonSchema,
                options: finalOptions,
            });
            const raw = response?.message?.content ?? '';
            let asJson;
            try {
                asJson = JSON.parse(raw);
            }
            catch {
                // Model may return prose or malformed JSON when schema `format` is ignored — fail fast with a short preview for logs.
                throw new ubc_genai_toolkit_core_1.APIError('Ollama returned non-JSON content for structured chat', 502, { provider: 'ollama', preview: raw.slice(0, 200) });
            }
            const parsed = schema.safeParse(asJson);
            // Second line of defense: Ollama does not guarantee schema adherence even when `format` is set.
            if (!parsed.success) {
                throw new ubc_genai_toolkit_core_1.APIError(`Ollama output failed Zod validation: ${parsed.error.message}`, 502, { provider: 'ollama', zodIssues: parsed.error.flatten() });
            }
            const base = this.normalizeResponse(response, model);
            return {
                ...base,
                content: raw,
                parsed: parsed.data,
            };
        }
        catch (error) {
            // Re-throw our own validation errors without wrapping so status/message stay precise for callers.
            if (error instanceof ubc_genai_toolkit_core_1.APIError) {
                throw error;
            }
            this.logger.error('Error sending structured conversation to Ollama', {
                error,
            });
            throw this.handleError(error);
        }
    }
    /**
     * Streams message content; when the stream reports `done`, copies timing / eval counts into
     * {@link LLMResponse.metadata} and maps eval counts into `usage` for rough token-like metrics.
     * @param messages - The messages to send to the Ollama API
     * @param callback - The callback to use for the Ollama API
     * @param options - The options for the Ollama API
     * @returns The response from the Ollama API
     */
    async streamConversation(messages, callback, options) {
        const model = options?.model || this.defaultModel;
        this.logger.debug('Streaming conversation from Ollama', {
            model,
            messageCount: messages.length,
            options,
        });
        const ollamaMessages = messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
            ...(0, ollama_mapping_1.ollamaImages)(msg),
        }));
        const { ollamaSpecific, rest } = separateOptions(options);
        const finalOptions = { ...rest, ...ollamaSpecific };
        if (options?.systemPrompt && !messages.some((m) => m.role === 'system')) {
            ollamaMessages.unshift({ role: 'system', content: options.systemPrompt });
        }
        if (options?.toolChoice) {
            this.logger.debug('Ollama does not support toolChoice; ignoring.', { toolChoice: options.toolChoice });
        }
        let fullContent = '';
        // Ollama may emit many chunks before `done`; keep the last `done` payload for timing/eval metadata on the final LLMResponse.
        let finalResponseMetadata = null;
        // Ollama sends tool calls whole (not fragmented); collect any that arrive across chunks.
        const collectedToolCalls = [];
        try {
            const stream = await this.client.chat({
                model: model,
                messages: ollamaMessages,
                stream: true,
                // Same as non-stream: JSON mode is separate from JSON Schema structured output.
                format: options?.responseFormat === 'json' ? 'json' : undefined,
                tools: options?.tools && options.tools.length > 0
                    ? (0, ollama_mapping_1.toOllamaTools)(options.tools)
                    : undefined,
                options: finalOptions,
            });
            for await (const part of stream) {
                const contentChunk = part.message?.content || '';
                if (contentChunk) {
                    fullContent += contentChunk;
                    callback(contentChunk);
                }
                if (part.message?.tool_calls) {
                    collectedToolCalls.push(...part.message.tool_calls);
                }
                if (part.done) {
                    // Spread only defined fields so metadata stays small and JSON-serializable for downstream logging.
                    finalResponseMetadata = {
                        provider: 'ollama',
                        ...(part?.done_reason && { done_reason: part.done_reason }),
                        ...(part?.total_duration && { total_duration: part.total_duration }),
                        ...(part?.load_duration && { load_duration: part.load_duration }),
                        ...(part?.prompt_eval_count && {
                            prompt_eval_count: part.prompt_eval_count,
                        }),
                        ...(part?.prompt_eval_duration && {
                            prompt_eval_duration: part.prompt_eval_duration,
                        }),
                        ...(part?.eval_count && { eval_count: part.eval_count }),
                        ...(part?.eval_duration && { eval_duration: part.eval_duration }),
                    };
                }
            }
            return {
                content: fullContent,
                toolCalls: (0, ollama_mapping_1.fromOllamaToolCalls)(collectedToolCalls.length > 0 ? collectedToolCalls : undefined),
                stopReason: (0, ollama_mapping_1.mapOllamaDoneReason)(finalResponseMetadata?.done_reason, collectedToolCalls.length > 0),
                model: model,
                usage: {
                    // Ollama reports eval counts, not tokenizer-based tokens; map into usage for a consistent shape with other providers.
                    promptTokens: finalResponseMetadata?.prompt_eval_count,
                    completionTokens: finalResponseMetadata?.eval_count,
                    totalTokens: undefined,
                },
                metadata: finalResponseMetadata || { provider: 'ollama' },
            };
        }
        catch (error) {
            this.logger.error('Error streaming conversation from Ollama', { error });
            throw this.handleError(error);
        }
    }
    /**
     * Generate embeddings for a list of text strings using the Ollama API
     * @param texts - The texts to embed
     * @param options - The options for the Ollama API
     * @returns The response from the Ollama API
     */
    async embed(texts, options) {
        const model = options?.model || this.embeddingModel || 'nomic-embed-text';
        this.logger.debug('Generating embeddings with Ollama', {
            model,
            textCount: texts.length,
            options,
        });
        try {
            // Pass the whole array to ollama.embed
            const response = await this.client.embed({
                model: model,
                input: texts, // Use 'input' and pass the array
                truncate: options?.truncate,
            });
            return {
                embeddings: response.embeddings,
                model: model,
                // Ollama embed responses do not expose token usage in the same shape as chat; leave undefined rather than inventing counts.
                usage: undefined,
                metadata: { provider: 'ollama' },
            };
        }
        catch (error) {
            this.logger.error('Error generating embeddings with Ollama', { error });
            throw this.handleError(error);
        }
    }
    /** Normalizes Ollama HTTP errors and generic `Error` into {@link APIError}. */
    handleError(error) {
        this.logger.error('Error interacting with Ollama API', { error });
        // SDK / fetch failures often look like `{ status, message }`; narrow before reading to avoid throwing while handling errors.
        if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
            const e = error;
            return new ubc_genai_toolkit_core_1.APIError(`Ollama API Error: ${e.message}`, e.status, {
                originalError: error,
                provider: 'ollama',
            });
        }
        if (error instanceof Error) {
            return new ubc_genai_toolkit_core_1.APIError(`Ollama Provider Error: ${error.message}`, 500, {
                originalError: error,
                provider: 'ollama',
            });
        }
        return new ubc_genai_toolkit_core_1.APIError('Unknown error occurred while calling Ollama API', 500, {
            provider: 'ollama',
        });
    }
    /**
     * Normalizes the response from the Ollama API into the toolkit's standard `LLMResponse` format.
     * @param response - The response object from the Ollama API.
     * @param model - The model that generated the response.
     * @returns An `LLMResponse` object.
     */
    normalizeResponse(response, model) {
        return {
            content: response?.message?.content || '',
            toolCalls: (0, ollama_mapping_1.fromOllamaToolCalls)(response?.message?.tool_calls),
            stopReason: (0, ollama_mapping_1.mapOllamaDoneReason)(response?.done_reason, (response?.message?.tool_calls?.length ?? 0) > 0),
            // Non-stream final object may omit `model`; fall back to the request model string we passed in.
            model: response?.model || model,
            usage: {
                promptTokens: response?.prompt_eval_count,
                completionTokens: response?.eval_count,
                // No combined total: eval counts are not tokenizer tokens; leave undefined to avoid implying a real token sum.
                totalTokens: undefined,
            },
            metadata: {
                provider: 'ollama',
                ...(response?.done !== undefined && { done: response.done }),
                ...(response?.done_reason && { done_reason: response.done_reason }),
                ...(response?.total_duration && { total_duration: response.total_duration }),
                ...(response?.load_duration && { load_duration: response.load_duration }),
                ...(response?.prompt_eval_duration && {
                    prompt_eval_duration: response.prompt_eval_duration,
                }),
                ...(response?.eval_duration && { eval_duration: response.eval_duration }),
            },
        };
    }
}
exports.OllamaProvider = OllamaProvider;
//# sourceMappingURL=ollama-provider.js.map