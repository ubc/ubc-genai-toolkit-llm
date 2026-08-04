/**
 * Manual regression checks for {@link extractJsonFromText} (no Jest / Vitest).
 *
 * Each case prints:
 * - A simulated **raw LLM response** (exact string, as the model might return it).
 * - The result of **extractJsonFromText** (pretty-printed JSON, or `null`).
 * - The **expected** value for the assertion.
 *
 * There is a **2 second pause** after each case so you can read the console when running locally.
 *
 * ## Run
 *
 * From the repository root (requires network once for `npx` to fetch `tsx` if missing):
 *
 * ```bash
 * npm run test:extract-json
 * ```
 *
 * Or directly:
 *
 * ```bash
 * npx --yes tsx src/utils/extract-json-from-text.manual-test.ts
 * ```
 *
 * Exit code `0` means all assertions passed; non-zero means failure.
 */
export {};
//# sourceMappingURL=extract-json-from-text.manual-test.d.ts.map