"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const zod_1 = require("zod");
const extract_json_from_text_1 = require("./extract-json-from-text");
const CASE_GAP_MS = 2000;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function printSection(title) {
    console.log('\n' + '-'.repeat(72));
    console.log(title);
    console.log('-'.repeat(72));
}
/**
 * Runs one assertion and logs how a raw LLM string maps through {@link extractJsonFromText}.
 */
async function runCase(name, description, input, expected) {
    console.log('\n' + '='.repeat(72));
    console.log(`CASE: ${name}`);
    console.log(`What this simulates: ${description}`);
    printSection('Simulated raw LLM response (exact string)');
    console.log(input);
    const got = (0, extract_json_from_text_1.extractJsonFromText)(input);
    printSection('Output of extractJsonFromText (JSON value or null)');
    console.log(got === null ? 'null' : JSON.stringify(got, null, 2));
    printSection('Expected value (test oracle)');
    console.log(expected === null ? 'null' : JSON.stringify(expected, null, 2));
    try {
        strict_1.default.deepEqual(got, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
        console.log('ASSERT: PASSED');
    }
    catch (e) {
        console.error('ASSERT: FAILED');
        throw e;
    }
    console.log(`\n(next case in ${CASE_GAP_MS / 1000}s…)`);
    await sleep(CASE_GAP_MS);
}
async function main() {
    // Bare object — model returns only JSON
    await runCase('bare_object', 'Model returns a single JSON object, nothing else.', '{"x":1,"y":"z"}', { x: 1, y: 'z' });
    // Bare array
    await runCase('bare_array', 'Model returns a JSON array at the root.', '[1,2,3]', [1, 2, 3]);
    await runCase('trimmed_object', 'Valid object with leading/trailing whitespace only.', '  \n{"a": true} \n ', { a: true });
    // Classic “helpful” LLM: chit-chat + JSON + chit-chat (two blobs of text, one JSON)
    await runCase('prose_wrapped_object', 'Model adds natural language before and after the JSON object (common in unconstrained chat).', 'Great here is the response:\n\n{"summary":"hi","sentiment":"positive"}\n\nsome weird string', { summary: 'hi', sentiment: 'positive' });
    await runCase('fence_json', 'Model wraps JSON in a markdown ```json fence.', 'Here you go:\n```json\n{"topic":"t","count":3}\n```\nThanks.', { topic: 't', count: 3 });
    await runCase('fence_JSON_upper', 'Fence label JSON in uppercase.', '```JSON\n{"k": "v"}\n```', { k: 'v' });
    await runCase('fence_plain', 'Fence without json label; inner content is a JSON array.', 'intro\n```\n[10, 20]\n```\noutro', [10, 20]);
    await runCase('bom_prefix', 'UTF-8 BOM before JSON (some editors/proxies prepend this).', '\uFEFF{"b":2}', { b: 2 });
    await runCase('nested_braces_in_string', 'Braces inside JSON string values must not confuse the balanced slice.', 'Text before {"msg": "a{b}c", "arr": "[1]"} trailing', { msg: 'a{b}c', arr: '[1]' });
    await runCase('plain_string', 'Model returns only prose — no extractable JSON.', 'Nice here is the fact: no json here', null);
    await runCase('truncated', 'Looks like JSON started but the response was cut off (invalid).', 'Start {"a":1 ', null);
    await runCase('bad_bracket_mix', 'Malformed bracket mix — not valid JSON.', '{]', null);
    // Two JSON objects in one response, no markdown — extractor picks first complete value
    await runCase('two_objects_no_fence', 'Two adjacent JSON objects in one string (no fences). First object wins.', '{"first":1}{"second":2}', { first: 1 });
    await runCase('two_fences_first_wins', 'Two fenced blocks; first fence contains valid JSON — that value wins.', '```json\n{"a":1}\n```\n```\n{"b":2}\n```', { a: 1 });
    await runCase('two_fences_skip_invalid_first', 'Two fences; first body is not JSON; second fence has valid JSON.', '```\nnot json\n```\n```json\n{"ok":true}\n```', { ok: true });
    await runCase('empty_object', 'Prose plus empty JSON object {}.', 'nothing {}\nelse', {});
    // --- Zod layer (same raw string → extract → safeParse as providers do) ---
    console.log('\n' + '='.repeat(72));
    console.log('CASE: zod_smoke (extract + Zod, like structured providers)');
    console.log('What this simulates: LLM returns prose + JSON; we extract then validate with a Zod schema.');
    const schema = zod_1.z.object({ alpha: zod_1.z.number() });
    const rawLlm = 'Sure! Here is the structured part you asked for:\n\n{"alpha": 42}\n\nHope that helps.';
    printSection('Simulated raw LLM response');
    console.log(rawLlm);
    const extracted = (0, extract_json_from_text_1.extractJsonFromText)(rawLlm);
    printSection('extractJsonFromText output');
    console.log(extracted === null ? 'null' : JSON.stringify(extracted, null, 2));
    const ok = schema.safeParse(extracted);
    printSection('Zod schema.safeParse(extracted)');
    console.log('success:', ok.success);
    if (ok.success) {
        console.log('data:', JSON.stringify(ok.data, null, 2));
    }
    else {
        console.log('error:', ok.error.message);
    }
    strict_1.default.deepEqual(ok.success, true);
    strict_1.default.deepEqual(ok.data, { alpha: 42 });
    console.log('ASSERT: PASSED');
    console.log(`\n(next step in ${CASE_GAP_MS / 1000}s…)`);
    await sleep(CASE_GAP_MS);
    console.log('\n' + '='.repeat(72));
    console.log('CASE: zod_smoke_fail (valid JSON shape but wrong for schema)');
    const rawBad = 'Analysis:\n\n{"alpha": "not a number"}\n\nEnd.';
    printSection('Simulated raw LLM response');
    console.log(rawBad);
    const extractedBad = (0, extract_json_from_text_1.extractJsonFromText)(rawBad);
    printSection('extractJsonFromText output (JSON is syntactically fine)');
    console.log(extractedBad === null ? 'null' : JSON.stringify(extractedBad, null, 2));
    const bad = schema.safeParse(extractedBad);
    printSection('Zod schema.safeParse(extracted)');
    console.log('success:', bad.success);
    if (!bad.success) {
        console.log('(expected) Zod rejected wrong type for alpha');
    }
    strict_1.default.deepEqual(bad.success, false);
    console.log('ASSERT: PASSED');
    console.log(`\n(next step in ${CASE_GAP_MS / 1000}s…)`);
    await sleep(CASE_GAP_MS);
    console.log('\n' + '='.repeat(72));
    console.log('extract-json-from-text.manual-test: ALL CASES PASSED.');
    console.log('='.repeat(72) + '\n');
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=extract-json-from-text.manual-test.js.map