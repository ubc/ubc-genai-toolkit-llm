import type { LoggerInterface } from 'ubc-genai-toolkit-core';
import type { ReasoningEffort } from './types';
/** OpenAI Chat Completions `reasoning_effort` values we may send after clamping. */
export type OpenAIReasoningEffortParam = 'none' | 'minimal' | 'low' | 'medium' | 'high';
/** Prefix/heuristic match for OpenAI reasoning models (gpt-5, o1, o3, o4-mini, …). */
export declare function isOpenAIReasoningModel(model: string): boolean;
export interface OpenAIReasoningParams {
    reasoning_effort?: OpenAIReasoningEffortParam;
    clampedFrom?: ReasoningEffort;
}
/**
 * Maps unified {@link ReasoningEffort} to OpenAI `reasoning_effort`, with per-model clamping.
 */
export declare function mapReasoningEffortForOpenAI(effort: ReasoningEffort | undefined, model: string, logger?: LoggerInterface): OpenAIReasoningParams;
/** True when temperature must not be sent (reasoning active on a reasoning model). */
export declare function shouldOmitOpenAITemperature(model: string, reasoningEffort?: ReasoningEffort): boolean;
export type OpenAICompletionExtras = {
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    reasoning_effort?: OpenAIReasoningEffortParam;
};
/**
 * Builds OpenAI-compatible completion fields from toolkit options (temperature, token limit, reasoning).
 */
export declare function buildOpenAICompletionExtras(model: string, options: {
    temperature?: number;
    maxTokens?: number;
    reasoningEffort?: ReasoningEffort;
} | undefined, logger?: LoggerInterface): OpenAICompletionExtras;
export interface AnthropicReasoningParams {
    thinking?: {
        type: 'adaptive';
    } | {
        type: 'disabled';
    } | {
        type: 'enabled';
        budget_tokens: number;
    };
    output_config?: {
        effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    };
}
/**
 * Maps unified effort to Anthropic `thinking` and/or `output_config.effort`.
 * Does not return both disabled thinking and effort simultaneously.
 */
export declare function mapReasoningEffortForAnthropic(effort: ReasoningEffort | undefined, model: string, logger?: LoggerInterface): AnthropicReasoningParams;
export interface OllamaReasoningParams {
    think?: boolean | 'low' | 'medium' | 'high' | 'max';
}
/**
 * Maps unified effort to Ollama top-level `think` (`false` or level string).
 */
export declare function mapReasoningEffortForOllama(effort: ReasoningEffort | undefined, logger?: LoggerInterface): OllamaReasoningParams;
//# sourceMappingURL=reasoning-effort.d.ts.map