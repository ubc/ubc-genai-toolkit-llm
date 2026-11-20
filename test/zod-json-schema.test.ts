import { describe, it, expect } from 'vitest';
import { z as z4 } from 'zod';
import { z as z3 } from 'zod/v3';
import { zodResponseFormat } from 'openai/helpers/zod';
import {
	isZod4Schema,
	zodSchemaToJsonSchema,
} from '../src/providers/zod-json-schema';
import { toOpenAITools } from '../src/providers/openai-compat-mapping';
import { toAnthropicTools } from '../src/providers/anthropic-mapping';
import { toOllamaTools } from '../src/providers/ollama-mapping';

/** The same shape built with each Zod generation a caller might hand the toolkit. */
const build = (z: any) =>
	z.object({
		city: z.string().describe('City name'),
		unit: z.enum(['c', 'f']).optional(),
		days: z.number().int().min(1).default(3),
		tags: z.array(z.string()),
		nested: z.object({ flag: z.boolean().nullable() }),
	});

const v3Schema = build(z3);
const v4Schema = build(z4);

describe('zodSchemaToJsonSchema', () => {
	it('tells Zod 3 and Zod 4 schemas apart', () => {
		expect(isZod4Schema(v4Schema)).toBe(true);
		expect(isZod4Schema(v3Schema)).toBe(false);
		expect(isZod4Schema(undefined)).toBe(false);
	});

	it('emits the same JSON Schema for Zod 3 schemas as 0.7.x did', () => {
		// Captured from 0.7.2 (zod 3.25.76 + zod-to-json-schema 3.25.2).
		expect(zodSchemaToJsonSchema(v3Schema)).toEqual({
			$schema: 'http://json-schema.org/draft-07/schema#',
			type: 'object',
			properties: {
				city: { type: 'string', description: 'City name' },
				unit: { type: 'string', enum: ['c', 'f'] },
				days: { type: 'integer', minimum: 1, default: 3 },
				tags: { type: 'array', items: { type: 'string' } },
				nested: {
					type: 'object',
					properties: { flag: { type: ['boolean', 'null'] } },
					required: ['flag'],
					additionalProperties: false,
				},
			},
			required: ['city', 'tags', 'nested'],
			additionalProperties: false,
		});
	});

	it('converts Zod 4 schemas instead of emitting an empty schema', () => {
		const json = zodSchemaToJsonSchema(v4Schema) as any;

		expect(json.$schema).toBe('http://json-schema.org/draft-07/schema#');
		expect(json.type).toBe('object');
		expect(json.properties.city).toEqual({
			type: 'string',
			description: 'City name',
		});
		expect(json.properties.unit).toEqual({ type: 'string', enum: ['c', 'f'] });
		expect(json.properties.days).toMatchObject({
			type: 'integer',
			minimum: 1,
			default: 3,
		});
		expect(json.properties.tags).toEqual({
			type: 'array',
			items: { type: 'string' },
		});
		expect(json.properties.nested.properties.flag).toEqual({
			type: ['boolean', 'null'],
		});
		// Optional and defaulted fields are not required of the model.
		expect(json.required).toEqual(['city', 'tags', 'nested']);
	});

	it('inlines reused Zod 4 sub-schemas rather than emitting $ref', () => {
		const point = z4.object({ x: z4.number() });
		const json = zodSchemaToJsonSchema(z4.object({ a: point, b: point }));

		expect(JSON.stringify(json)).not.toContain('$ref');
	});
});

describe.each([
	['Zod 3', v3Schema],
	['Zod 4', v4Schema],
])('tool definitions with %s parameters', (_label, parameters) => {
	const tools = [{ name: 'weather', description: 'Get weather.', parameters }];
	const expectUsable = (schema: any) => {
		expect(schema.type).toBe('object');
		expect(Object.keys(schema.properties)).toEqual([
			'city',
			'unit',
			'days',
			'tags',
			'nested',
		]);
		expect(schema.required).toEqual(['city', 'tags', 'nested']);
	};

	it('maps to OpenAI function tools', () => {
		const [tool] = toOpenAITools(tools) as any[];
		expect(tool.type).toBe('function');
		expect(tool.function.name).toBe('weather');
		expectUsable(tool.function.parameters);
	});

	it('maps to Anthropic tools', () => {
		const [tool] = toAnthropicTools(tools) as any[];
		expectUsable(tool.input_schema);
	});

	it('maps to Ollama tools', () => {
		const [tool] = toOllamaTools(tools) as any[];
		expectUsable(tool.function.parameters);
	});
});

describe('openai zodResponseFormat (real SDK helper)', () => {
	const strict = (z: any) =>
		z.object({ title: z.string(), score: z.number().nullable() });

	it.each([
		['Zod 3', strict(z3)],
		['Zod 4', strict(z4)],
	])('builds a strict json_schema response_format from a %s schema', (_l, schema) => {
		const format = zodResponseFormat(schema, 'structured_output') as any;

		expect(format.type).toBe('json_schema');
		expect(format.json_schema.name).toBe('structured_output');
		expect(format.json_schema.strict).toBe(true);
		expect(format.json_schema.schema.type).toBe('object');
		expect(format.json_schema.schema.required).toEqual(['title', 'score']);
		expect(format.json_schema.schema.additionalProperties).toBe(false);
	});
});
