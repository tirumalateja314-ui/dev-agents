---
name: codebase-explore
description: Deep codebase analysis — scan project structure, tech stack, conventions, architecture patterns. Use when working in an unfamiliar project or when the task touches areas you haven't explored yet.
---

# Codebase Exploration

You are a developer joining a new team. Your goal is to understand enough to make confident changes — not to read every file. The danger is exploring too much (wasting context on irrelevant files) or too little (making assumptions that turn out wrong).

## Start With Existing Knowledge

Before reading a single file:

1. Check `/memories/repo/` — a previous session may have already mapped this project.
2. Check `.github/context/codebase-intel.md` and `.github/context/conventions.json` if they exist.
3. Run `node .github/scripts/project-context.js scan` — this detects tech stack, conventions, and structure automatically.

If you find recent, accurate notes — use them. Don't re-explore what's already known.

## The Exploration Hierarchy

Not all files are equally informative. Read in this order — stop as soon as you have enough context for your task.

**Tier 1 — Project identity (read these always, ~5 files):**
- Package manifest (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`). This tells you: language, framework, dependencies, scripts, and often the project's purpose.
- Main entry point (`src/index.ts`, `main.py`, `cmd/main.go`). Follow the startup — what gets initialized, in what order?
- CI/CD config (`.gitlab-ci.yml`). What stages exist? What's tested? What's deployed? This reveals what the team considers important.
- README. Not for documentation quality — for intent. What does this project DO?

**Tier 2 — Architecture signals (read if you need to understand structure, ~5-10 files):**
- Folder structure. Run `list_dir` at each level. The naming tells you the organization strategy:
  - `src/features/`, `src/modules/` → organized by domain/feature
  - `src/controllers/`, `src/services/`, `src/models/` → organized by technical layer
  - Both → hybrid, look for which is primary
- Config files (`tsconfig.json`, `.eslintrc`, `prettier.config`). These encode the team's decisions about strictness, style, and tooling.
- One representative test file. Don't read all tests — read ONE to learn: framework, assertion style, mocking approach, file naming, and where tests live.

**Tier 3 — Domain knowledge (read only when your task requires deep understanding):**
- Database schema or migrations. How is data modeled? What relationships exist?
- API definitions (routes file, GraphQL schema, OpenAPI spec). What's the contract?
- The specific module your task touches + its closest neighbors.

## What to Look For (Not Just What to Read)

**Error handling pattern.** Find one error path. Is it try/catch? Result types? Error boundaries? A global handler? This tells you how ALL errors should be handled.

**State management.** Where does application state live? Database? In-memory cache? Redux/Zustand store? Context? Understanding this prevents you from duplicating state or breaking existing flows.

**Authentication/authorization.** How do requests get authenticated? Is there middleware? Guards? Decorators? You need this before touching any endpoint.

**Naming conventions.** Not just camelCase vs snake_case — how are things named in THIS project? Are services suffixed with `Service`? Are handlers called `handle*` or `on*` or `*Controller`? Match what exists.

## The Infinite Exploration Trap

If you've read more than 15-20 files without starting your actual task, you're over-exploring. The signal: you keep reading files "just in case" without a specific question you're trying to answer.

**Fix:** Before reading any file, state the question it will answer. "I'm reading `auth.middleware.ts` to understand how JWT tokens are validated, because my task modifies the auth flow." If you can't state the question, you don't need the file.

## Output

Write concise findings to `/memories/repo/project-overview.md`:
- Tech stack and key dependencies
- Project structure pattern (feature-based, layered, hybrid)
- Key patterns: error handling, state, auth, data access, testing
- Build/CI pipeline summary
- Gotchas or non-obvious patterns you discovered

Keep it factual — what IS, not what should be. This file helps future sessions avoid repeating your exploration.
