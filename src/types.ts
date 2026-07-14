import { ModuleConfig } from 'ubc-genai-toolkit-core';
import type { ZodType } from 'zod';

/**
 * LLM provider types
 */
export type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'ubc-llm-sandbox';

/**
 * LLM configuration
 */
export interface LLMConfig extends ModuleConfig {
	/**
	 * The LLM provider to use
	 */
	provider: ProviderType;

	/**
	 * API key for authentication (required for OpenAI and Anthropic)
	 */
	apiKey?: string;

	/**
	 * API endpoint (required for Ollama, optional for others)
	 */
	endpoint?: string;

	/**
	 * Default model to use for chat completion
	 */
	defaultModel: string;

	/**
	 * Default model to use for embeddings (optional)
	 */
	embeddingModel?: string;

	/**
	 * Default options for requests
	 */
	defaultOptions?: LLMOptions;
}

/**
 * Why generation ended, normalized across providers.
 *
 * - `stop` — the model finished naturally.
 * - `tool_calls` — the model is requesting one or more tool invocations
 *   (see {@link LLMResponse.toolCalls}); the caller should execute them and
 *   send the results back as `role: 'tool'` messages.
 * - `length` — the token limit was hit; output may be truncated.
 * - `other` — any provider-specific reason not covered above (details are
 *   usually preserved in `LLMResponse.metadata`).
 */
export type StopReason = 'stop' | 'tool_calls' | 'length' | 'other';

/**
 * A tool the model may call, in provider-neutral form.
 *
 * Each provider converts `parameters` (a Zod schema) to JSON Schema via
 * `zod-to-json-schema` and translates the definition into its native
 * function-calling format. The `description` is shown to the model and is
 * the primary signal for when the tool gets called — write it carefully.
 */
export interface ToolDefinition {
	/** Unique tool name, e.g. `'calculator'`. */
	name: string;

	/** What the tool does and when to use it — shown to the model. */
	description: string;

	/** Zod schema describing the tool's arguments (typically `z.object({...})`). */
	parameters: ZodType;
}

/**
 * A tool invocation requested by the model.
 *
 * Appears on assistant messages ({@link Message.toolCalls}) and on
 * {@link LLMResponse.toolCalls}. The caller executes the named tool with
 * `arguments` and reports the outcome in a `role: 'tool'` message whose
 * {@link Message.toolCallId} equals this call's `id`.
 */
export interface ToolCall {
	/**
	 * Identifier linking this request to its result message. Provider-assigned
	 * where available (OpenAI, Anthropic); synthesized for providers without
	 * ids (Ollama).
	 */
	id: string;

	/** Name of the tool being called. */
	name: string;

	/** Parsed JSON arguments for the call. */
	arguments: Record<string, unknown>;
}

/**
 * An image attached to a {@link Message} for multi-modal (vision) requests.
 *
 * Provider support: OpenAI, UBC LLM Sandbox (OpenAI-compatible), Anthropic, and
 * Ollama (vision-capable models). Providers that receive images for a model that
 * cannot accept them will surface the underlying provider error.
 */
export interface MessageImage {
	/**
	 * Base64-encoded image bytes, WITHOUT a `data:` URI prefix
	 * (e.g. the output of `buffer.toString('base64')`). Providers add any
	 * required wrapping (OpenAI/Anthropic data URLs, etc.) themselves.
	 */
	data: string;

	/**
	 * The image MIME type, e.g. `'image/png'`, `'image/jpeg'`, `'image/gif'`,
	 * or `'image/webp'`.
	 */
	mimeType: string;
}

/**
 * Message in a conversation
 */
export interface Message {
	/**
	 * The role of the message sender.
	 *
	 * `'tool'` carries the result of a tool invocation back to the model: it is
	 * the application reporting a tool's output, not a user or assistant
	 * utterance. Tool messages must set {@link toolCallId}. Existing code that
	 * never uses tools never sees this role.
	 */
	role: 'user' | 'assistant' | 'system' | 'tool';

	/**
	 * The content of the message
	 */
	content: string;

	/**
	 * Optional images to send alongside `content` for multi-modal requests.
	 * When present (and non-empty), providers build a multi-part message
	 * combining the text `content` with each image. When omitted, the message
	 * is sent as a plain text string exactly as before (fully backwards
	 * compatible). Images are normally only meaningful on `user` messages.
	 */
	images?: MessageImage[];

	/**
	 * Tool invocations requested by the model. Present only on `assistant`
	 * messages replayed into history during a tool-calling loop (the message's
	 * `content` may be an empty string in that case).
	 */
	toolCalls?: ToolCall[];

	/**
	 * For `role: 'tool'` messages: the {@link ToolCall.id} this result answers.
	 */
	toolCallId?: string;

	/**
	 * Optional timestamp
	 */
	timestamp?: string;
}

/**
 * Options for sending messages
 */
export interface LLMOptions {
	/**
	 * Model to use (overrides default)
	 */
	model?: string;

	/**
	 * Temperature (0.0 to 2.0)
	 */
	temperature?: number;

	/**
	 * Maximum tokens to generate
	 */
	maxTokens?: number;

	/**
	 * Stream the response
	 */
	stream?: boolean;

	/**
	 * System prompt to use
	 */
	systemPrompt?: string;

	/**
	 * Response format (e.g., 'json')
	 */
	responseFormat?: 'json' | 'text';

	/**
	 * Tools the model may call. When present, providers translate these into
	 * their native function-calling format. Responses may then carry
	 * {@link LLMResponse.toolCalls}.
	 */
	tools?: ToolDefinition[];

	/**
	 * How eagerly the model should call tools. `'auto'` (default) lets the
	 * model decide, `'required'` forces at least one call, `'none'` disables
	 * calling. Providers without a native equivalent ignore this and log a
	 * debug message.
	 */
	toolChoice?: 'auto' | 'required' | 'none';

	/**
	 * Additional provider-specific options
	 */
	[key: string]: any;
}

/**
 * Options for {@link LLMModule.sendStructuredConversation} and provider structured paths.
 * Extends {@link LLMOptions}; `structuredOutputName` is only used by OpenAI (`zodResponseFormat` schema name).
 *
 * Structured completion is always non-streaming at the HTTP layer, regardless of `stream` in options.
 */
export type StructuredOutputOptions = LLMOptions & {
	structuredOutputName?: string;
};

/**
 * Standardized LLM response
 */
export interface LLMResponse {
	/**
	 * The generated content
	 */
	content: string;

	/**
	 * Tool invocations requested by the model, if any. When set, the caller
	 * should execute each tool and send the results back as `role: 'tool'`
	 * messages, then call the LLM again.
	 */
	toolCalls?: ToolCall[];

	/** Why generation ended, normalized across providers. */
	stopReason?: StopReason;

	/**
	 * The model that generated the content
	 */
	model: string;

	/**
	 * Token usage information (if available)
	 */
	usage?: {
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
	};

	/**
	 * Additional metadata
	 */
	metadata?: Record<string, any>;
}

/**
 * Result of a Zod-validated structured completion. `content` holds the raw JSON string when available;
 * `parsed` is the validated object.
 */
export interface LLMStructuredResponse<T = unknown> extends LLMResponse {
	parsed: T;
}

export type { ZodType } from 'zod';

/**
 * Options specifically for embedding requests.
 */
export interface EmbeddingOptions {
	/**
	 * Model to use for embedding (overrides default embeddingModel)
	 */
	model?: string;

	/**
	 * Whether to truncate input text if it exceeds the model's maximum context length.
	 * Defaults to false. Note: Currently primarily relevant for Ollama.
	 */
	truncate?: boolean;

	/**
	 * Provider-specific options (e.g., 'dimensions' for OpenAI v3 models)
	 */
	[key: string]: any;
}

/**
 * Standardized response for embedding requests.
 */
export interface EmbeddingResponse {
	/**
	 * The generated embedding vectors.
	 */
	embeddings: number[][];

	/**
	 * The model that generated the embeddings.
	 */
	model: string;

	/**
	 * Token usage information (if available, e.g., from OpenAI).
	 */
	usage?: {
		promptTokens?: number;
		totalTokens?: number;
	};

	/**
	 * Additional provider-specific metadata.
	 */
	metadata?: Record<string, any>;
}