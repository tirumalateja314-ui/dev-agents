# V1 → V2 Migration

## What Changed

| Aspect | V1 | V2 |
|--------|----|----|
| Agents | 9 specialized (Coordinator, Story Analyst, Codebase Explorer, Researcher, Architect Planner, Developer, Tester, Reviewer, Git Manager) | 1 primary (DevAgent) + 2 subagents (Planner, Git Operations) |
| Global rules | 302-line copilot-instructions.md | ~51 lines |
| Workflow | 8 fixed phases, 4 approval gates | Assessment-driven — agent picks approach per task |
| Context | 10 file templates in context/ | Built-in memory system + 3 retained context files |
| Scripts | 5 scripts + 4 dead scripts | 7 active scripts + 2 test files, zero npm deps |
| Skills | Procedural checklists (~80 lines each) | Domain expertise with examples and decision frameworks |
| Hooks | None | 3 automated hooks (PreToolUse, PostToolUse, Stop) |
| Total context load | 4,000-6,500 lines per task | 320 lines (simple) / 580 lines (complex) |

## Why V2

V1 had 9 agents passing context through files across 8 fixed phases. Every task — even a typo fix — went through the full pipeline. The context load was enormous (4,000+ lines), agents frequently lost track of state, and handoffs between 9 agents created overhead that slowed simple tasks.

V2 uses one agent that calibrates its response:
- **Trivial tasks** — done immediately, no ceremony
- **Moderate tasks** — explore, implement, verify
- **Complex tasks** — hand off to Planner for structured analysis, then implement
- **Git operations** — hand off to Git Operations with automated safety checks

## Archived Files

All V1 files are preserved in this directory:

```
_archive/v1/
├── agents/           # 9 original agent files
├── context/          # Context templates and checkpoints
├── prompts/          # process-story.prompt.md
└── scripts/          # 5 V1 scripts (briefing-gen, context-tool, pre-impl-check, old tests)
```

## If You Want V1 Back

Copy the V1 files back to their original locations:
- `_archive/v1/agents/*.agent.md` → `.github/agents/`
- `_archive/v1/context/*` → `.github/context/`
- `_archive/v1/scripts/*` → `.github/scripts/`

Then replace `.github/instructions/copilot-instructions.md` with the V1 version (not archived — the V1 content was in the same file, overwritten in place).

## Key Differences for Users

- Use `@DevAgent` instead of `@Coordinator`
- No more phase announcements or "entering Phase 3..."
- No more "which context profile?" questions
- Agent asks fewer but better questions
- Simple tasks complete much faster
- Complex tasks still get thorough treatment via Planner handoff
- Git operations are safer — automated hook blocks destructive commands before they run
