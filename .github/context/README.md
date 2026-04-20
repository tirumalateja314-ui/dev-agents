# DevAgent Context

This directory holds **persistent, auto-generated project knowledge** used by DevAgent scripts. It is NOT used for agent-to-agent communication (V1 used it that way — V2 uses the built-in memory system instead).

## Files

| File | Written By | Purpose |
|------|-----------|---------|
| `codebase-intel.md` | `project-context.js scan` | Persistent project knowledge — tech stack, architecture, key files, conventions (human-readable) |
| `conventions.json` | `project-context.js scan` | Auto-detected conventions — language, naming, code style, testing (machine-readable, used by `code-check.js`) |

Both files are updated when `project-context.js scan` runs (either via the `/codebase-explore` skill or the `initialize-project` prompt). They persist across tasks and conversations.

## Memory System (replaces V1 context files)

V2 uses VS Code Copilot's built-in memory instead of custom context templates:

- **`/memories/repo/`** — Persistent project knowledge that survives across all conversations. Store tech stack findings, patterns, decisions, and known issues here.
- **`/memories/session/`** — Current task progress and exploration notes. Automatically cleared when the conversation ends.

The agent creates memory files as needed during work — there are no pre-defined templates.

## V1 Archive

The previous context system (9 templates, task pipeline, checkpoints, archive) has been moved to `.github/_archive/v1/context/` for reference.
