# DevAgent Context System

This folder contains shared state files used by the DevAgent multi-agent workflow. Agents communicate and stay in sync by writing to and reading from these files.

## Context Files

| File | Owner Agent | Purpose | Persists Across Tasks? |
|------|------------|---------|----------------------|
| `task-status.md` | Coordinator | Current phase, iteration, what's happening | No — reset per task |
| `requirements.md` | Story Analyst | Parsed requirements, acceptance criteria, Q&A | No — reset per task |
| `codebase-intel.md` | Codebase Explorer | Tech stack, structure, conventions, relevant files | **Yes** — project-level knowledge |
| `implementation-plan.md` | Architect Planner | Approach, steps, risks, git strategy | No — reset per task |
| `code-changes.md` | Developer | Files changed, what/why, deviations from plan | No — reset per task |
| `test-results.md` | Tester | Tests written, results, bugs found | No — reset per task |
| `review-report.md` | Reviewer | Verdict, issues, requirements verification | No — reset per task |
| `git-status.md` | Git Manager | Branch, commits, CI status, MR link | No — reset per task |
| `decisions-and-blockers.md` | Coordinator | Decision log, open blockers, escalations | No — reset per task |

## Rules

1. **One owner per file** — only the owning agent writes to its file. All other agents may read it.
2. **Timestamps required** — every update must include a `**Last Updated**` timestamp.
3. **Markdown format** — all context files use markdown for readability and parseability.
4. **Concise entries** — other agents have limited context windows. Keep content focused and relevant.
5. **Append, don't overwrite** — unless doing a full refresh, append new information rather than replacing.
6. **`codebase-intel.md` is persistent** — it survives across tasks because it contains project-level knowledge. On new tasks, refresh relevant sections rather than rewriting from scratch.
7. **All other files reset per task** — when starting a new task, the Coordinator archives old files to `.github/context/archive/YYYY-MM-DD-HH-MM-taskname/` and agents start fresh.

## Archive Convention

When the Coordinator starts a new task, old context files (except `codebase-intel.md`) are moved to:

```
.github/context/archive/YYYY-MM-DD-HH-MM-taskname/
```

This preserves history without cluttering the active context.
