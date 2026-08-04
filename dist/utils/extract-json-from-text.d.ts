/**
 * @fileoverview Best-effort **JSON extraction** from assistant text before Zod validation.
 *
 * ## Problem this module solves
 *
 * Language models often return valid JSON **surrounded by** explanations, markdown code fences,
 * or trailing junk. Plain `JSON.parse(entireMessage)` then fails even though a parseable JSON
 * value is present. Structured chat providers (Ollama raw string, OpenAI/Anthropic fallbacks when
 * native `parsed` fields are missing) call {@link extractJsonFromText} first, then run
 * `schema.safeParse` on the result.
 *
 * ## What this module does *not* do
 *
 * - It does **not** validate against your Zod schema (callers use `safeParse`).
 * - It does **not** guarantee uniqueness if the model emits **multiple** JSON blobs; resolution
 *   order is documented on {@link extractJsonFromText}.
 * - It never throws; failures surface as `null` for callers to turn into `APIError` if needed.
 */
/**
 * Returns the **first** JSON value found in LLM assistant `input`, or `null`.
 *
 * ## Resolution order (first success wins)
 *
 * 1. **Trim** input, strip a leading **BOM**, then **whole-string** `JSON.parse` (fast path when
 *    the model returns clean JSON only).
 * 2. **Each fenced block** in source order (` ``` ` / ` ```json `, case-insensitive `json`):
 *    trim the inner body, BOM-strip, then {@link tryWholeOrBalanced} on that body. The **first**
 *    fence whose body yields valid JSON wins — so an invalid first fence does not block a valid
 *    second fence.
 * 3. **Balanced scan** on the full trimmed string: {@link tryWholeOrBalanced} (first `{`/`[` that
 *    produces a valid JSON document wins among non-fenced strategies).
 *
 * ## Typical call flow
 *
 * ```ts
 * const value = extractJsonFromText(rawAssistantString);
 * const result = myZodSchema.safeParse(value);
 * if (!result.success) {
 *   // map to APIError
 * }
 * ```
 *
 * @param input - Raw assistant message content (may include prose, fences, trailing text).
 * @returns Parsed JSON as `unknown`, or `null` if no strategy produced valid JSON.
 *
 * @example
 * Clean JSON only:
 * ```ts
 * extractJsonFromText('{"topic":"cats","count":3}');
 * // { topic: 'cats', count: 3 }
 * ```
 *
 * @example
 * Prose before and after a single object (common “helpful” model pattern):
 * ```ts
 * extractJsonFromText(
 *   'Great here is the response:\n\n{"summary":"hi","sentiment":"positive"}\n\nThanks!'
 * );
 * // { summary: 'hi', sentiment: 'positive' }
 * ```
 *
 * @example
 * Markdown `json` fence:
 * ```ts
 * extractJsonFromText(
 *   'Result:\n```JSON\n{"ok":true}\n```\nDone.'
 * );
 * // { ok: true }
 * ```
 *
 * @example
 * Root array (not wrapped in an object):
 * ```ts
 * extractJsonFromText('Values:\n```\n[1, 2, 3]\n```');
 * // [1, 2, 3]
 * ```
 *
 * @example
 * No JSON to extract:
 * ```ts
 * extractJsonFromText('Nice here is the fact: there is no structured payload.');
 * // null
 * ```
 *
 * @example
 * Two adjacent objects without fences — **first** valid object wins:
 * ```ts
 * extractJsonFromText('{"first":1}{"second":2}');
 * // { first: 1 }
 * ```
 */
export declare function extractJsonFromText(input: string): unknown | null;
//# sourceMappingURL=extract-json-from-text.d.ts.map