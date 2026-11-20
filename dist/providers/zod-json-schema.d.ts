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
/** True for schemas built with Zod 4 (they carry the `_zod` internals marker). */
export declare function isZod4Schema(schema: unknown): boolean;
/**
 * Converts a caller-supplied Zod schema (Zod 3 or Zod 4) to inline draft-07
 * JSON Schema.
 */
export declare function zodSchemaToJsonSchema(schema: unknown): Record<string, unknown>;
//# sourceMappingURL=zod-json-schema.d.ts.map