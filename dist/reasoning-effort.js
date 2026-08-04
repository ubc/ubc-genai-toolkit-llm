"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOpenAIReasoningModel = isOpenAIReasoningModel;
exports.mapReasoningEffortForOpenAI = mapReasoningEffortForOpenAI;
exports.shouldOmitOpenAITemperature = shouldOmitOpenAITemperature;
exports.buildOpenAICompletionExtras = buildOpenAICompletionExtras;
exports.mapReasoningEffortForAnthropic = mapReasoningEffortForAnthropic;
exports.mapReasoningEffortForOllama = mapReasoningEffortForOllama;
const OPENAI_REASONING_MODEL_PREFIXES = [
    'gpt-5',
    'o1',
    'o3',
    'o4-mini',
];
const GPT5_MINI_ALLOWED = [
    'minimal',
    'low',
    'medium',
    'high',
];
const GPT51_ALLOWED = [
    'none',
    'low',
    'medium',
    'high',
];
/** Prefix/heuristic match for OpenAI reasoning models (gpt-5, o1, o3, o4-mini, …). */
function isOpenAIReasoningModel(model) {
    const normalized = model.toLowerCase();
    return OPENAI_REASONING_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
function getOpenAIAllowedEfforts(model) {
    const normalized = model.toLowerCase();
    if (normalized.includes('gpt-5.1') || /^gpt-5\.[1-9]/.test(normalized)) {
        return GPT51_ALLOWED;
    }
    if (normalized.includes('gpt-5-mini') || normalized === 'gpt-5-mini') {
        return GPT5_MINI_ALLOWED;
    }
    if (isOpenAIReasoningModel(model)) {
        return GPT5_MINI_ALLOWED;
    }
    return [];
}
function clampToAllowed(requested, allowed, fallback) {
    const direct = requested;
    if (allowed.includes(direct)) {
        return { value: direct };
    }
    const rank = {
        none: 0,
        minimal: 1,
        low: 2,
        medium: 3,
        high: 4,
        xhigh: 5,
        max: 6,
    };
    const allowedRanks = allowed.map((v) => ({
        value: v,
        rank: rank[v] ?? rank.low,
    }));
    const requestedRank = rank[requested];
    let best = allowedRanks[0];
    for (const candidate of allowedRanks) {
        if (Math.abs(candidate.rank - requestedRank) < Math.abs(best.rank - requestedRank)) {
            best = candidate;
        }
    }
    if (requestedRank < best.rank) {
        return { value: allowed[0] ?? fallback, clampedFrom: requested };
    }
    return { value: allowed[allowed.length - 1] ?? fallback, clampedFrom: requested };
}
/**
 * Maps unified {@link ReasoningEffort} to OpenAI `reasoning_effort`, with per-model clamping.
 */
function mapReasoningEffortForOpenAI(effort, model, logger) {
    if (!effort || !isOpenAIReasoningModel(model)) {
        return {};
    }
    const allowed = getOpenAIAllowedEfforts(model);
    if (allowed.length === 0) {
        return {};
    }
    const { value, clampedFrom } = clampToAllowed(effort, allowed, allowed[0]);
    if (clampedFrom) {
        logger?.debug('reasoningEffort clamped for OpenAI model', {
            model,
            requested: effort,
            mapped: value,
        });
    }
    return {
        reasoning_effort: value,
        ...(clampedFrom ? { clampedFrom } : {}),
    };
}
/** True when temperature must not be sent (reasoning active on a reasoning model). */
function shouldOmitOpenAITemperature(model, reasoningEffort) {
    if (!reasoningEffort || !isOpenAIReasoningModel(model)) {
        return false;
    }
    const mapped = mapReasoningEffortForOpenAI(reasoningEffort, model);
    if (!mapped.reasoning_effort) {
        return false;
    }
    // `none` disables reasoning on models that support it (e.g. gpt-5.1).
    if (mapped.reasoning_effort === 'none') {
        return false;
    }
    return true;
}
/**
 * Builds OpenAI-compatible completion fields from toolkit options (temperature, token limit, reasoning).
 */
function buildOpenAICompletionExtras(model, options, logger) {
    const reasoningParams = mapReasoningEffortForOpenAI(options?.reasoningEffort, model, logger);
    const omitTemperature = shouldOmitOpenAITemperature(model, options?.reasoningEffort);
    if (omitTemperature && options?.temperature !== undefined) {
        logger?.debug('Omitting temperature for OpenAI reasoning model with active reasoningEffort', { model, reasoningEffort: options?.reasoningEffort });
    }
    const useReasoningTokens = isOpenAIReasoningModel(model);
    const extras = {};
    if (!omitTemperature && options?.temperature !== undefined) {
        extras.temperature = options.temperature;
    }
    if (options?.maxTokens != null) {
        if (useReasoningTokens) {
            extras.max_completion_tokens = options.maxTokens;
        }
        else {
            extras.max_tokens = options.maxTokens;
        }
    }
    if (reasoningParams.reasoning_effort) {
        extras.reasoning_effort = reasoningParams.reasoning_effort;
    }
    return extras;
}
function isAnthropicAdaptiveModel(model) {
    const normalized = model.toLowerCase();
    return (/claude-(sonnet|opus)-4-6/.test(normalized) ||
        /claude-sonnet-5/.test(normalized) ||
        /claude-opus-4-7/.test(normalized) ||
        /claude-opus-5/.test(normalized));
}
function legacyBudgetTokens(effort) {
    switch (effort) {
        case 'none':
            return 0;
        case 'minimal':
        case 'low':
            return 4096;
        case 'medium':
            return 8192;
        case 'high':
        case 'xhigh':
            return 16384;
        case 'max':
            return 32768;
        default:
            return 4096;
    }
}
function anthropicEffortLevel(effort) {
    switch (effort) {
        case 'minimal':
            return 'low';
        case 'xhigh':
            return 'xhigh';
        case 'max':
            return 'max';
        case 'low':
        case 'medium':
        case 'high':
            return effort;
        default:
            return 'low';
    }
}
/**
 * Maps unified effort to Anthropic `thinking` and/or `output_config.effort`.
 * Does not return both disabled thinking and effort simultaneously.
 */
function mapReasoningEffortForAnthropic(effort, model, logger) {
    if (!effort) {
        return {};
    }
    if (effort === 'none') {
        if (isAnthropicAdaptiveModel(model)) {
            return { thinking: { type: 'disabled' } };
        }
        logger?.debug('reasoningEffort none on legacy Anthropic model; omitting thinking', {
            model,
        });
        return {};
    }
    if (isAnthropicAdaptiveModel(model)) {
        const level = anthropicEffortLevel(effort);
        if (effort === 'minimal') {
            logger?.debug('reasoningEffort minimal mapped to adaptive + effort low for Anthropic', {
                model,
            });
        }
        return {
            thinking: { type: 'adaptive' },
            output_config: { effort: level },
        };
    }
    const budget = legacyBudgetTokens(effort);
    if (budget === 0) {
        return {};
    }
    logger?.debug('reasoningEffort mapped to legacy budget_tokens for Anthropic', {
        model,
        effort,
        budget_tokens: budget,
    });
    return {
        thinking: { type: 'enabled', budget_tokens: budget },
    };
}
/**
 * Maps unified effort to Ollama top-level `think` (`false` or level string).
 */
function mapReasoningEffortForOllama(effort, logger) {
    if (!effort) {
        return {};
    }
    if (effort === 'none') {
        return { think: false };
    }
    if (effort === 'minimal') {
        logger?.debug('reasoningEffort minimal clamped to low for Ollama', {
            requested: effort,
            mapped: 'low',
        });
        return { think: 'low' };
    }
    if (effort === 'xhigh') {
        logger?.debug('reasoningEffort xhigh clamped to high for Ollama', {
            requested: effort,
            mapped: 'high',
        });
        return { think: 'high' };
    }
    return { think: effort };
}
//# sourceMappingURL=reasoning-effort.js.map