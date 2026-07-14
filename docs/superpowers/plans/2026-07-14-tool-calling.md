# LLM Module Tool-Calling (0.4.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral tool/function-calling to `ubc-genai-toolkit-llm` (all four providers), purely additively, releasing as 0.4.0 — the foundation for the upcoming agents module.

**Architecture:** New types (`ToolDefinition`, `ToolCall`, widened `Message` role, `tools`/`toolChoice` on `LLMOptions`, `toolCalls`/`stopReason` on `LLMResponse`) plus per-provider pure mapping modules (`openai-compat-mapping.ts`, `anthropic-mapping.ts`, `ollama-mapping.ts`) that translate the neutral shapes to each SDK's native tool-calling format. Providers gain thin glue that calls the mappings. Pure mappings are unit-tested with vitest (new to this package); provider glue is tested with `vi.mock`-ed SDK clients. Streaming accumulates tool-call deltas and surfaces them only on the final `LLMResponse`.

**Tech Stack:** TypeScript 5.8 (CommonJS, `tsc -b`), zod + zod-to-json-schema (existing deps), openai ^4.89, @anthropic-ai/sdk ^0.95, ollama ^0.5.14, vitest (new devDependency).

**Spec:** `../../../ubc-genai-toolkit-agents/docs/superpowers/specs/2026-07-14-agents-module-design.md` (§2 is this phase).

## Global Constraints

- **Backwards compatibility is absolute.** Every change is additive. Existing call sites must compile and behave identically. Never remove/rename an exported symbol, field, or narrow an existing type.
- Package: `ubc-genai-toolkit-llm`, version becomes exactly `0.4.0` (Task 10; do not bump earlier).
- Indentation: **tabs** (match every existing file in this repo).
- Tests live in `test/` at the package root (NOT `src/` — `tsconfig.json` includes `src/**/*` and tests must not be compiled into `dist/`).
- Errors: use `APIError` / `ConfigurationError` from `ubc-genai-toolkit-core` — never bare `Error`.
- All code gets TSDoc comments in the style of the surrounding file; file-header `@fileoverview` comments on new files.
- Working directory for all commands: `/Users/rich/Developer/ubc-genai-toolkit/ubc-genai-toolkit-llm` unless stated.
- `stopReason` vocabulary (used by every provider): `'stop' | 'tool_calls' | 'length' | 'other'`.
- Tool-result messages missing `toolCallId` (where the provider needs it) throw `APIError` with status 400 — fail loudly, never silently drop.
- `sendStructuredConversation` with `options.tools` set throws `APIError` 400 (tools + structured output are mutually exclusive in 0.4.0).

---

### Task 1: Test infrastructure + core tool-calling types

**Files:**
- Modify: `package.json` (add vitest devDependency + `test` script)
- Modify: `src/types.ts` (new types; widen `Message`, `LLMOptions`, `LLMResponse`)
- Test: `test/types.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks rely on these exact names):

```ts
export type StopReason = 'stop' | 'tool_calls' | 'length' | 'other';

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: ZodType;
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

// Message additions:
//   role: 'user' | 'assistant' | 'system' | 'tool'
//   toolCalls?: ToolCall[]
//   toolCallId?: string
// LLMOptions additions:
//   tools?: ToolDefinition[]
//   toolChoice?: 'auto' | 'required' | 'none'
// LLMResponse additions:
//   toolCalls?: ToolCall[]
//   stopReason?: StopReason
```

- [ ] **Step 1: Install vitest and add the test script**

Run: `npm install --save-dev vitest`

Then in `package.json` add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 2: Write the failing test**

Create `test/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type {
	Message,
	ToolDefinition,
	ToolCall,
	LLMOptions,
	LLMResponse,
	StopReason,
} from '../src/types';

describe('tool-calling types', () => {
	it('allows a tool-role message carrying a toolCallId', () => {
		const msg: Message = {
			role: 'tool',
			content: '127.05',
			toolCallId: 'call_abc',
		};
		expect(msg.role).toBe('tool');
	});

	it('allows an assistant message carrying toolCalls', () => {
		const call: ToolCall = {
			id: 'call_abc',
			name: 'calculator',
			arguments: { expression: '847 * 0.15' },
		};
		const msg: Message = { role: 'assistant', content: '', toolCalls: [call] };
		expect(msg.toolCalls).toHaveLength(1);
	});

	it('allows tools and toolChoice on LLMOptions and toolCalls/stopReason on LLMResponse', () => {
		const tool: ToolDefinition = {
			name: 'calculator',
			description: 'Evaluate an arithmetic expression.',
			parameters: z.object({ expression: z.string() }),
		};
		const options: LLMOptions = { tools: [tool], toolChoice: 'auto' };
		const stop: StopReason = 'tool_calls';
		const response: LLMResponse = {
			content: '',
			model: 'test',
			toolCalls: [{ id: 'x', name: 'calculator', arguments: {} }],
			stopReason: stop,
		};
		expect(options.tools).toHaveLength(1);
		expect(response.stopReason).toBe('tool_calls');
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/types.test.ts`
Expected: FAIL — TypeScript errors: `Module '"../src/types"' has no exported member 'ToolDefinition'` (and similar).

- [ ] **Step 4: Implement the types**

In `src/types.ts`:

(a) Add at the top, below the existing `import { ModuleConfig } ...` line:

```ts
import type { ZodType } from 'zod';
```

(b) Add these new declarations immediately after the `LLMConfig` interface:

```ts
/**
 * Why generation ended, normalized across providers.
 *
 * - `stop` — the model finished naturally.
 * - `tool_calls` — the model is requesting one or more tool invocations
 *   (see {@link LLMResponse.toolCalls}); the caller should execute them and
 *   send the results back as `role: 'tool'` messages.
 * - `length` — the token limit was hit; output may be truncated.
 * - `other` — any provider-specific reason not covered above (details are
 *   usually preserved in `LLMResponse.metadata`).
 */
export type StopReason = 'stop' | 'tool_calls' | 'length' | 'other';

/**
 * A tool the model may call, in provider-neutral form.
 *
 * Each provider converts `parameters` (a Zod schema) to JSON Schema via
 * `zod-to-json-schema` and translates the definition into its native
 * function-calling format. The `description` is shown to the model and is
 * the primary signal for when the tool gets called — write it carefully.
 */
export interface ToolDefinition {
	/** Unique tool name, e.g. `'calculator'`. */
	name: string;

	/** What the tool does and when to use it — shown to the model. */
	description: string;

	/** Zod schema describing the tool's arguments (typically `z.object({...})`). */
	parameters: ZodType;
}

/**
 * A tool invocation requested by the model.
 *
 * Appears on assistant messages ({@link Message.toolCalls}) and on
 * {@link LLMResponse.toolCalls}. The caller executes the named tool with
 * `arguments` and reports the outcome in a `role: 'tool'` message whose
 * {@link Message.toolCallId} equals this call's `id`.
 */
export interface ToolCall {
	/**
	 * Identifier linking this request to its result message. Provider-assigned
	 * where available (OpenAI, Anthropic); synthesized for providers without
	 * ids (Ollama).
	 */
	id: string;

	/** Name of the tool being called. */
	name: string;

	/** Parsed JSON arguments for the call. */
	arguments: Record<string, unknown>;
}
```

(c) In the `Message` interface, widen `role` and add the two optional fields (keep every existing field and comment untouched):

```ts
	/**
	 * The role of the message sender.
	 *
	 * `'tool'` carries the result of a tool invocation back to the model: it is
	 * the application reporting a tool's output, not a user or assistant
	 * utterance. Tool messages must set {@link toolCallId}. Existing code that
	 * never uses tools never sees this role.
	 */
	role: 'user' | 'assistant' | 'system' | 'tool';
```

and after the `images` field:

```ts
	/**
	 * Tool invocations requested by the model. Present only on `assistant`
	 * messages replayed into history during a tool-calling loop (the message's
	 * `content` may be an empty string in that case).
	 */
	toolCalls?: ToolCall[];

	/**
	 * For `role: 'tool'` messages: the {@link ToolCall.id} this result answers.
	 */
	toolCallId?: string;
```

(d) In `LLMOptions`, add before the `[key: string]: any;` index signature:

```ts
	/**
	 * Tools the model may call. When present, providers translate these into
	 * their native function-calling format. Responses may then carry
	 * {@link LLMResponse.toolCalls}.
	 */
	tools?: ToolDefinition[];

	/**
	 * How eagerly the model should call tools. `'auto'` (default) lets the
	 * model decide, `'required'` forces at least one call, `'none'` disables
	 * calling. Providers without a native equivalent ignore this and log a
	 * debug message.
	 */
	toolChoice?: 'auto' | 'required' | 'none';
```

(e) In `LLMResponse`, add after the `content` field:

```ts
	/**
	 * Tool invocations requested by the model, if any. When set, the caller
	 * should execute each tool and send the results back as `role: 'tool'`
	 * messages, then call the LLM again.
	 */
	toolCalls?: ToolCall[];

	/** Why generation ended, normalized across providers. */
	stopReason?: StopReason;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Verify the package still builds (backwards compat)**

Run: `npm run build`
Expected: exits 0, no TypeScript errors. (The widened `Message.role` is consumed with `msg.role !== 'system'` filters and `role` passthroughs in providers, which still compile; if any provider file errors here, STOP — do not fix providers in this task; the error means the type change was not purely additive. Re-check step 4.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/types.ts test/types.test.ts
git commit -m "feat: add tool-calling types and vitest test infrastructure"
```

**Note (no action):** `ConversationFactory`, `Conversation`, `ConversationImpl`, and `LLMModule` need **no signature changes** — `tools`/`toolChoice` ride on `LLMOptions` and `toolCalls`/`stopReason` on `LLMResponse`/`Message`, so every existing signature is already tool-aware. `Conversation.addMessage`'s narrow role union stays as-is (widening it is not needed for this phase and is deferred). Do not modify those files.

---

### Task 2: Shared OpenAI-compatible mapping module

The OpenAI and UBC LLM Sandbox providers currently duplicate `toOpenAIContent` and `separateOpenAIOptions`. This task creates one shared, pure, unit-testable mapping module both will use, including the new tool mappings. (Provider files are not modified until Tasks 3–4.)

**Files:**
- Create: `src/providers/openai-compat-mapping.ts`
- Test: `test/openai-compat-mapping.test.ts`

**Interfaces:**
- Consumes: `Message`, `ToolDefinition`, `ToolCall`, `StopReason`, `LLMOptions` from `../types` (Task 1); `APIError` from `ubc-genai-toolkit-core`; `zodToJsonSchema` from `zod-to-json-schema` (existing dep); OpenAI SDK types.
- Produces (Tasks 3–4 import these exact names):

```ts
export function separateOpenAIOptions(options?: LLMOptions): { known: ...; rest: Record<string, any> };
export function toOpenAIContent(msg: Message): string | OpenAI.Chat.Completions.ChatCompletionContentPart[];
export function toOpenAIMessages(messages: Message[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[];
export function toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[];
export function fromOpenAIToolCalls(message: { tool_calls?: ... } | undefined): ToolCall[] | undefined;
export function mapOpenAIFinishReason(reason: string | null | undefined): StopReason | undefined;
```

- [ ] **Step 1: Write the failing tests**

Create `test/openai-compat-mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
	separateOpenAIOptions,
	toOpenAIMessages,
	toOpenAITools,
	fromOpenAIToolCalls,
	mapOpenAIFinishReason,
} from '../src/providers/openai-compat-mapping';
import type { Message } from '../src/types';

describe('separateOpenAIOptions', () => {
	it('strips toolkit-managed fields (including tools/toolChoice) out of rest', () => {
		const { rest } = separateOpenAIOptions({
			model: 'gpt-4o',
			temperature: 0.5,
			tools: [
				{ name: 't', description: 'd', parameters: z.object({}) },
			],
			toolChoice: 'auto',
			custom_param: 42,
		});
		expect(rest).toEqual({ custom_param: 42 });
	});
});

describe('toOpenAIMessages', () => {
	it('maps an assistant message with toolCalls to tool_calls with stringified arguments', () => {
		const messages: Message[] = [
			{ role: 'user', content: 'What is 15% of 847?' },
			{
				role: 'assistant',
				content: '',
				toolCalls: [
					{ id: 'call_1', name: 'calculator', arguments: { expression: '847*0.15' } },
				],
			},
		];
		const out = toOpenAIMessages(messages);
		expect(out[1]).toEqual({
			role: 'assistant',
			content: null,
			tool_calls: [
				{
					id: 'call_1',
					type: 'function',
					function: { name: 'calculator', arguments: '{"expression":"847*0.15"}' },
				},
			],
		});
	});

	it('maps a tool message to role tool with tool_call_id', () => {
		const out = toOpenAIMessages([
			{ role: 'tool', content: '127.05', toolCallId: 'call_1' },
		]);
		expect(out[0]).toEqual({
			role: 'tool',
			tool_call_id: 'call_1',
			content: '127.05',
		});
	});

	it('throws APIError 400 when a tool message is missing toolCallId', () => {
		expect(() =>
			toOpenAIMessages([{ role: 'tool', content: 'x' }])
		).toThrowError(/toolCallId/);
	});

	it('leaves plain user/system messages unchanged', () => {
		const out = toOpenAIMessages([
			{ role: 'system', content: 'be nice' },
			{ role: 'user', content: 'hi' },
		]);
		expect(out).toEqual([
			{ role: 'system', content: 'be nice' },
			{ role: 'user', content: 'hi' },
		]);
	});
});

describe('toOpenAITools', () => {
	it('converts a Zod schema into a function tool with JSON Schema parameters', () => {
		const tools = toOpenAITools([
			{
				name: 'calculator',
				description: 'Evaluate arithmetic.',
				parameters: z.object({ expression: z.string() }),
			},
		]);
		expect(tools[0].type).toBe('function');
		expect(tools[0].function.name).toBe('calculator');
		expect(tools[0].function.description).toBe('Evaluate arithmetic.');
		const params = tools[0].function.parameters as Record<string, any>;
		expect(params.type).toBe('object');
		expect(params.properties.expression.type).toBe('string');
	});
});

describe('fromOpenAIToolCalls', () => {
	it('parses tool_calls JSON arguments into ToolCall objects', () => {
		const calls = fromOpenAIToolCalls({
			tool_calls: [
				{
					id: 'call_1',
					type: 'function',
					function: { name: 'calculator', arguments: '{"expression":"1+1"}' },
				},
			],
		});
		expect(calls).toEqual([
			{ id: 'call_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
	});

	it('returns undefined when there are no tool calls', () => {
		expect(fromOpenAIToolCalls({})).toBeUndefined();
		expect(fromOpenAIToolCalls(undefined)).toBeUndefined();
	});

	it('throws APIError when arguments are not valid JSON', () => {
		expect(() =>
			fromOpenAIToolCalls({
				tool_calls: [
					{ id: 'x', type: 'function', function: { name: 'f', arguments: '{oops' } },
				],
			})
		).toThrowError(/JSON/);
	});
});

describe('mapOpenAIFinishReason', () => {
	it('maps finish reasons to normalized StopReason', () => {
		expect(mapOpenAIFinishReason('stop')).toBe('stop');
		expect(mapOpenAIFinishReason('tool_calls')).toBe('tool_calls');
		expect(mapOpenAIFinishReason('function_call')).toBe('tool_calls');
		expect(mapOpenAIFinishReason('length')).toBe('length');
		expect(mapOpenAIFinishReason('content_filter')).toBe('other');
		expect(mapOpenAIFinishReason(null)).toBeUndefined();
		expect(mapOpenAIFinishReason(undefined)).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/openai-compat-mapping.test.ts`
Expected: FAIL — cannot resolve `../src/providers/openai-compat-mapping`.

- [ ] **Step 3: Implement the module**

Create `src/providers/openai-compat-mapping.ts`:

```ts
/**
 * @fileoverview Pure mapping helpers shared by the OpenAI-compatible providers
 * ({@link OpenAIProvider} and {@link UbcLlmSandboxProvider}).
 *
 * Everything here is a pure function (no client, no network) so the
 * toolkit-neutral ⇄ OpenAI wire-format translation — including tool calling —
 * can be unit-tested without mocking an SDK.
 */

import OpenAI from 'openai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { APIError } from 'ubc-genai-toolkit-core';
import {
	LLMOptions,
	Message,
	StopReason,
	ToolCall,
	ToolDefinition,
} from '../types';

/**
 * Splits {@link LLMOptions} into fields the toolkit sets explicitly on each
 * request vs. passthrough `rest`.
 *
 * `rest` is spread into the SDK call so callers can pass supported OpenAI
 * parameters not modeled on `LLMOptions`, without colliding with
 * toolkit-managed keys. `tools` and `toolChoice` are toolkit-managed (they are
 * translated, not forwarded raw) so they are stripped here too.
 */
export function separateOpenAIOptions(options: LLMOptions = {}) {
	const {
		model,
		temperature,
		maxTokens,
		systemPrompt,
		responseFormat,
		stream,
		tools,
		toolChoice,
		// Rename so it is not forwarded in `rest`; only structured calls need the name.
		structuredOutputName: _structuredOutputName,
		...rest
	} = options as LLMOptions & { structuredOutputName?: string };

	const known = {
		model,
		temperature,
		maxTokens,
		systemPrompt,
		responseFormat,
		stream,
		tools,
		toolChoice,
		structuredOutputName: _structuredOutputName,
	};

	return { known, rest };
}

/**
 * Message content for the OpenAI SDK: a plain string, or a multi-part array
 * (text + base64 `image_url` parts) when the message carries images.
 */
export function toOpenAIContent(
	msg: Message
): string | OpenAI.Chat.Completions.ChatCompletionContentPart[] {
	if (!msg.images || msg.images.length === 0) {
		return msg.content;
	}
	const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
	if (msg.content) {
		parts.push({ type: 'text', text: msg.content });
	}
	for (const image of msg.images) {
		parts.push({
			type: 'image_url',
			image_url: { url: `data:${image.mimeType};base64,${image.data}` },
		});
	}
	return parts;
}

/**
 * Maps toolkit messages to OpenAI chat messages, including the tool-calling
 * shapes: assistant messages carrying {@link Message.toolCalls} become
 * `tool_calls` entries (arguments re-serialized to JSON strings), and
 * `role: 'tool'` messages become `role: 'tool'` + `tool_call_id`.
 *
 * @throws {APIError} 400 when a `role: 'tool'` message has no `toolCallId` —
 * OpenAI cannot associate the result with its request, so failing loudly here
 * beats a confusing provider-side 400.
 */
export function toOpenAIMessages(
	messages: Message[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
	return messages.map((msg): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
		if (msg.role === 'tool') {
			if (!msg.toolCallId) {
				throw new APIError(
					"Tool-result message is missing 'toolCallId'; it must reference the ToolCall.id it answers.",
					400
				);
			}
			return {
				role: 'tool',
				tool_call_id: msg.toolCallId,
				content: msg.content,
			};
		}
		if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
			return {
				role: 'assistant',
				// OpenAI expects null (not '') when an assistant turn is tool-calls-only.
				content: msg.content || null,
				tool_calls: msg.toolCalls.map((call) => ({
					id: call.id,
					type: 'function' as const,
					function: {
						name: call.name,
						arguments: JSON.stringify(call.arguments),
					},
				})),
			};
		}
		return {
			role: msg.role,
			content: toOpenAIContent(msg),
		} as OpenAI.Chat.Completions.ChatCompletionMessageParam;
	});
}

/**
 * Converts toolkit tool definitions to OpenAI `function` tools. Zod schemas
 * become inline JSON Schema (no `$ref` indirection — maximum server
 * compatibility, matching the Ollama structured-output path).
 */
export function toOpenAITools(
	tools: ToolDefinition[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
	return tools.map((tool) => ({
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: zodToJsonSchema(tool.parameters as never, {
				target: 'jsonSchema7',
				$refStrategy: 'none',
			}) as Record<string, unknown>,
		},
	}));
}

/** Minimal structural type: the slice of an OpenAI assistant message we read tool calls from. */
interface OpenAIToolCallCarrier {
	tool_calls?: Array<{
		id: string;
		type: string;
		function: { name: string; arguments: string };
	}>;
}

/**
 * Extracts normalized {@link ToolCall}s from an OpenAI assistant message.
 * Returns `undefined` (not `[]`) when there are none, so `LLMResponse.toolCalls`
 * stays absent for plain text responses.
 *
 * @throws {APIError} 502 when the model emitted syntactically invalid JSON
 * arguments — callers cannot execute a tool with unparseable input.
 */
export function fromOpenAIToolCalls(
	message: OpenAIToolCallCarrier | undefined
): ToolCall[] | undefined {
	const toolCalls = message?.tool_calls;
	if (!toolCalls || toolCalls.length === 0) {
		return undefined;
	}
	return toolCalls.map((call) => {
		let args: Record<string, unknown>;
		try {
			args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
		} catch {
			throw new APIError(
				`Model returned invalid JSON arguments for tool '${call.function.name}'.`,
				502,
				{ tool: call.function.name, raw: call.function.arguments.slice(0, 200) }
			);
		}
		return { id: call.id, name: call.function.name, arguments: args };
	});
}

/**
 * Normalizes OpenAI `finish_reason` into the toolkit {@link StopReason}.
 * Unknown reasons map to `'other'`; absent reasons map to `undefined`.
 */
export function mapOpenAIFinishReason(
	reason: string | null | undefined
): StopReason | undefined {
	if (reason == null) return undefined;
	switch (reason) {
		case 'stop':
			return 'stop';
		case 'tool_calls':
		case 'function_call':
			return 'tool_calls';
		case 'length':
			return 'length';
		default:
			return 'other';
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/openai-compat-mapping.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/openai-compat-mapping.ts test/openai-compat-mapping.test.ts
git commit -m "feat: add shared OpenAI-compatible tool-calling mapping module"
```

---

### Task 3: OpenAI provider tool support

**Files:**
- Modify: `src/providers/openai-provider.ts`
- Test: `test/openai-provider.test.ts`

**Interfaces:**
- Consumes: everything exported by `./openai-compat-mapping` (Task 2); types from Task 1.
- Produces: `OpenAIProvider.sendConversation` accepts `options.tools`/`options.toolChoice` and returns `toolCalls`/`stopReason` on `LLMResponse`; `streamConversation` accumulates tool-call deltas into the final response; `sendStructuredConversation` rejects `options.tools` with `APIError` 400. No public signature changes.

- [ ] **Step 1: Write the failing tests (mocked SDK)**

Create `test/openai-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { NoopLogger } from 'ubc-genai-toolkit-core';
import type { Message } from '../src/types';

const createMock = vi.fn();

vi.mock('openai', () => {
	class MockAPIError extends Error {
		status = 500;
	}
	class MockOpenAI {
		static APIError = MockAPIError;
		chat = { completions: { create: createMock } };
		beta = { chat: { completions: { parse: vi.fn() } } };
		models = { list: vi.fn() };
		embeddings = { create: vi.fn() };
	}
	return { default: MockOpenAI };
});

vi.mock('openai/helpers/zod', () => ({
	zodResponseFormat: vi.fn(() => ({ type: 'json_schema' })),
}));

import { OpenAIProvider } from '../src/providers/openai-provider';

function makeProvider() {
	return new OpenAIProvider('sk-test', 'gpt-4o', new NoopLogger());
}

const calculator = {
	name: 'calculator',
	description: 'Evaluate arithmetic.',
	parameters: z.object({ expression: z.string() }),
};

beforeEach(() => {
	createMock.mockReset();
});

describe('OpenAIProvider tool calling', () => {
	it('passes translated tools and tool_choice to the SDK and normalizes toolCalls/stopReason', async () => {
		createMock.mockResolvedValue({
			id: 'chatcmpl-1',
			created: 1,
			model: 'gpt-4o',
			choices: [
				{
					finish_reason: 'tool_calls',
					message: {
						role: 'assistant',
						content: null,
						tool_calls: [
							{
								id: 'call_1',
								type: 'function',
								function: { name: 'calculator', arguments: '{"expression":"1+1"}' },
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		});

		const provider = makeProvider();
		const response = await provider.sendConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			{ tools: [calculator], toolChoice: 'auto' }
		);

		const params = createMock.mock.calls[0][0];
		expect(params.tools[0].function.name).toBe('calculator');
		expect(params.tool_choice).toBe('auto');
		// tools/toolChoice must NOT leak through `rest` as raw toolkit objects
		expect(params.toolChoice).toBeUndefined();

		expect(response.toolCalls).toEqual([
			{ id: 'call_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
		expect(response.content).toBe('');
	});

	it('sends tool-result messages in OpenAI format', async () => {
		createMock.mockResolvedValue({
			id: 'chatcmpl-2',
			created: 1,
			model: 'gpt-4o',
			choices: [
				{ finish_reason: 'stop', message: { role: 'assistant', content: '2' } },
			],
		});
		const provider = makeProvider();
		const history: Message[] = [
			{ role: 'user', content: 'What is 1+1?' },
			{
				role: 'assistant',
				content: '',
				toolCalls: [{ id: 'call_1', name: 'calculator', arguments: { expression: '1+1' } }],
			},
			{ role: 'tool', content: '2', toolCallId: 'call_1' },
		];
		const response = await provider.sendConversation(history, { tools: [calculator] });

		const params = createMock.mock.calls[0][0];
		expect(params.messages[1].tool_calls[0].id).toBe('call_1');
		expect(params.messages[2]).toEqual({
			role: 'tool',
			tool_call_id: 'call_1',
			content: '2',
		});
		expect(response.stopReason).toBe('stop');
		expect(response.toolCalls).toBeUndefined();
	});

	it('accumulates streamed tool-call deltas into the final response', async () => {
		async function* fakeStream() {
			yield {
				choices: [
					{
						delta: {
							tool_calls: [
								{ index: 0, id: 'call_1', function: { name: 'calculator', arguments: '{"expr' } },
							],
						},
					},
				],
			};
			yield {
				choices: [
					{
						delta: {
							tool_calls: [{ index: 0, function: { arguments: 'ession":"1+1"}' } }],
						},
					},
				],
			};
			yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
		}
		createMock.mockResolvedValue(fakeStream());

		const provider = makeProvider();
		const chunks: string[] = [];
		const response = await provider.streamConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			(c) => chunks.push(c),
			{ tools: [calculator] }
		);

		expect(chunks).toEqual([]); // no text deltas in this stream
		expect(response.toolCalls).toEqual([
			{ id: 'call_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});

	it('rejects tools on the structured path', async () => {
		const provider = makeProvider();
		await expect(
			provider.sendStructuredConversation(
				[{ role: 'user', content: 'x' }],
				z.object({ a: z.string() }),
				{ tools: [calculator] }
			)
		).rejects.toThrowError(/structured/i);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/openai-provider.test.ts`
Expected: FAIL — `params.tools` undefined, `response.toolCalls` undefined, structured path resolves instead of rejecting, streaming test returns no `toolCalls`.

- [ ] **Step 3: Implement in `src/providers/openai-provider.ts`**

(a) **Replace the local helpers with the shared module.** Delete the local `separateOpenAIOptions` function and the local `toOpenAIContent` function; add to the imports:

```ts
import {
	separateOpenAIOptions,
	toOpenAIContent,
	toOpenAIMessages,
	toOpenAITools,
	fromOpenAIToolCalls,
	mapOpenAIFinishReason,
} from './openai-compat-mapping';
```

Also add `StopReason` and `ToolCall` to the `../types` import if the compiler asks for them (they are only needed via `LLMResponse`, so usually not).

(b) **`sendConversation`:** replace the inline `messages.map(...)` block with:

```ts
			const openaiMessages = toOpenAIMessages(messages);
```

and extend the `this.client.chat.completions.create({...})` params (after `response_format`, before `stream: false`):

```ts
				// Tool calling: translate toolkit definitions into OpenAI function tools.
				tools:
					options?.tools && options.tools.length > 0
						? toOpenAITools(options.tools)
						: undefined,
				tool_choice: options?.toolChoice,
```

(c) **`normalizeResponse`:** replace the method body with:

```ts
		const choice = response.choices[0];
		return {
			// Empty string if the model returned only tool calls or an unexpected shape — keeps LLMResponse.content always a string.
			content: choice?.message?.content || '',
			toolCalls: fromOpenAIToolCalls(choice?.message),
			stopReason: mapOpenAIFinishReason(choice?.finish_reason),
			model: response.model,
			usage: {
				promptTokens: response.usage?.prompt_tokens,
				completionTokens: response.usage?.completion_tokens,
				totalTokens: response.usage?.total_tokens,
			},
			metadata: {
				provider: 'openai',
				id: response.id,
				created: response.created,
			},
		};
```

(d) **`sendStructuredConversation`:** add as the first statement inside the `try`:

```ts
			// Tools and structured output are mutually exclusive in 0.4.0: run the
			// tool loop with sendConversation, reserve structured for the final turn.
			if (options?.tools && options.tools.length > 0) {
				throw new APIError(
					'Tool calling is not supported with structured output; use sendConversation for the tool loop.',
					400,
					{ provider: 'openai' }
				);
			}
```

Also update the message mapping in `sendStructuredConversation` and `streamConversation` to use `toOpenAIMessages(messages)` (replacing the inline maps).

(e) **`streamConversation`:** pass `tools`/`tool_choice` the same way as (b), and replace the accumulation loop:

```ts
			let fullContent = '';
			// Tool-call deltas arrive fragmented across chunks, keyed by index;
			// accumulate here and surface complete calls only on the final response.
			const toolCallAcc: Array<{ id?: string; name?: string; args: string }> = [];
			let finishReason: string | null | undefined;

			for await (const chunk of stream) {
				const choice = chunk.choices[0];
				const content = choice?.delta?.content || '';
				// Skip empty deltas so callers are not spammed; OpenAI may emit choice/metadata-only chunks.
				if (content) {
					fullContent += content;
					callback(content);
				}
				if (choice?.delta?.tool_calls) {
					for (const deltaCall of choice.delta.tool_calls) {
						const i = deltaCall.index;
						toolCallAcc[i] ??= { args: '' };
						if (deltaCall.id) toolCallAcc[i].id = deltaCall.id;
						if (deltaCall.function?.name) {
							toolCallAcc[i].name = (toolCallAcc[i].name ?? '') + deltaCall.function.name;
						}
						if (deltaCall.function?.arguments) {
							toolCallAcc[i].args += deltaCall.function.arguments;
						}
					}
				}
				if (choice?.finish_reason) {
					finishReason = choice.finish_reason;
				}
			}

			const toolCalls =
				toolCallAcc.length > 0
					? fromOpenAIToolCalls({
						tool_calls: toolCallAcc.map((acc, i) => ({
							id: acc.id ?? `call_${i}`,
							type: 'function',
							function: { name: acc.name ?? '', arguments: acc.args || '{}' },
						})),
					})
					: undefined;

			return {
				content: fullContent,
				toolCalls,
				stopReason: mapOpenAIFinishReason(finishReason),
				model: model,
				metadata: { provider: 'openai' },
			};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/openai-provider.test.ts test/openai-compat-mapping.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/providers/openai-provider.ts test/openai-provider.test.ts
git commit -m "feat: tool calling in OpenAI provider (send + stream + structured guard)"
```

---

### Task 4: UBC LLM Sandbox provider tool support

The sandbox is a LiteLLM OpenAI-compatible proxy; changes mirror Task 3 exactly, reusing the shared mapping module.

**Files:**
- Modify: `src/providers/ubc-llm-sandbox-provider.ts`
- Test: `test/ubc-llm-sandbox-provider.test.ts`

**Interfaces:**
- Consumes: `./openai-compat-mapping` exports (Task 2).
- Produces: same behavior contract as Task 3 for `UbcLlmSandboxProvider`. Its `sendStructuredConversation` already throws 501 unconditionally — leave it untouched.

- [ ] **Step 1: Write the failing test**

Create `test/ubc-llm-sandbox-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { NoopLogger } from 'ubc-genai-toolkit-core';

const createMock = vi.fn();

vi.mock('openai', () => {
	class MockAPIError extends Error {
		status = 500;
	}
	class MockOpenAI {
		static APIError = MockAPIError;
		chat = { completions: { create: createMock } };
		models = { list: vi.fn() };
		post = vi.fn();
	}
	return { default: MockOpenAI };
});

import { UbcLlmSandboxProvider } from '../src/providers/ubc-llm-sandbox-provider';

const calculator = {
	name: 'calculator',
	description: 'Evaluate arithmetic.',
	parameters: z.object({ expression: z.string() }),
};

beforeEach(() => createMock.mockReset());

describe('UbcLlmSandboxProvider tool calling', () => {
	it('passes translated tools to the SDK and normalizes toolCalls/stopReason', async () => {
		createMock.mockResolvedValue({
			id: 'x',
			created: 1,
			model: 'llama3.1',
			choices: [
				{
					finish_reason: 'tool_calls',
					message: {
						role: 'assistant',
						content: null,
						tool_calls: [
							{
								id: 'call_1',
								type: 'function',
								function: { name: 'calculator', arguments: '{"expression":"2*3"}' },
							},
						],
					},
				},
			],
		});
		const provider = new UbcLlmSandboxProvider(
			'key',
			'https://sandbox.example.ca/v1',
			'llama3.1',
			new NoopLogger()
		);
		const response = await provider.sendConversation(
			[{ role: 'user', content: '2*3?' }],
			{ tools: [calculator] }
		);
		expect(createMock.mock.calls[0][0].tools[0].function.name).toBe('calculator');
		expect(response.toolCalls).toEqual([
			{ id: 'call_1', name: 'calculator', arguments: { expression: '2*3' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ubc-llm-sandbox-provider.test.ts`
Expected: FAIL — `tools` undefined on the call params, `toolCalls` undefined on the response.

- [ ] **Step 3: Implement in `src/providers/ubc-llm-sandbox-provider.ts`**

(a) **Use the shared mapping module.** Delete the local `separateOpenAIOptions` and `toOpenAIContent` functions; add to the imports:

```ts
import {
	separateOpenAIOptions,
	toOpenAIContent,
	toOpenAIMessages,
	toOpenAITools,
	fromOpenAIToolCalls,
	mapOpenAIFinishReason,
} from './openai-compat-mapping';
```

(b) **`sendConversation`:** replace the inline `messages.map(...)` block with:

```ts
			const openaiMessages = toOpenAIMessages(messages);
```

and extend the `this.client.chat.completions.create({...})` params (after `response_format`, before `stream: false`):

```ts
				// Tool calling: translate toolkit definitions into OpenAI function tools.
				tools:
					options?.tools && options.tools.length > 0
						? toOpenAITools(options.tools)
						: undefined,
				tool_choice: options?.toolChoice,
```

(c) **`normalizeResponse`:** replace the method body with:

```ts
		const choice = response.choices[0];
		return {
			content: choice?.message?.content || '',
			toolCalls: fromOpenAIToolCalls(choice?.message),
			stopReason: mapOpenAIFinishReason(choice?.finish_reason),
			model: response.model,
			usage: {
				promptTokens: response.usage?.prompt_tokens,
				completionTokens: response.usage?.completion_tokens,
				totalTokens: response.usage?.total_tokens,
			},
			metadata: {
				provider: 'ubc-llm-sandbox',
				// Include relevant OpenAI-compatible fields if needed
				id: response.id,
				created: response.created,
			},
		};
```

(d) **`streamConversation`:** replace the inline `messages.map(...)` with `toOpenAIMessages(messages)`, add `tools`/`tool_choice` as in (b), delete the now-dead `finalResponse` variable and its speculative comment block, and replace the accumulation loop + return with:

```ts
			let fullContent = '';
			// Tool-call deltas arrive fragmented across chunks, keyed by index;
			// accumulate here and surface complete calls only on the final response.
			const toolCallAcc: Array<{ id?: string; name?: string; args: string }> = [];
			let finishReason: string | null | undefined;

			for await (const chunk of stream) {
				const choice = chunk.choices[0];
				const content = choice?.delta?.content || '';
				if (content) {
					fullContent += content;
					callback(content);
				}
				if (choice?.delta?.tool_calls) {
					for (const deltaCall of choice.delta.tool_calls) {
						const i = deltaCall.index;
						toolCallAcc[i] ??= { args: '' };
						if (deltaCall.id) toolCallAcc[i].id = deltaCall.id;
						if (deltaCall.function?.name) {
							toolCallAcc[i].name = (toolCallAcc[i].name ?? '') + deltaCall.function.name;
						}
						if (deltaCall.function?.arguments) {
							toolCallAcc[i].args += deltaCall.function.arguments;
						}
					}
				}
				if (choice?.finish_reason) {
					finishReason = choice.finish_reason;
				}
			}

			const toolCalls =
				toolCallAcc.length > 0
					? fromOpenAIToolCalls({
						tool_calls: toolCallAcc.map((acc, i) => ({
							id: acc.id ?? `call_${i}`,
							type: 'function',
							function: { name: acc.name ?? '', arguments: acc.args || '{}' },
						})),
					})
					: undefined;

			return {
				content: fullContent,
				toolCalls,
				stopReason: mapOpenAIFinishReason(finishReason),
				model: model, // Use the requested model name
				usage: {
					promptTokens: undefined,
					completionTokens: undefined,
					totalTokens: undefined,
				},
				metadata: { provider: 'ubc-llm-sandbox' },
			};
```

(e) **`sendStructuredConversation`:** no change (it already throws 501 unconditionally).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS (all files so far).

- [ ] **Step 5: Build and commit**

Run: `npm run build` — expected exit 0.

```bash
git add src/providers/ubc-llm-sandbox-provider.ts test/ubc-llm-sandbox-provider.test.ts
git commit -m "feat: tool calling in UBC LLM Sandbox provider"
```

---

### Task 5: Anthropic mapping module

**Files:**
- Create: `src/providers/anthropic-mapping.ts`
- Test: `test/anthropic-mapping.test.ts`

**Interfaces:**
- Consumes: types from Task 1; `APIError` from core; `zodToJsonSchema`; Anthropic SDK types (`MessageParam`, `ContentBlockParam`, `Tool`, `ToolChoice` from `@anthropic-ai/sdk/resources/messages`).
- Produces (Task 6 imports these exact names):

```ts
export function toAnthropicContent(msg: Message): string | ContentBlockParam[];
export function toAnthropicMessages(messages: Message[]): MessageParam[];      // filters system; merges consecutive tool results
export function toAnthropicTools(tools: ToolDefinition[]): Tool[];
export function toAnthropicToolChoice(choice?: 'auto' | 'required' | 'none'): ToolChoice | undefined;
export function fromAnthropicToolUse(content: Array<{ type: string; [k: string]: unknown }>): ToolCall[] | undefined;
export function mapAnthropicStopReason(reason: string | null | undefined): StopReason | undefined;
```

- [ ] **Step 1: Write the failing tests**

Create `test/anthropic-mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
	toAnthropicMessages,
	toAnthropicTools,
	toAnthropicToolChoice,
	fromAnthropicToolUse,
	mapAnthropicStopReason,
} from '../src/providers/anthropic-mapping';
import type { Message } from '../src/types';

describe('toAnthropicMessages', () => {
	it('filters system messages (they belong in the top-level system param)', () => {
		const out = toAnthropicMessages([
			{ role: 'system', content: 'be nice' },
			{ role: 'user', content: 'hi' },
		]);
		expect(out).toEqual([{ role: 'user', content: 'hi' }]);
	});

	it('maps assistant toolCalls to tool_use content blocks (text block only when content is non-empty)', () => {
		const messages: Message[] = [
			{
				role: 'assistant',
				content: 'Let me calculate.',
				toolCalls: [
					{ id: 'toolu_1', name: 'calculator', arguments: { expression: '1+1' } },
				],
			},
		];
		expect(toAnthropicMessages(messages)).toEqual([
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Let me calculate.' },
					{ type: 'tool_use', id: 'toolu_1', name: 'calculator', input: { expression: '1+1' } },
				],
			},
		]);
	});

	it('maps tool messages to user tool_result blocks and merges consecutive results into one user turn', () => {
		const out = toAnthropicMessages([
			{ role: 'tool', content: '2', toolCallId: 'toolu_1' },
			{ role: 'tool', content: '4', toolCallId: 'toolu_2' },
		]);
		// Parallel tool results MUST land in a single user message.
		expect(out).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'tool_result', tool_use_id: 'toolu_1', content: '2' },
					{ type: 'tool_result', tool_use_id: 'toolu_2', content: '4' },
				],
			},
		]);
	});

	it('throws when a tool message is missing toolCallId', () => {
		expect(() =>
			toAnthropicMessages([{ role: 'tool', content: 'x' }])
		).toThrowError(/toolCallId/);
	});
});

describe('toAnthropicTools', () => {
	it('produces name/description/input_schema tools', () => {
		const tools = toAnthropicTools([
			{
				name: 'calculator',
				description: 'Evaluate arithmetic.',
				parameters: z.object({ expression: z.string() }),
			},
		]);
		expect(tools[0].name).toBe('calculator');
		expect(tools[0].description).toBe('Evaluate arithmetic.');
		expect((tools[0].input_schema as any).type).toBe('object');
		expect((tools[0].input_schema as any).properties.expression.type).toBe('string');
	});
});

describe('toAnthropicToolChoice', () => {
	it('maps toolkit choices to Anthropic tool_choice objects', () => {
		expect(toAnthropicToolChoice('auto')).toEqual({ type: 'auto' });
		expect(toAnthropicToolChoice('required')).toEqual({ type: 'any' });
		expect(toAnthropicToolChoice('none')).toEqual({ type: 'none' });
		expect(toAnthropicToolChoice(undefined)).toBeUndefined();
	});
});

describe('fromAnthropicToolUse', () => {
	it('extracts tool_use blocks as ToolCalls', () => {
		const calls = fromAnthropicToolUse([
			{ type: 'text', text: 'Let me check.' },
			{ type: 'tool_use', id: 'toolu_1', name: 'calculator', input: { expression: '1+1' } },
		]);
		expect(calls).toEqual([
			{ id: 'toolu_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
	});

	it('returns undefined when there are none', () => {
		expect(fromAnthropicToolUse([{ type: 'text', text: 'hi' }])).toBeUndefined();
	});
});

describe('mapAnthropicStopReason', () => {
	it('maps stop reasons to normalized StopReason', () => {
		expect(mapAnthropicStopReason('end_turn')).toBe('stop');
		expect(mapAnthropicStopReason('stop_sequence')).toBe('stop');
		expect(mapAnthropicStopReason('tool_use')).toBe('tool_calls');
		expect(mapAnthropicStopReason('max_tokens')).toBe('length');
		expect(mapAnthropicStopReason('refusal')).toBe('other');
		expect(mapAnthropicStopReason(null)).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/anthropic-mapping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/providers/anthropic-mapping.ts`:

```ts
/**
 * @fileoverview Pure mapping helpers for the Anthropic provider's tool calling.
 *
 * Anthropic's wire format differs from the toolkit's neutral shapes in two
 * load-bearing ways:
 * - Assistant tool requests are `tool_use` content blocks, not a `tool_calls`
 *   array.
 * - Tool results are `tool_result` content blocks inside a **user** message
 *   (there is no `tool` role), and parallel results must share ONE user
 *   message — splitting them degrades the model's parallel tool calling.
 *
 * Pure functions only (no client, no network) so this translation is
 * unit-testable without mocking the SDK.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { APIError } from 'ubc-genai-toolkit-core';
import type {
	MessageParam,
	ContentBlockParam,
	Tool,
	ToolChoice,
	ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import {
	Message,
	StopReason,
	ToolCall,
	ToolDefinition,
} from '../types';

/**
 * Message content for the Anthropic SDK: a plain string, or a content-block
 * array (text block + base64 `image` blocks) when the message carries images.
 */
export function toAnthropicContent(msg: Message): string | ContentBlockParam[] {
	if (!msg.images || msg.images.length === 0) {
		return msg.content;
	}
	const blocks: ContentBlockParam[] = [];
	if (msg.content) {
		blocks.push({ type: 'text', text: msg.content });
	}
	for (const image of msg.images) {
		blocks.push({
			type: 'image',
			source: {
				type: 'base64',
				// Standard image MIME strings; Anthropic validates server-side.
				media_type: image.mimeType as
					| 'image/jpeg'
					| 'image/png'
					| 'image/gif'
					| 'image/webp',
				data: image.data,
			},
		});
	}
	return blocks;
}

/**
 * Maps toolkit messages to Anthropic `MessageParam[]`:
 * - `system` messages are dropped (callers pass system text via the top-level
 *   `system` request field).
 * - assistant messages with {@link Message.toolCalls} become text + `tool_use`
 *   blocks.
 * - `tool` messages become `tool_result` blocks in a user message; consecutive
 *   tool messages are merged into one user message so parallel results arrive
 *   together.
 *
 * @throws {APIError} 400 when a `role: 'tool'` message has no `toolCallId`.
 */
export function toAnthropicMessages(messages: Message[]): MessageParam[] {
	const out: MessageParam[] = [];

	for (const msg of messages) {
		if (msg.role === 'system') {
			continue;
		}

		if (msg.role === 'tool') {
			if (!msg.toolCallId) {
				throw new APIError(
					"Tool-result message is missing 'toolCallId'; it must reference the ToolCall.id it answers.",
					400
				);
			}
			const resultBlock: ToolResultBlockParam = {
				type: 'tool_result',
				tool_use_id: msg.toolCallId,
				content: msg.content,
			};
			const previous = out[out.length - 1];
			const previousIsToolResults =
				previous &&
				previous.role === 'user' &&
				Array.isArray(previous.content) &&
				previous.content.every((block) => block.type === 'tool_result');
			if (previousIsToolResults) {
				(previous.content as ToolResultBlockParam[]).push(resultBlock);
			} else {
				out.push({ role: 'user', content: [resultBlock] });
			}
			continue;
		}

		if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
			const blocks: ContentBlockParam[] = [];
			if (msg.content) {
				blocks.push({ type: 'text', text: msg.content });
			}
			for (const call of msg.toolCalls) {
				blocks.push({
					type: 'tool_use',
					id: call.id,
					name: call.name,
					input: call.arguments,
				});
			}
			out.push({ role: 'assistant', content: blocks });
			continue;
		}

		out.push({
			role: msg.role,
			content: toAnthropicContent(msg),
		});
	}

	return out;
}

/**
 * Converts toolkit tool definitions to Anthropic tools. Zod schemas become
 * inline JSON Schema (no `$ref` indirection).
 */
export function toAnthropicTools(tools: ToolDefinition[]): Tool[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: zodToJsonSchema(tool.parameters as never, {
			target: 'jsonSchema7',
			$refStrategy: 'none',
		}) as Tool['input_schema'],
	}));
}

/**
 * Maps the toolkit's `toolChoice` to Anthropic's `tool_choice` object.
 * Toolkit `'required'` is Anthropic `{ type: 'any' }`.
 */
export function toAnthropicToolChoice(
	choice?: 'auto' | 'required' | 'none'
): ToolChoice | undefined {
	switch (choice) {
		case 'auto':
			return { type: 'auto' };
		case 'required':
			return { type: 'any' };
		case 'none':
			return { type: 'none' };
		default:
			return undefined;
	}
}

/**
 * Extracts normalized {@link ToolCall}s from Anthropic response content
 * blocks. Returns `undefined` (not `[]`) when there are none.
 */
export function fromAnthropicToolUse(
	content: Array<{ type: string; [key: string]: unknown }>
): ToolCall[] | undefined {
	const toolUseBlocks = content.filter((block) => block.type === 'tool_use');
	if (toolUseBlocks.length === 0) {
		return undefined;
	}
	return toolUseBlocks.map((block) => ({
		id: block.id as string,
		name: block.name as string,
		arguments: (block.input ?? {}) as Record<string, unknown>,
	}));
}

/**
 * Normalizes Anthropic `stop_reason` into the toolkit {@link StopReason}.
 */
export function mapAnthropicStopReason(
	reason: string | null | undefined
): StopReason | undefined {
	if (reason == null) return undefined;
	switch (reason) {
		case 'end_turn':
		case 'stop_sequence':
			return 'stop';
		case 'tool_use':
			return 'tool_calls';
		case 'max_tokens':
			return 'length';
		default:
			return 'other';
	}
}
```

Note: if the installed `@anthropic-ai/sdk` version does not export a `ToolChoice` type from `@anthropic-ai/sdk/resources/messages`, use `MessageCreateParams['tool_choice']` instead:

```ts
import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages';
type ToolChoice = NonNullable<MessageCreateParams['tool_choice']>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/anthropic-mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/anthropic-mapping.ts test/anthropic-mapping.test.ts
git commit -m "feat: add Anthropic tool-calling mapping module"
```

---

### Task 6: Anthropic provider tool support

**Files:**
- Modify: `src/providers/anthropic-provider.ts`
- Test: `test/anthropic-provider.test.ts`

**Interfaces:**
- Consumes: `./anthropic-mapping` exports (Task 5).
- Produces: `AnthropicProvider.sendConversation` accepts tools and returns `toolCalls`/`stopReason`; `streamConversation` accumulates `tool_use` blocks (via `input_json_delta`); `sendStructuredConversation` rejects `options.tools` with 400.

- [ ] **Step 1: Write the failing tests**

Create `test/anthropic-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { NoopLogger } from 'ubc-genai-toolkit-core';

const createMock = vi.fn();
const parseMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
	class MockAPIError extends Error {
		status = 500;
	}
	class MockAnthropic {
		static APIError = MockAPIError;
		messages = { create: createMock, parse: parseMock };
		models = { list: vi.fn() };
	}
	return { default: MockAnthropic };
});

vi.mock('@anthropic-ai/sdk/helpers/zod', () => ({
	zodOutputFormat: vi.fn(() => ({ type: 'json_schema' })),
}));

import { AnthropicProvider } from '../src/providers/anthropic-provider';

const calculator = {
	name: 'calculator',
	description: 'Evaluate arithmetic.',
	parameters: z.object({ expression: z.string() }),
};

beforeEach(() => {
	createMock.mockReset();
	parseMock.mockReset();
});

describe('AnthropicProvider tool calling', () => {
	it('passes translated tools/tool_choice and normalizes tool_use blocks + stop_reason', async () => {
		createMock.mockResolvedValue({
			id: 'msg_1',
			model: 'claude-x',
			stop_reason: 'tool_use',
			stop_sequence: null,
			content: [
				{ type: 'text', text: 'Let me calculate.' },
				{ type: 'tool_use', id: 'toolu_1', name: 'calculator', input: { expression: '1+1' } },
			],
			usage: { input_tokens: 10, output_tokens: 5 },
		});

		const provider = new AnthropicProvider('key', 'claude-x', new NoopLogger());
		const response = await provider.sendConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			{ tools: [calculator], toolChoice: 'required' }
		);

		const params = createMock.mock.calls[0][0];
		expect(params.tools[0].name).toBe('calculator');
		expect(params.tool_choice).toEqual({ type: 'any' });
		expect(params.toolChoice).toBeUndefined(); // must not leak via rest

		expect(response.toolCalls).toEqual([
			{ id: 'toolu_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
		expect(response.content).toBe('Let me calculate.');
	});

	it('accumulates streamed tool_use input_json_delta into the final response', async () => {
		async function* fakeStream() {
			yield {
				type: 'content_block_start',
				index: 0,
				content_block: { type: 'tool_use', id: 'toolu_1', name: 'calculator' },
			};
			yield {
				type: 'content_block_delta',
				index: 0,
				delta: { type: 'input_json_delta', partial_json: '{"expres' },
			};
			yield {
				type: 'content_block_delta',
				index: 0,
				delta: { type: 'input_json_delta', partial_json: 'sion":"1+1"}' },
			};
			yield { type: 'content_block_stop', index: 0 };
			yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: {} };
		}
		createMock.mockResolvedValue(fakeStream());

		const provider = new AnthropicProvider('key', 'claude-x', new NoopLogger());
		const chunks: string[] = [];
		const response = await provider.streamConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			(c) => chunks.push(c),
			{ tools: [calculator] }
		);

		expect(chunks).toEqual([]);
		expect(response.toolCalls).toEqual([
			{ id: 'toolu_1', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});

	it('rejects tools on the structured path', async () => {
		const provider = new AnthropicProvider('key', 'claude-x', new NoopLogger());
		await expect(
			provider.sendStructuredConversation(
				[{ role: 'user', content: 'x' }],
				z.object({ a: z.string() }),
				{ tools: [calculator] }
			)
		).rejects.toThrowError(/structured/i);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/anthropic-provider.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `src/providers/anthropic-provider.ts`**

(a) Delete the local `toAnthropicContent` function; add imports:

```ts
import {
	toAnthropicContent,
	toAnthropicMessages,
	toAnthropicTools,
	toAnthropicToolChoice,
	fromAnthropicToolUse,
	mapAnthropicStopReason,
} from './anthropic-mapping';
```

(b) In the local `separateOptions`, also destructure and strip `tools` and `toolChoice` (add them to `known`), exactly as the shared OpenAI module does — otherwise they leak into `...rest` and reach the SDK raw.

(c) In `sendConversation`, `sendStructuredConversation`, and `streamConversation`, replace each inline

```ts
const anthropicMessages: MessageParam[] = messages
	.filter(...)
	.map(...);
```

block with:

```ts
			// System filtering + tool_use / tool_result mapping live in anthropic-mapping.
			const anthropicMessages: MessageParam[] = toAnthropicMessages(messages);
```

(d) In `sendConversation`'s `params`, add after `system: systemPrompt`:

```ts
				tools:
					options?.tools && options.tools.length > 0
						? toAnthropicTools(options.tools)
						: undefined,
				tool_choice: toAnthropicToolChoice(options?.toolChoice),
```

(e) In `normalizeResponse`, add to the returned object (content extraction stays as-is):

```ts
			toolCalls: fromAnthropicToolUse(
				response.content as Array<{ type: string; [key: string]: unknown }>
			),
			stopReason: mapAnthropicStopReason(response.stop_reason),
```

(f) In `sendStructuredConversation`, first statement inside the `try`:

```ts
			if (options?.tools && options.tools.length > 0) {
				throw new APIError(
					'Tool calling is not supported with structured output; use sendConversation for the tool loop.',
					400,
					{ provider: 'anthropic' }
				);
			}
```

(g) In `streamConversation`: add `tools`/`tool_choice` to `params` as in (d), then extend the event loop:

```ts
			let fullContent = '';
			// tool_use inputs stream as partial JSON keyed by block index; buffer
			// them here and parse only when the stream completes.
			const toolAccByIndex = new Map<number, { id: string; name: string; json: string }>();
			let rawStopReason: string | null | undefined;

			// ... inside `for await (const event of stream)`:
				if (
					event.type === 'content_block_start' &&
					event.content_block.type === 'tool_use'
				) {
					toolAccByIndex.set(event.index, {
						id: event.content_block.id,
						name: event.content_block.name,
						json: '',
					});
				} else if (event.type === 'content_block_delta') {
					if (event.delta.type === 'text_delta') {
						const chunk = event.delta.text;
						fullContent += chunk;
						callback(chunk);
					} else if (event.delta.type === 'input_json_delta') {
						const acc = toolAccByIndex.get(event.index);
						if (acc) {
							acc.json += event.delta.partial_json;
						}
					}
				} else if (event.type === 'message_delta') {
					rawStopReason = event.delta.stop_reason ?? rawStopReason;
				}
```

and build the final response:

```ts
			const accumulated = [...toolAccByIndex.values()];
			const toolCalls =
				accumulated.length > 0
					? accumulated.map((acc) => {
						let args: Record<string, unknown>;
						try {
							args = acc.json ? JSON.parse(acc.json) : {};
						} catch {
							throw new APIError(
								`Model returned invalid JSON arguments for tool '${acc.name}'.`,
								502,
								{ provider: 'anthropic', tool: acc.name }
							);
						}
						return { id: acc.id, name: acc.name, arguments: args };
					})
					: undefined;

			return {
				content: fullContent,
				toolCalls,
				stopReason: mapAnthropicStopReason(rawStopReason),
				model: model,
				usage: { promptTokens: undefined, completionTokens: undefined, totalTokens: undefined },
				metadata: { provider: 'anthropic' },
			};
```

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; build exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/providers/anthropic-provider.ts test/anthropic-provider.test.ts
git commit -m "feat: tool calling in Anthropic provider (send + stream + structured guard)"
```

---

### Task 7: Ollama mapping module

**Files:**
- Create: `src/providers/ollama-mapping.ts`
- Test: `test/ollama-mapping.test.ts`

**Interfaces:**
- Consumes: types from Task 1; `zodToJsonSchema`.
- Produces (Task 8 imports these exact names):

```ts
export function ollamaImages(msg: Message): { images?: string[] };
export function toOllamaMessages(messages: Message[]): OllamaChatMessage[];   // structural type defined in the module
export function toOllamaTools(tools: ToolDefinition[]): unknown[];            // Ollama Tool[] wire shape
export function fromOllamaToolCalls(toolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> | undefined): ToolCall[] | undefined;
export function mapOllamaDoneReason(reason: string | undefined, hasToolCalls: boolean): StopReason | undefined;
```

Ollama specifics this module encodes: tool calls carry **no id** (we synthesize `ollama_call_<index>`; Ollama matches results by order, so ids only need to be unique within one response); `arguments` arrive already parsed as objects; a tool-calling turn still reports `done_reason: 'stop'`, so `tool_calls` presence drives the normalized reason.

- [ ] **Step 1: Write the failing tests**

Create `test/ollama-mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
	toOllamaMessages,
	toOllamaTools,
	fromOllamaToolCalls,
	mapOllamaDoneReason,
} from '../src/providers/ollama-mapping';
import type { Message } from '../src/types';

describe('toOllamaMessages', () => {
	it('maps assistant toolCalls to Ollama tool_calls (arguments stay objects)', () => {
		const messages: Message[] = [
			{
				role: 'assistant',
				content: '',
				toolCalls: [
					{ id: 'ollama_call_0', name: 'calculator', arguments: { expression: '1+1' } },
				],
			},
		];
		expect(toOllamaMessages(messages)).toEqual([
			{
				role: 'assistant',
				content: '',
				tool_calls: [
					{ function: { name: 'calculator', arguments: { expression: '1+1' } } },
				],
			},
		]);
	});

	it('maps tool messages to role tool (no id — Ollama matches by order)', () => {
		expect(
			toOllamaMessages([{ role: 'tool', content: '2', toolCallId: 'ollama_call_0' }])
		).toEqual([{ role: 'tool', content: '2' }]);
	});

	it('passes plain messages (and images) through', () => {
		const out = toOllamaMessages([
			{ role: 'user', content: 'hi', images: [{ data: 'AAA', mimeType: 'image/png' }] },
		]);
		expect(out).toEqual([{ role: 'user', content: 'hi', images: ['AAA'] }]);
	});
});

describe('toOllamaTools', () => {
	it('produces function tools with JSON Schema parameters', () => {
		const tools = toOllamaTools([
			{
				name: 'calculator',
				description: 'Evaluate arithmetic.',
				parameters: z.object({ expression: z.string() }),
			},
		]) as any[];
		expect(tools[0].type).toBe('function');
		expect(tools[0].function.name).toBe('calculator');
		expect(tools[0].function.parameters.type).toBe('object');
	});
});

describe('fromOllamaToolCalls', () => {
	it('synthesizes ids since Ollama provides none', () => {
		const calls = fromOllamaToolCalls([
			{ function: { name: 'calculator', arguments: { expression: '1+1' } } },
			{ function: { name: 'datetime', arguments: {} } },
		]);
		expect(calls).toEqual([
			{ id: 'ollama_call_0', name: 'calculator', arguments: { expression: '1+1' } },
			{ id: 'ollama_call_1', name: 'datetime', arguments: {} },
		]);
	});

	it('returns undefined when there are none', () => {
		expect(fromOllamaToolCalls(undefined)).toBeUndefined();
		expect(fromOllamaToolCalls([])).toBeUndefined();
	});
});

describe('mapOllamaDoneReason', () => {
	it('reports tool_calls when tool calls are present (Ollama says stop either way)', () => {
		expect(mapOllamaDoneReason('stop', true)).toBe('tool_calls');
		expect(mapOllamaDoneReason('stop', false)).toBe('stop');
		expect(mapOllamaDoneReason('length', false)).toBe('length');
		expect(mapOllamaDoneReason('weird', false)).toBe('other');
		expect(mapOllamaDoneReason(undefined, false)).toBeUndefined();
		expect(mapOllamaDoneReason(undefined, true)).toBe('tool_calls');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/ollama-mapping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/providers/ollama-mapping.ts`:

```ts
/**
 * @fileoverview Pure mapping helpers for the Ollama provider's tool calling.
 *
 * Ollama quirks this module encodes:
 * - Tool calls carry **no id**. We synthesize `ollama_call_<index>` so callers
 *   can still correlate results within one response; Ollama itself matches
 *   tool results to calls by order, so the id never goes back on the wire.
 * - `arguments` arrive already parsed (objects, not JSON strings).
 * - A tool-calling turn still reports `done_reason: 'stop'`, so the presence
 *   of `tool_calls` — not the done reason — drives the normalized
 *   {@link StopReason}.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import {
	Message,
	StopReason,
	ToolCall,
	ToolDefinition,
} from '../types';

/**
 * Ollama attaches images to a message via an `images` field of base64 strings
 * (vision-capable models). Returns an empty object for text-only messages.
 */
export function ollamaImages(msg: Message): { images?: string[] } {
	return msg.images && msg.images.length > 0
		? { images: msg.images.map((image) => image.data) }
		: {};
}

/** Structural shape of an Ollama chat message (subset the toolkit produces). */
export interface OllamaChatMessage {
	role: string;
	content: string;
	images?: string[];
	tool_calls?: Array<{
		function: { name: string; arguments: Record<string, unknown> };
	}>;
}

/**
 * Maps toolkit messages to Ollama chat messages. Assistant tool calls become
 * `tool_calls` (arguments stay objects); tool results become `role: 'tool'`
 * messages without an id (Ollama matches by order, so `toolCallId` is not
 * sent — it exists only for the caller's bookkeeping).
 */
export function toOllamaMessages(messages: Message[]): OllamaChatMessage[] {
	return messages.map((msg): OllamaChatMessage => {
		if (msg.role === 'tool') {
			return { role: 'tool', content: msg.content };
		}
		if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
			return {
				role: 'assistant',
				content: msg.content,
				tool_calls: msg.toolCalls.map((call) => ({
					function: { name: call.name, arguments: call.arguments },
				})),
			};
		}
		return {
			role: msg.role,
			content: msg.content,
			...ollamaImages(msg),
		};
	});
}

/**
 * Converts toolkit tool definitions to Ollama function tools. Zod schemas
 * become inline JSON Schema (no `$ref` indirection — matches the structured
 * output path in the provider).
 */
export function toOllamaTools(tools: ToolDefinition[]): unknown[] {
	return tools.map((tool) => ({
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: zodToJsonSchema(tool.parameters as never, {
				target: 'jsonSchema7',
				$refStrategy: 'none',
			}) as Record<string, unknown>,
		},
	}));
}

/**
 * Extracts normalized {@link ToolCall}s from an Ollama response message,
 * synthesizing `ollama_call_<index>` ids. Returns `undefined` when there are
 * none.
 */
export function fromOllamaToolCalls(
	toolCalls:
		| Array<{ function: { name: string; arguments: Record<string, unknown> } }>
		| undefined
): ToolCall[] | undefined {
	if (!toolCalls || toolCalls.length === 0) {
		return undefined;
	}
	return toolCalls.map((call, index) => ({
		id: `ollama_call_${index}`,
		name: call.function.name,
		arguments: call.function.arguments ?? {},
	}));
}

/**
 * Normalizes Ollama `done_reason` into the toolkit {@link StopReason}. Ollama
 * reports `'stop'` even for tool-calling turns, so `hasToolCalls` wins.
 */
export function mapOllamaDoneReason(
	reason: string | undefined,
	hasToolCalls: boolean
): StopReason | undefined {
	if (hasToolCalls) return 'tool_calls';
	if (reason == null) return undefined;
	switch (reason) {
		case 'stop':
			return 'stop';
		case 'length':
			return 'length';
		default:
			return 'other';
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/ollama-mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/ollama-mapping.ts test/ollama-mapping.test.ts
git commit -m "feat: add Ollama tool-calling mapping module"
```

---

### Task 8: Ollama provider tool support

**Files:**
- Modify: `src/providers/ollama-provider.ts`
- Test: `test/ollama-provider.test.ts`

**Interfaces:**
- Consumes: `./ollama-mapping` exports (Task 7).
- Produces: `OllamaProvider.sendConversation` accepts tools and returns `toolCalls`/`stopReason`; `streamConversation` collects streamed `tool_calls`; `toolChoice` is ignored with a debug log (Ollama has no equivalent); `sendStructuredConversation` rejects `options.tools` with 400.

- [ ] **Step 1: Write the failing tests**

Create `test/ollama-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { NoopLogger } from 'ubc-genai-toolkit-core';

const chatMock = vi.fn();

vi.mock('ollama', () => ({
	Ollama: class {
		chat = chatMock;
		list = vi.fn();
		embed = vi.fn();
	},
}));

import { OllamaProvider } from '../src/providers/ollama-provider';

const calculator = {
	name: 'calculator',
	description: 'Evaluate arithmetic.',
	parameters: z.object({ expression: z.string() }),
};

beforeEach(() => chatMock.mockReset());

describe('OllamaProvider tool calling', () => {
	it('passes translated tools and normalizes tool_calls with synthesized ids', async () => {
		chatMock.mockResolvedValue({
			model: 'llama3.1',
			done: true,
			done_reason: 'stop',
			message: {
				role: 'assistant',
				content: '',
				tool_calls: [
					{ function: { name: 'calculator', arguments: { expression: '1+1' } } },
				],
			},
			prompt_eval_count: 10,
			eval_count: 5,
		});

		const provider = new OllamaProvider(
			'http://127.0.0.1:11434',
			'llama3.1',
			new NoopLogger()
		);
		const response = await provider.sendConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			{ tools: [calculator], toolChoice: 'auto' }
		);

		const params = chatMock.mock.calls[0][0];
		expect(params.tools[0].function.name).toBe('calculator');
		// toolChoice has no Ollama equivalent and must not reach the client (incl. via options passthrough)
		expect(params.tool_choice).toBeUndefined();
		expect(params.options.toolChoice).toBeUndefined();

		expect(response.toolCalls).toEqual([
			{ id: 'ollama_call_0', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});

	it('collects streamed tool_calls into the final response', async () => {
		async function* fakeStream() {
			yield { message: { content: '' }, done: false };
			yield {
				message: {
					content: '',
					tool_calls: [
						{ function: { name: 'calculator', arguments: { expression: '1+1' } } },
					],
				},
				done: true,
				done_reason: 'stop',
			};
		}
		chatMock.mockResolvedValue(fakeStream());

		const provider = new OllamaProvider(
			'http://127.0.0.1:11434',
			'llama3.1',
			new NoopLogger()
		);
		const response = await provider.streamConversation(
			[{ role: 'user', content: 'What is 1+1?' }],
			() => {},
			{ tools: [calculator] }
		);

		expect(response.toolCalls).toEqual([
			{ id: 'ollama_call_0', name: 'calculator', arguments: { expression: '1+1' } },
		]);
		expect(response.stopReason).toBe('tool_calls');
	});

	it('rejects tools on the structured path', async () => {
		const provider = new OllamaProvider(
			'http://127.0.0.1:11434',
			'llama3.1',
			new NoopLogger()
		);
		await expect(
			provider.sendStructuredConversation(
				[{ role: 'user', content: 'x' }],
				z.object({ a: z.string() }),
				{ tools: [calculator] }
			)
		).rejects.toThrowError(/structured/i);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/ollama-provider.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `src/providers/ollama-provider.ts`**

(a) Delete the local `ollamaImages` function; add imports:

```ts
import {
	ollamaImages,
	toOllamaMessages,
	toOllamaTools,
	fromOllamaToolCalls,
	mapOllamaDoneReason,
} from './ollama-mapping';
```

(b) In the local `separateOptions`, also destructure `tools` and `toolChoice` into `known` (they must not reach `finalOptions`/`rest`).

(c) In `sendConversation`, `sendStructuredConversation`, and `streamConversation`, replace the inline `messages.map(...)` with `const ollamaMessages = toOllamaMessages(messages);`. The system-prompt unshift lines stay (they push `{ role: 'system', content }`, which matches `OllamaChatMessage`).

(d) In `sendConversation`'s `this.client.chat({...})` call, add after `format`:

```ts
				tools:
					options?.tools && options.tools.length > 0
						? (toOllamaTools(options.tools) as never)
						: undefined,
```

and just before the call:

```ts
			// Ollama has no tool_choice equivalent; honor the contract by logging, not failing.
			if (options?.toolChoice) {
				this.logger.debug(
					'Ollama does not support toolChoice; ignoring.',
					{ toolChoice: options.toolChoice }
				);
			}
```

(e) In `normalizeResponse`, widen the structural param type with `message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> }` and add to the returned object:

```ts
			toolCalls: fromOllamaToolCalls(response?.message?.tool_calls),
			stopReason: mapOllamaDoneReason(
				response?.done_reason,
				(response?.message?.tool_calls?.length ?? 0) > 0
			),
```

(f) In `sendStructuredConversation`, first statement inside the `try`:

```ts
			if (options?.tools && options.tools.length > 0) {
				throw new APIError(
					'Tool calling is not supported with structured output; use sendConversation for the tool loop.',
					400,
					{ provider: 'ollama' }
				);
			}
```

(g) In `streamConversation`: pass `tools` as in (d) (plus the toolChoice debug log), and inside the `for await (const part of stream)` loop collect tool calls:

```ts
			const collectedToolCalls: Array<{
				function: { name: string; arguments: Record<string, unknown> };
			}> = [];

			// inside the loop, after the content handling:
				if (part.message?.tool_calls) {
					collectedToolCalls.push(...part.message.tool_calls);
				}
```

and in the returned object:

```ts
				toolCalls: fromOllamaToolCalls(
					collectedToolCalls.length > 0 ? collectedToolCalls : undefined
				),
				stopReason: mapOllamaDoneReason(
					finalResponseMetadata?.done_reason as string | undefined,
					collectedToolCalls.length > 0
				),
```

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run && npm run build`
Expected: all PASS; build exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/providers/ollama-provider.ts test/ollama-provider.test.ts
git commit -m "feat: tool calling in Ollama provider (send + stream + structured guard)"
```

---

### Task 9: `getDisplayMessages` helper + exports

**Files:**
- Create: `src/display.ts`
- Modify: `src/index.ts`
- Test: `test/display.test.ts`

**Interfaces:**
- Consumes: `Message` from `./types`.
- Produces: `export function getDisplayMessages(messages: Message[]): Message[]` — exported from the package root.

- [ ] **Step 1: Write the failing test**

Create `test/display.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getDisplayMessages } from '../src/display';
import type { Message } from '../src/types';

describe('getDisplayMessages', () => {
	it('keeps user/assistant text and drops system, tool, and tool-call-only messages', () => {
		const history: Message[] = [
			{ role: 'system', content: 'be nice' },
			{ role: 'user', content: 'What is 15% of 847?' },
			{
				role: 'assistant',
				content: '',
				toolCalls: [{ id: 'c1', name: 'calculator', arguments: {} }],
			},
			{ role: 'tool', content: '127.05', toolCallId: 'c1' },
			{ role: 'assistant', content: '15% of 847 is 127.05.' },
		];
		expect(getDisplayMessages(history)).toEqual([
			{ role: 'user', content: 'What is 15% of 847?' },
			{ role: 'assistant', content: '15% of 847 is 127.05.' },
		]);
	});

	it('keeps an assistant message that has BOTH text and toolCalls (the text is user-visible)', () => {
		const history: Message[] = [
			{
				role: 'assistant',
				content: 'Let me check that for you.',
				toolCalls: [{ id: 'c1', name: 'calculator', arguments: {} }],
			},
		];
		expect(getDisplayMessages(history)).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/display.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/display.ts`:

```ts
/**
 * @fileoverview Helper for rendering conversation histories that contain
 * tool-calling machinery.
 */

import { Message } from './types';

/**
 * Filters a conversation history down to what an end user should see: `user`
 * and `assistant` messages that carry text. System prompts, `role: 'tool'`
 * results, and tool-call-only assistant turns (empty `content`) are internal
 * machinery and are dropped.
 *
 * Apps that want to surface tool activity ("used calculator…") should read the
 * full history deliberately instead of using this helper.
 *
 * @param messages - Full conversation history, possibly including tool traffic.
 * @returns The user-visible subset, in order. The original array is untouched.
 */
export function getDisplayMessages(messages: Message[]): Message[] {
	return messages.filter(
		(msg) =>
			(msg.role === 'user' || msg.role === 'assistant') &&
			msg.content.trim().length > 0
	);
}
```

In `src/index.ts`, add:

```ts
export * from './display';
```

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run && npm run build`
Expected: PASS; build exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/display.ts src/index.ts test/display.test.ts
git commit -m "feat: add getDisplayMessages helper for tool-aware histories"
```

---

### Task 10: Version 0.4.0, CHANGELOG, readme tool-calling docs

**Files:**
- Modify: `package.json` (version)
- Modify: `CHANGELOG.md`
- Modify: `readme.md`

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.3.0"` to `"version": "0.4.0"`.

- [ ] **Step 2: Add the CHANGELOG entry**

In `CHANGELOG.md`, insert directly below the header block (above the `## [0.3.0]` entry):

```markdown
## [0.4.0] - <today's date, YYYY-MM-DD>

### Added

-   **Tool calling (function calling) across all providers.** `LLMOptions` accepts `tools` (an array of `ToolDefinition` — name, description, Zod `parameters` schema) and `toolChoice` (`'auto' | 'required' | 'none'`). When the model requests tool invocations, `LLMResponse.toolCalls` carries normalized `ToolCall` objects (`id`, `name`, parsed `arguments`) and `LLMResponse.stopReason` is `'tool_calls'`. Results are sent back as `role: 'tool'` messages with `toolCallId`. Supported by OpenAI, Anthropic, Ollama, and UBC LLM Sandbox providers, in both `sendConversation` and `streamConversation` (tool calls surface on the final streamed response, not mid-stream). `sendStructuredConversation` rejects `tools` (mutually exclusive in this release). Fully backwards compatible: code that never passes `tools` is unchanged.
-   **`Message.role` widened** to include `'tool'`, plus optional `Message.toolCalls` / `Message.toolCallId` fields for replaying tool-calling turns in history.
-   **`LLMResponse.stopReason`** (`'stop' | 'tool_calls' | 'length' | 'other'`), normalized across providers, so callers can tell why generation ended without parsing content.
-   **`getDisplayMessages(history)`** helper: filters a tool-aware history down to the user-visible `user`/`assistant` text messages for rendering.
-   **Test infrastructure**: vitest unit tests for the provider mapping layers (`npm test`).
```

- [ ] **Step 3: Add the readme section**

In `readme.md`, add a `## Tool Calling` section (after the existing conversation/structured-output documentation — inspect the file and place it beside its peers):

````markdown
## Tool Calling

Tools let the model request that *your code* run something (a calculation, a
lookup) and then continue with the result. A tool is a name, a description the
model reads, and a Zod schema for its arguments:

```typescript
import { z } from 'zod';
import { LLMModule, Message, ToolDefinition } from 'ubc-genai-toolkit-llm';

const calculator: ToolDefinition = {
	name: 'calculator',
	description: 'Evaluate a basic arithmetic expression, e.g. "847 * 0.15".',
	parameters: z.object({ expression: z.string() }),
};
```

Tool calling is a loop: send the conversation with `tools`; if the response
carries `toolCalls`, execute them, append the results as `role: 'tool'`
messages, and call again. When the model stops calling tools, its text answer
is ready:

```typescript
const messages: Message[] = [
	{ role: 'user', content: 'What is 15% of 847?' },
];

for (let iteration = 0; iteration < 10; iteration++) {
	const response = await llm.sendConversation(messages, {
		tools: [calculator],
	});

	if (!response.toolCalls || response.toolCalls.length === 0) {
		console.log(response.content); // "15% of 847 is 127.05."
		break;
	}

	// Replay the assistant's tool request into history…
	messages.push({
		role: 'assistant',
		content: response.content,
		toolCalls: response.toolCalls,
	});

	// …execute each call and report the results.
	for (const call of response.toolCalls) {
		const result = myEvaluate(String(call.arguments.expression)); // your code
		messages.push({
			role: 'tool',
			content: String(result),
			toolCallId: call.id,
		});
	}
}
```

Notes:

-   `response.stopReason` is `'tool_calls'` when the model is requesting tools,
    `'stop'` when it finished normally.
-   Tool execution errors should be sent back as the tool message's `content`
    (e.g. `"Error: division by zero"`) so the model can recover.
-   `toolChoice: 'required'` forces at least one call; `'none'` disables
    calling; Ollama ignores `toolChoice` (no native equivalent).
-   `streamConversation` works with tools: text still streams via the callback,
    and any tool calls appear on the final returned response.
-   `sendStructuredConversation` does not accept `tools`.
-   When rendering a conversation, use `getDisplayMessages(history)` to hide
    tool machinery — end users should only see `user`/`assistant` text.

The upcoming `ubc-genai-toolkit-agents` module automates this loop; use this
API directly when you need full control.
````

- [ ] **Step 4: Verify build + tests still pass**

Run: `npm run build && npx vitest run`
Expected: exit 0, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md readme.md
git commit -m "docs: document tool calling; bump to 0.4.0"
```

---

### Task 11: Example app — tool-calling demo

**Files:**
- Create: `example/src/tool-calling-demo.ts`
- Modify: `example/package.json` (add `tool-demo` script)

**Interfaces:**
- Consumes: the public 0.4.0 API only (`LLMModule`, `ToolDefinition`, `Message`, `getDisplayMessages`), plus the example's existing `loadConfig()` from `example/src/config.ts`.

- [ ] **Step 1: Write the demo**

Create `example/src/tool-calling-demo.ts`:

```ts
/**
 * @fileoverview One-shot demo of tool calling with the LLM module.
 *
 * ## What this file does
 *
 * Defines a `calculator` tool (a tiny safe arithmetic evaluator), asks the
 * model a question that needs it, and runs the standard tool-calling loop:
 * send → execute requested tools → send results back → print the final answer.
 *
 * ## How to run
 *
 * From the `example/` folder (after `npm install` and `npm run build`):
 *
 * - `npm run tool-demo`
 *
 * Uses the same `.env` configuration as the main example app (see `config.ts`).
 * The configured model must support tool calling (most current OpenAI,
 * Anthropic, and larger Ollama models do).
 */

import { z } from 'zod';
import {
	LLMModule,
	Message,
	ToolDefinition,
	getDisplayMessages,
} from 'ubc-genai-toolkit-llm';
import { loadConfig } from './config';

/**
 * Safe arithmetic evaluator: digits, whitespace, and + - * / ( ) . % only.
 * Never pass model-controlled strings to eval(); this allowlist keeps the
 * demo honest about that rule.
 */
function evaluateExpression(expression: string): number {
	if (!/^[\d\s+\-*/().%]+$/.test(expression)) {
		throw new Error(`Unsupported characters in expression: ${expression}`);
	}
	// eslint-disable-next-line no-new-func
	return Function(`"use strict"; return (${expression});`)() as number;
}

const calculator: ToolDefinition = {
	name: 'calculator',
	description:
		'Evaluate a basic arithmetic expression using + - * / ( ) and decimal numbers, e.g. "847 * 0.15".',
	parameters: z.object({
		expression: z.string().describe('The arithmetic expression to evaluate.'),
	}),
};

async function main() {
	const llm = new LLMModule(loadConfig());
	console.log(`Provider: ${llm.getProviderName()}`);

	const messages: Message[] = [
		{
			role: 'user',
			content:
				'A course has 847 students and 15% of them scored an A. How many students scored an A? Use the calculator tool.',
		},
	];

	const maxIterations = 10;
	for (let iteration = 0; iteration < maxIterations; iteration++) {
		const response = await llm.sendConversation(messages, {
			tools: [calculator],
		});

		if (!response.toolCalls || response.toolCalls.length === 0) {
			console.log(`\nAssistant: ${response.content}`);
			break;
		}

		messages.push({
			role: 'assistant',
			content: response.content,
			toolCalls: response.toolCalls,
		});

		for (const call of response.toolCalls) {
			console.log(`\n[tool call] ${call.name}(${JSON.stringify(call.arguments)})`);
			let resultText: string;
			try {
				const result = evaluateExpression(String(call.arguments.expression));
				resultText = String(result);
			} catch (error) {
				// Errors go back to the model as results so it can recover.
				resultText = `Error: ${error instanceof Error ? error.message : String(error)}`;
			}
			console.log(`[tool result] ${resultText}`);
			messages.push({
				role: 'tool',
				content: resultText,
				toolCallId: call.id,
			});
		}
	}

	console.log('\n--- What an end user would see ---');
	for (const msg of getDisplayMessages(messages)) {
		console.log(`${msg.role}: ${msg.content}`);
	}
}

main().catch((error) => {
	console.error('Tool-calling demo failed:', error);
	process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `example/package.json` `"scripts"`, add:

```json
"tool-demo": "npm run build && node dist/tool-calling-demo.js"
```

- [ ] **Step 3: Verify the example compiles**

Run (from `example/`): `npm install && npm run build`
Expected: exit 0. (`ubc-genai-toolkit-llm` is a `file:..` dependency, so the freshly built 0.4.0 types are picked up; re-run `npm install` in `example/` if stale.)

- [ ] **Step 4: Commit**

```bash
git add example/src/tool-calling-demo.ts example/package.json example/package-lock.json
git commit -m "feat: add tool-calling demo to example app"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full clean build + test suite**

Run (from the package root):

```bash
npm run clean && npm run build && npx vitest run
```

Expected: build exits 0; all test files pass (`types`, `openai-compat-mapping`, `openai-provider`, `ubc-llm-sandbox-provider`, `anthropic-mapping`, `anthropic-provider`, `ollama-mapping`, `ollama-provider`, `display`).

- [ ] **Step 2: Backwards-compatibility smoke check**

Run (from `example/`): `npm run build`
Expected: exit 0 — the pre-existing example sources (`app.ts`, `structured-paragraph-demo.ts`), which know nothing about tools, compile unchanged against 0.4.0.

- [ ] **Step 3: Live end-to-end run (requires credentials — coordinate with the user)**

From `example/` with a configured `.env` (any provider with a tool-capable model):

```bash
npm run tool-demo
```

Expected: at least one `[tool call] calculator({"expression": ...})` line, a `[tool result] 127.05` (or equivalent), and a final assistant answer containing ~127. If no provider credentials are available in this environment, report that step 3 needs a manual run by the user — do not fake it.

- [ ] **Step 4: Commit any final fixes and report**

```bash
git status
```

Expected: clean tree. Report results (including whether step 3 ran) to the user.
