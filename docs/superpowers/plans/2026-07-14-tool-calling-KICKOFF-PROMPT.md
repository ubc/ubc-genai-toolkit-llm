# Kickoff prompt for the Phase 1 executing agent

Paste everything below the line into a fresh session started in
`/Users/rich/Developer/ubc-genai-toolkit/ubc-genai-toolkit-llm`.

---

Your job is to execute an already-written, already-approved implementation plan:

**`docs/superpowers/plans/2026-07-14-tool-calling.md`** (in this repo)

Read it now, then execute it task by task using your `superpowers:executing-plans` skill (or `superpowers:subagent-driven-development` if you prefer dispatching a subagent per task). The plan is self-contained — every task has complete code, exact commands, expected outputs, and a commit step. Do not redesign it; the design work is done and approved.

## Context you need (and won't find in the plan)

**What this project is.** The UBC GenAI Toolkit is a set of TypeScript npm packages (`ubc-genai-toolkit-core`, `-llm`, `-chunking`, `-document-parsing`, `-rag`) used in production by multiple running applications at UBC, by both human developers and coding agents. Each package lives in its own git repository; the sibling directories under `/Users/rich/Developer/ubc-genai-toolkit/` are separate repos, and the parent directory is not a repo. You are working only in `ubc-genai-toolkit-llm`.

**What you are building and why.** The LLM module is a provider-agnostic facade over OpenAI, Anthropic, Ollama, and the UBC LLM Sandbox (an OpenAI-compatible LiteLLM proxy). It currently has no tool/function-calling support. You are adding it — purely additively — as release 0.4.0. This is Phase 1 of a five-phase effort: a new `ubc-genai-toolkit-agents` package (Phases 2–5, already planned, in the sibling `ubc-genai-toolkit-agents` repo) will be built directly on top of what you ship. Do not read those plans or start that work.

**Why this constrains you.** Two things follow from the above:

1. **Backwards compatibility is absolute.** Production apps depend on this package. Every change must be additive; existing code must compile and behave identically. The plan is written to guarantee this — if you ever find yourself needing to change an existing signature or behavior to make a task work, stop and ask rather than improvise.
2. **The new public names are contracts.** Phase 2's plan imports these exact names from your work: `ToolDefinition`, `ToolCall`, `StopReason` (`'stop' | 'tool_calls' | 'length' | 'other'`), `Message.toolCalls`/`Message.toolCallId`/the widened `'tool'` role, `LLMOptions.tools`/`LLMOptions.toolChoice`, `LLMResponse.toolCalls`/`LLMResponse.stopReason`, and `getDisplayMessages`. Renaming anything in the plan's "Interfaces → Produces" blocks breaks the next phase. Don't.

**Where the full design lives** (optional reading): `../ubc-genai-toolkit-agents/docs/superpowers/specs/2026-07-14-agents-module-design.md`. Section 2 is the approved spec for exactly your phase, including the rationale for the `'tool'` role and the display-filtering rule. Consult it only if a plan step's intent is unclear — the plan is authoritative for what to build.

## Working rules

- Follow the plan's TDD rhythm exactly: write the failing test, watch it fail, implement, watch it pass, commit. Never weaken or delete a test to make it pass; if a test in the plan appears wrong, stop and say so with your reasoning.
- Match the codebase's conventions: **tabs** for indentation, TSDoc on public API, `@fileoverview` headers on new files, errors from `ubc-genai-toolkit-core` (`APIError`, `ConfigurationError`) — never bare `Error`. Tests live in `test/` at the package root (never `src/` — they must not compile into `dist/`).
- The installed SDK versions (`openai` ^4.89, `@anthropic-ai/sdk` ^0.95, `ollama` ^0.5.14) are older than current. If a plan snippet doesn't compile against an installed SDK's actual types, adapt **minimally** (a type import path, a cast) and record the deviation — do **not** upgrade any dependency without asking.
- Commit after every task with the plan's commit messages. Do not push, publish to npm, change the package name/license, or touch the sibling repos.
- Task 12 step 3 is a live end-to-end run needing provider credentials in `example/.env`. If none are available, complete everything else and report that step as "needs a manual run by the user" — never fake or skip-silently a verification.
- Report honestly at the end: what passed (with the test-run output), what deviated from the plan and why, and anything you left for the user.

Start with Task 1. The final state should be: all 12 tasks committed, `npm run build` clean, `npx vitest run` fully green, version 0.4.0 with changelog and readme documenting tool calling.
