/**
 * @fileoverview Zod → JSON Schema conversion shared by every provider.
 *
 * The toolkit depends on Zod 4, but callers hand it schemas built with *their*
 * copy of Zod, which may be Zod 4 or Zod 3 (including `zod/v3`). The two
 * generations have different internals, so each needs its own converter:
 *
 * - **Zod 3** schemas go through `zod-to-json-schema`, exactly as in 0.7.x, so
 *   the emitted JSON Schema is unchanged for existing callers.
 * - **Zod 4** schemas go through Zod's own `z.toJSONSchema`.
 *   `zod-to-json-schema` does not understand them and silently returns an empty
 *   schema.
 *
 * Both produce inline draft-07 JSON Schema with no `$ref` indirection, for
 * maximum server compatibility.
 */

import { toJSONSchema } from 'zod';
import type { ZodType as Zod4Type } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** True for schemas built with Zod 4 (they carry the `_zod` internals marker). */
export function isZod4Schema(schema: unknown): boolean {
	return (
		(typeof schema === 'object' || typeof schema === 'function') &&
		schema !== null &&
		'_zod' in schema
	);
}

/**
 * Converts a caller-supplied Zod schema (Zod 3 or Zod 4) to inline draft-07
 * JSON Schema.
 */
export function zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> {
	if (isZod4Schema(schema)) {
		return toJSONSchema(schema as Zod4Type, {
			target: 'draft-7',
			// Describe what the model must *write* (tool arguments, or JSON that
			// is then parsed by the schema): fields with defaults stay optional,
			// matching what zod-to-json-schema emits for Zod 3 schemas.
			io: 'input',
			// Inline reused sub-schemas instead of emitting `$ref`s.
			reused: 'inline',
		}) as Record<string, unknown>;
	}
	// Cast breaks TS "excessively deep" instantiation on some zod versions; runtime shape is still a valid JSON Schema object.
	return zodToJsonSchema(schema as never, {
		target: 'jsonSchema7',
		$refStrategy: 'none',
	}) as Record<string, unknown>;
}
