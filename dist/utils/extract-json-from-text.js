"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractJsonFromText = extractJsonFromText;
const UTF8_BOM = '\uFEFF';
/**
 * Matches GitHub-style fenced code blocks. Group 2 is the inner body.
 *
 * - Opening fence: three backticks, optional `json` label (case-insensitive), optional whitespace/newline.
 * - Closing fence: three backticks.
 *
 * **Problem solved:** models habitually wrap JSON in ` ```json ... ``` ` even when the rest of
 * the message is prose; we peel the fence and parse the interior.
 */
const FENCE_RE = /```(json)?\s*\r?\n?([\s\S]*?)```/gi;
/**
 * Removes a leading Unicode BOM (byte order mark) so `JSON.parse` sees a clean `{` or `[`.
 *
 * **Problem solved:** some tools or copy/paste prefixes produce `\uFEFF{"a":1}` which would
 * otherwise make a strict whole-string parse fail.
 *
 * @param s - Raw substring (often already trimmed at the call site for the main pipeline).
 * @returns `s` without a single leading BOM code unit, or `s` unchanged.
 *
 * @example
 * ```ts
 * stripBom('\uFEFF{"x":1}'); // '{"x":1}'
 * stripBom('{"x":1}');       // '{"x":1}'
 * ```
 */
function stripBom(s) {
    if (s.charCodeAt(0) === 0xfeff || s.startsWith(UTF8_BOM)) {
        return s.slice(1);
    }
    return s;
}
/**
 * Trims `slice`, then runs `JSON.parse` once. Used as the final step after we have isolated a
 * candidate substring (whole message, fence body, or balanced slice).
 *
 * **Problem solved:** centralize “trim + parse + swallow SyntaxError” so every strategy shares
 * the same failure semantics (`null` means “not valid JSON here”).
 *
 * @param slice - Candidate JSON text.
 * @returns The parsed value, or `null` if empty after trim or `JSON.parse` throws.
 *
 * @example
 * ```ts
 * tryJsonParseSlice('  {"a": true}  '); // { a: true }
 * tryJsonParseSlice('not json');       // null
 * ```
 */
function tryJsonParseSlice(slice) {
    const t = slice.trim();
    if (!t)
        return null;
    try {
        return JSON.parse(t);
    }
    catch {
        return null;
    }
}
/**
 * Finds the **shortest well-formed** top-level JSON **object** `{...}` or **array** `[...]`
 * starting exactly at index `start` (which must be `{` or `[`).
 *
 * **Problem solved:** given `Here is {"msg": "brace: }"}` we must not treat the `}` inside the
 * string as closing the object. This walker tracks string mode, backslash escapes, and a stack
 * of `{` / `[` so depth only changes outside quoted strings.
 *
 * **Limitation:** if the substring from `start` is syntactically invalid (e.g. `{]`), returns
 * `null` once the stack detects a mismatch.
 *
 * @param s - Full assistant text (or a fence body).
 * @param start - Index in `s` where `{` or `[` begins.
 * @returns The exact substring from `start` through the matching closing bracket, or `null`.
 *
 * @example
 * ```ts
 * const s = 'prefix {"k": "a{b}c"} suffix';
 * const i = s.indexOf('{');
 * extractBalancedJsonSlice(s, i); // '{"k": "a{b}c"}'
 * ```
 *
 * @example
 * ```ts
 * extractBalancedJsonSlice('[1, [2, 3]]', 0); // '[1, [2, 3]]'
 * ```
 */
function extractBalancedJsonSlice(s, start) {
    const open = s[start];
    if (open !== '{' && open !== '[')
        return null;
    const stack = [open];
    let inString = false;
    let escape = false;
    for (let i = start + 1; i < s.length; i++) {
        const c = s[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (inString) {
            if (c === '\\') {
                escape = true;
            }
            else if (c === '"') {
                inString = false;
            }
            continue;
        }
        if (c === '"') {
            inString = true;
            continue;
        }
        if (c === '{') {
            stack.push('{');
            continue;
        }
        if (c === '[') {
            stack.push('[');
            continue;
        }
        if (c === '}') {
            if (stack.length === 0 || stack[stack.length - 1] !== '{') {
                return null;
            }
            stack.pop();
            if (stack.length === 0) {
                return s.slice(start, i + 1);
            }
            continue;
        }
        if (c === ']') {
            if (stack.length === 0 || stack[stack.length - 1] !== '[') {
                return null;
            }
            stack.pop();
            if (stack.length === 0) {
                return s.slice(start, i + 1);
            }
            continue;
        }
    }
    return null;
}
/**
 * Parses `text` as a whole JSON value, **or** scans left-to-right for each `{` / `[`, slices a
 * balanced value with {@link extractBalancedJsonSlice}, and returns the **first** slice that
 * `JSON.parse` accepts.
 *
 * **Problem solved:** message is `Sure: {"a":1} thanks` — whole-string parse fails, but the
 * first balanced object starting at `{` succeeds.
 *
 * **Problem *not* solved here:** choosing between two separate top-level objects in unfenced text;
 * the **first** successful parse wins (see {@link extractJsonFromText} for fence vs prose order).
 *
 * @param text - Arbitrary text possibly containing one embedded JSON value.
 * @returns Parsed `unknown`, or `null`.
 *
 * @example
 * ```ts
 * tryWholeOrBalanced('intro {"x": 1} outro'); // { x: 1 }
 * tryWholeOrBalanced('[1,2]');                // [1, 2]
 * tryWholeOrBalanced('no braces');           // null
 * ```
 */
function tryWholeOrBalanced(text) {
    const whole = tryJsonParseSlice(text);
    if (whole !== null)
        return whole;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c !== '{' && c !== '[')
            continue;
        const slice = extractBalancedJsonSlice(text, i);
        if (!slice)
            continue;
        const parsed = tryJsonParseSlice(slice);
        if (parsed !== null)
            return parsed;
    }
    return null;
}
/**
 * Collects every markdown fenced body in document order (see `FENCE_RE` in this file).
 *
 * **Problem solved:** a single message may contain zero, one, or several ``` blocks; downstream
 * logic can try each body until one yields JSON (see {@link extractJsonFromText}).
 *
 * @param text - Full assistant message.
 * @returns Array of inner fence strings (may include whitespace-only entries).
 *
 * @example
 * ```ts
 * collectFencedBodies('```json\n{"a":1}\n```');
 * // ['{"a":1}\n']
 * ```
 */
function collectFencedBodies(text) {
    const bodies = [];
    FENCE_RE.lastIndex = 0;
    let m;
    while ((m = FENCE_RE.exec(text)) !== null) {
        bodies.push(m[2]);
    }
    return bodies;
}
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
function extractJsonFromText(input) {
    const t = stripBom(input.trim());
    if (!t)
        return null;
    const direct = tryJsonParseSlice(t);
    if (direct !== null)
        return direct;
    for (const body of collectFencedBodies(t)) {
        const inner = stripBom(body.trim());
        if (!inner)
            continue;
        const fromFence = tryWholeOrBalanced(inner);
        if (fromFence !== null)
            return fromFence;
    }
    return tryWholeOrBalanced(t);
}
//# sourceMappingURL=extract-json-from-text.js.map