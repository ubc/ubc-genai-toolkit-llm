import { ModuleConfig } from 'ubc-genai-toolkit-core';

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
	 * The role of the message sender
	 */
	role: 'user' | 'assistant' | 'system';

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