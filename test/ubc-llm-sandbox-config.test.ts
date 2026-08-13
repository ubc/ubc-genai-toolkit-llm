import { describe, it, expect } from 'vitest';
import { ConfigurationError } from 'ubc-genai-toolkit-core';
import {
	UBC_LLM_SANDBOX_ENDPOINTS,
	UBC_LLM_SANDBOX_MODELS,
	UBC_LLM_SANDBOX_APPROVED_MODELS,
	isApprovedSandboxModel,
	filterApprovedSandboxModels,
	assertApprovedSandboxModel,
	normalizeSandboxEndpoint,
	getSandboxReasoningCapability,
	coerceSandboxReasoningEffort,
	resolveSandboxReasoning,
} from '../src/providers/ubc-llm-sandbox-config';

describe('UBC_LLM_SANDBOX_APPROVED_MODELS', () => {
	it('is the single source of truth the role roster draws from', () => {
		for (const model of Object.values(UBC_LLM_SANDBOX_MODELS)) {
			expect(UBC_LLM_SANDBOX_APPROVED_MODELS).toContain(model);
		}
	});

	it('lists the approved B300 chat, reasoning, and embedding models', () => {
		// Pinned deliberately: changing this list changes what the sandbox
		// provider will talk to, and should be a conscious edit verified against
		// `GET {endpoint}/models` on staging.
		expect([...UBC_LLM_SANDBOX_APPROVED_MODELS]).toEqual([
			'gpt-oss-120b',
			'qwen3.6-35b-a3b',
			'qwen3-embedding-0.6b',
		]);
	});

	it('has no duplicates', () => {
		expect(new Set(UBC_LLM_SANDBOX_APPROVED_MODELS).size).toBe(
			UBC_LLM_SANDBOX_APPROVED_MODELS.length
		);
	});
});

describe('isApprovedSandboxModel', () => {
	it('accepts every approved id', () => {
		for (const model of UBC_LLM_SANDBOX_APPROVED_MODELS) {
			expect(isApprovedSandboxModel(model)).toBe(true);
		}
	});

	it('rejects models the key may otherwise be entitled to', () => {
		expect(isApprovedSandboxModel('gpt-4o')).toBe(false);
		expect(isApprovedSandboxModel('claude-sonnet-4-5-20250929')).toBe(false);
		expect(isApprovedSandboxModel('nomic-embed-text')).toBe(false);
	});

	it('matches exactly — no case folding, trimming, or suffix repair', () => {
		expect(isApprovedSandboxModel('GPT-OSS-120B')).toBe(false);
		expect(isApprovedSandboxModel(' gpt-oss-120b')).toBe(false);
		expect(isApprovedSandboxModel('gpt-oss-120b:latest')).toBe(false);
		expect(isApprovedSandboxModel('openai/gpt-oss-120b')).toBe(false);
	});

	it('handles a missing model id', () => {
		expect(isApprovedSandboxModel(undefined)).toBe(false);
		expect(isApprovedSandboxModel('')).toBe(false);
	});
});

describe('filterApprovedSandboxModels', () => {
	it('keeps only approved ids, in the order given', () => {
		expect(
			filterApprovedSandboxModels([
				'gpt-4o',
				'qwen3.6-35b-a3b',
				'nomic-embed-text',
				'gpt-oss-120b',
			])
		).toEqual(['qwen3.6-35b-a3b', 'gpt-oss-120b']);
	});

	it('returns an empty list rather than a fallback when nothing is approved', () => {
		expect(filterApprovedSandboxModels(['gpt-4o', 'gpt-4.1-mini'])).toEqual([]);
	});
});

describe('assertApprovedSandboxModel', () => {
	it('returns an approved model unchanged', () => {
		expect(assertApprovedSandboxModel(UBC_LLM_SANDBOX_MODELS.chat)).toBe(
			UBC_LLM_SANDBOX_MODELS.chat
		);
	});

	it('throws a ConfigurationError naming the approved models', () => {
		const error = (() => {
			try {
				assertApprovedSandboxModel('gpt-4o', 'chat');
			} catch (e) {
				return e as ConfigurationError;
			}
		})();

		expect(error).toBeInstanceOf(ConfigurationError);
		expect(error!.message).toContain("Model 'gpt-4o' is not approved");
		for (const approved of UBC_LLM_SANDBOX_APPROVED_MODELS) {
			expect(error!.message).toContain(approved);
		}
		expect(error!.message).toContain('ubc-llm-proxy');
		expect(error!.details).toMatchObject({
			provider: 'ubc-llm-sandbox',
			model: 'gpt-4o',
			purpose: 'chat',
		});
	});

	it('reports the purpose it was called for', () => {
		expect(() =>
			assertApprovedSandboxModel('text-embedding-3-large', 'embedding')
		).toThrowError(/requested for embedding/);
	});
});

describe('normalizeSandboxEndpoint', () => {
	it('leaves a correct base URL untouched', () => {
		expect(normalizeSandboxEndpoint(UBC_LLM_SANDBOX_ENDPOINTS.staging)).toBe(
			'https://ai-stg.apps.ctlt.ubc.ca/v1'
		);
		expect(normalizeSandboxEndpoint(UBC_LLM_SANDBOX_ENDPOINTS.production)).toBe(
			'https://ai.apps.ctlt.ubc.ca/v1'
		);
	});

	it('appends /v1 when the host is given without a version segment', () => {
		expect(
			normalizeSandboxEndpoint('https://ai-stg.apps.ctlt.ubc.ca')
		).toBe('https://ai-stg.apps.ctlt.ubc.ca/v1');
	});

	it('strips trailing slashes', () => {
		expect(
			normalizeSandboxEndpoint('https://ai-stg.apps.ctlt.ubc.ca/v1/')
		).toBe('https://ai-stg.apps.ctlt.ubc.ca/v1');
		expect(normalizeSandboxEndpoint('https://ai.apps.ctlt.ubc.ca///')).toBe(
			'https://ai.apps.ctlt.ubc.ca/v1'
		);
	});

	it('strips a pasted route suffix back to the API base', () => {
		expect(
			normalizeSandboxEndpoint(
				'https://ai-stg.apps.ctlt.ubc.ca/v1/chat/completions'
			)
		).toBe('https://ai-stg.apps.ctlt.ubc.ca/v1');
		expect(
			normalizeSandboxEndpoint('https://ai-stg.apps.ctlt.ubc.ca/v1/embeddings')
		).toBe('https://ai-stg.apps.ctlt.ubc.ca/v1');
		expect(
			normalizeSandboxEndpoint('https://ai-stg.apps.ctlt.ubc.ca/v1/models')
		).toBe('https://ai-stg.apps.ctlt.ubc.ca/v1');
	});

	it('adds /v1 to a route pasted without a version segment', () => {
		expect(
			normalizeSandboxEndpoint(
				'https://ai-stg.apps.ctlt.ubc.ca/chat/completions'
			)
		).toBe('https://ai-stg.apps.ctlt.ubc.ca/v1');
	});

	it('preserves a path prefix and an existing non-v1 version', () => {
		expect(normalizeSandboxEndpoint('https://gateway.example.ca/llm')).toBe(
			'https://gateway.example.ca/llm/v1'
		);
		expect(normalizeSandboxEndpoint('https://gateway.example.ca/llm/v2')).toBe(
			'https://gateway.example.ca/llm/v2'
		);
	});

	it('trims surrounding whitespace', () => {
		expect(
			normalizeSandboxEndpoint('  https://ai-stg.apps.ctlt.ubc.ca/v1  ')
		).toBe('https://ai-stg.apps.ctlt.ubc.ca/v1');
	});

	it('throws a ConfigurationError for empty or malformed endpoints', () => {
		expect(() => normalizeSandboxEndpoint('')).toThrowError(
			/endpoint is required/
		);
		expect(() => normalizeSandboxEndpoint('   ')).toThrowError(
			/endpoint is required/
		);
		expect(() => normalizeSandboxEndpoint('ai-stg.apps.ctlt.ubc.ca')).toThrowError(
			/absolute URL/
		);
	});
});

describe('getSandboxReasoningCapability', () => {
	it('allows reasoning on self-hosted sandbox models', () => {
		expect(getSandboxReasoningCapability(UBC_LLM_SANDBOX_MODELS.reasoning)).toBe(
			'optional'
		);
		expect(getSandboxReasoningCapability(UBC_LLM_SANDBOX_MODELS.chat)).toBe(
			'optional'
		);
	});

	it('does not mistake gpt-oss for an OpenAI cloud model', () => {
		expect(getSandboxReasoningCapability('gpt-oss-120b')).toBe('optional');
		expect(getSandboxReasoningCapability('GPT-OSS-20B')).toBe('optional');
	});

	it('stays permissive for models added to the roster later', () => {
		expect(getSandboxReasoningCapability('deepseek-r1-distill-70b')).toBe(
			'optional'
		);
		expect(getSandboxReasoningCapability('llama-4-maverick')).toBe('optional');
	});

	it('keeps OpenAI rules for OpenAI models proxied through the sandbox', () => {
		expect(getSandboxReasoningCapability('gpt-4.1-mini')).toBe('unsupported');
		expect(getSandboxReasoningCapability('gpt-4o')).toBe('unsupported');
		expect(getSandboxReasoningCapability('gpt-5-nano')).toBe('optional');
		expect(getSandboxReasoningCapability('o3')).toBe('optional');
	});
});

describe('coerceSandboxReasoningEffort', () => {
	it('passes through the efforts gpt-oss accepts natively', () => {
		for (const effort of ['low', 'medium', 'high'] as const) {
			expect(coerceSandboxReasoningEffort('gpt-oss-120b', effort)).toBe(effort);
		}
	});

	it('clamps efforts outside the gpt-oss scale to the nearest depth', () => {
		expect(coerceSandboxReasoningEffort('gpt-oss-120b', 'minimal')).toBe('low');
		expect(coerceSandboxReasoningEffort('gpt-oss-120b', 'none')).toBe('low');
		expect(coerceSandboxReasoningEffort('gpt-oss-120b', 'xhigh')).toBe('high');
		expect(coerceSandboxReasoningEffort('gpt-oss-120b', 'max')).toBe('high');
	});

	it('leaves other models alone so the gateway decides', () => {
		expect(coerceSandboxReasoningEffort('qwen3.6-35b-a3b', 'minimal')).toBe(
			'minimal'
		);
		expect(coerceSandboxReasoningEffort('gpt-5-nano', 'minimal')).toBe('minimal');
	});

	it('returns undefined when no effort was requested', () => {
		expect(coerceSandboxReasoningEffort('gpt-oss-120b', undefined)).toBeUndefined();
	});

	it('leaves an unrecognized effort intact for the shared validator to reject', () => {
		expect(coerceSandboxReasoningEffort('gpt-oss-120b', 'turbo')).toBe('turbo');
	});
});

describe('resolveSandboxReasoning', () => {
	// Efforts verified against staging on 2026-08-05: gpt-oss accepts only
	// low/medium/high; everything else returns HTTP 400 from Harmony.
	it('drives gpt-oss through reasoning_effort, clamped', () => {
		expect(resolveSandboxReasoning('gpt-oss-120b', 'medium')).toEqual({
			reasoningEffort: 'medium',
		});
		expect(resolveSandboxReasoning('gpt-oss-120b', 'minimal')).toEqual({
			reasoningEffort: 'low',
		});
		expect(resolveSandboxReasoning('gpt-oss-120b', 'max')).toEqual({
			reasoningEffort: 'high',
		});
	});

	it("turns 'none' into a chat-template toggle for qwen3, not reasoning_effort", () => {
		expect(resolveSandboxReasoning('qwen3.6-35b-a3b', 'none')).toEqual({
			chatTemplateKwargs: { enable_thinking: false },
		});
	});

	it('leaves the qwen3 template alone for other efforts', () => {
		expect(resolveSandboxReasoning('qwen3.6-35b-a3b', 'high')).toEqual({
			reasoningEffort: 'high',
		});
		expect(resolveSandboxReasoning('qwen3.6-35b-a3b', undefined)).toEqual({
			reasoningEffort: undefined,
		});
	});

	it('does not apply the qwen toggle to other models', () => {
		expect(resolveSandboxReasoning('gpt-oss-120b', 'none')).toEqual({
			reasoningEffort: 'low',
		});
	});
});
