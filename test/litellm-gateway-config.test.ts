import { describe, it, expect } from 'vitest';
import { ConfigurationError } from 'ubc-genai-toolkit-core';
import {
	normalizeGatewayEndpoint,
	getGatewayReasoningCapability,
	coerceGatewayReasoningEffort,
	resolveGatewayReasoning,
} from '../src/providers/litellm-gateway-config';
import { normalizeProxyEndpoint } from '../src/providers/ubc-llm-proxy-config';
import { normalizeSandboxEndpoint } from '../src/providers/ubc-llm-sandbox-config';

const CONTEXT = {
	label: 'Test Gateway',
	example: 'https://gateway.example.ca/v1',
};

describe('normalizeGatewayEndpoint', () => {
	it('leaves a correct base URL untouched', () => {
		expect(
			normalizeGatewayEndpoint('https://gateway.example.ca/v1', CONTEXT)
		).toBe('https://gateway.example.ca/v1');
	});

	it('appends /v1, strips trailing slashes, and strips route suffixes', () => {
		expect(normalizeGatewayEndpoint('https://gateway.example.ca', CONTEXT)).toBe(
			'https://gateway.example.ca/v1'
		);
		expect(
			normalizeGatewayEndpoint('https://gateway.example.ca/v1///', CONTEXT)
		).toBe('https://gateway.example.ca/v1');
		for (const route of [
			'/chat/completions',
			'/completions',
			'/embeddings',
			'/responses',
			'/models',
		]) {
			expect(
				normalizeGatewayEndpoint(`https://gateway.example.ca/v1${route}`, CONTEXT)
			).toBe('https://gateway.example.ca/v1');
		}
	});

	it('names the calling provider in its errors', () => {
		expect(() => normalizeGatewayEndpoint('', CONTEXT)).toThrowError(
			/endpoint is required for the Test Gateway provider/
		);
		expect(() =>
			normalizeGatewayEndpoint('gateway.example.ca', CONTEXT)
		).toThrowError(/Invalid Test Gateway endpoint/);
		expect(() => normalizeGatewayEndpoint('', CONTEXT)).toThrowError(
			ConfigurationError
		);
	});

	it('is the same normalization behind both provider wrappers', () => {
		for (const endpoint of [
			'https://gateway.example.ca',
			'https://gateway.example.ca/v1/',
			'https://gateway.example.ca/v1/chat/completions',
			'https://gateway.example.ca/llm/v2',
		]) {
			expect(normalizeProxyEndpoint(endpoint)).toBe(
				normalizeSandboxEndpoint(endpoint)
			);
		}
	});
});

describe('normalizeProxyEndpoint', () => {
	it('reports proxy-flavored configuration errors', () => {
		expect(() => normalizeProxyEndpoint('')).toThrowError(
			/endpoint is required for the UBC LLM Proxy provider/
		);
		expect(() => normalizeProxyEndpoint('not a url')).toThrowError(
			/Invalid UBC LLM Proxy endpoint/
		);
	});
});

describe('shared reasoning translation', () => {
	it('treats self-hosted and unknown models as reasoning-capable', () => {
		expect(getGatewayReasoningCapability('gpt-oss-120b')).toBe('optional');
		expect(getGatewayReasoningCapability('qwen3.6-35b-a3b')).toBe('optional');
		expect(getGatewayReasoningCapability('deepseek-r1-distill-70b')).toBe(
			'optional'
		);
	});

	it('keeps OpenAI rules for OpenAI cloud models', () => {
		expect(getGatewayReasoningCapability('gpt-4o')).toBe('unsupported');
		expect(getGatewayReasoningCapability('gpt-5-nano')).toBe('optional');
	});

	it('treats a namespaced route as an unknown model rather than rewriting it', () => {
		// 'openai/gpt-4o' is not parsed back to 'gpt-4o': the gateway owns that
		// mapping, and stripping the prefix here would be rewriting a model id.
		expect(getGatewayReasoningCapability('openai/gpt-4o')).toBe('optional');
	});

	it('clamps gpt-oss efforts and passes everything else through', () => {
		expect(coerceGatewayReasoningEffort('gpt-oss-120b', 'minimal')).toBe('low');
		expect(coerceGatewayReasoningEffort('gpt-oss-120b', 'max')).toBe('high');
		expect(coerceGatewayReasoningEffort('qwen3.6-35b-a3b', 'minimal')).toBe(
			'minimal'
		);
		expect(coerceGatewayReasoningEffort('gpt-oss-120b', undefined)).toBeUndefined();
	});

	it('drives qwen3 thinking through the chat template', () => {
		expect(resolveGatewayReasoning('qwen3.6-35b-a3b', 'none')).toEqual({
			chatTemplateKwargs: { enable_thinking: false },
		});
		expect(resolveGatewayReasoning('gpt-oss-120b', 'none')).toEqual({
			reasoningEffort: 'low',
		});
	});
});
