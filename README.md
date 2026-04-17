# DevAgent — Multi-Agent AI Development Team

A team of **9 AI agents** inside VS Code Copilot that collaborate like a real development team. Give a task, get production-ready code with tests, review, and git operations.

## How It Works

You talk to the **Coordinator**. It delegates to 8 specialist subagents:

```
                     YOU
                      │
                      ▼
                 Coordinator
          ┌──┬──┬──┬──┬──┬──┬──┬──┐
          ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼
        Story Code  Res  Arch Dev Test Rev  Git
        Anlst Explr      Plan
```

| # | Agent | Role | Phase |
|---|-------|------|-------|
| 0 | Coordinator | Team Lead — orchestrates everything | All |
| 1 | Story Analyst | Parses requirements from any input | Phase 1 |
| 2 | Codebase Explorer | Scans project structure & conventions | Phase 2 |
| 3 | Researcher | Searches web, reads docs, verifies info | Any phase |
| 4 | Architect Planner | Creates implementation plans | Phase 3 |
| 5 | Developer | Writes production code following plans | Phase 4 |
| 6 | Tester | Writes & runs tests | Phase 5 |
| 7 | Reviewer | Reviews code quality, security, correctness | Phase 6 |
| 8 | Git Manager | Branches, commits, pushes, creates MRs | Phase 7-8 |

## The 8 Phases

```
Phase 1: REQUIREMENTS    → Story Analyst parses your task
Phase 2: EXPLORATION      → Codebase Explorer scans the project
Phase 3: PLANNING         → Architect creates implementation plan  [GATE 1: Approve plan]
Phase 4: DEVELOPMENT      → Developer writes code                  [GATE 2: Approve code]
Phase 5: TESTING          → Tester writes & runs tests
Phase 6: REVIEW           → Reviewer checks everything
Phase 7: GIT PUSH         → Git Manager pushes code                [GATE 3: Approve push]
Phase 8: MERGE REQUEST    → Git Manager creates MR                 [GATE 4: Approve MR]
```

4 approval gates where you review and approve before proceeding.

## Quick Start

1. Install [VS Code](https://code.visualstudio.com/) with [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat)
2. Clone this repo into your project's `.github/` folder
3. Open VS Code and invoke the Coordinator: `@Coordinator build me a login page`

## Key Features

- **Per-path scope control** — set READ-WRITE, READ-ONLY, or NO-ACCESS per folder
- **Vertical slice delivery** — large tasks split into independently testable slices
- **Safety-first git** — 13+ destructive commands blocked, safety checkpoints before every operation
- **Research on demand** — Researcher agent searches the web for solutions, comparisons, security advisories
- **Requirements confidence gate** — LOW confidence blocks the pipeline until questions are answered
- **Max 2 fix attempts** — prevents rabbit-hole debugging loops
- **Team impact checks** — flags when changes affect CI/CD, dependencies, or dev workflows

## Project Structure

```
.github/
├── agents/
│   ├── coordinator.agent.md
│   ├── story-analyst.agent.md
│   ├── codebase-explorer.agent.md
│   ├── researcher.agent.md
│   ├── architect-planner.agent.md
│   ├── developer.agent.md
│   ├── tester.agent.md
│   ├── reviewer.agent.md
│   └── git-manager.agent.md
├── instructions/
│   └── copilot-instructions.md      (global rules for all agents)
└── context/                          (runtime — created during tasks)
    ├── task-status.md
    ├── requirements.md
    ├── codebase-intel.md
    ├── implementation-plan.md
    ├── code-changes.md
    ├── test-results.md
    ├── review-report.md
    ├── research-findings.md
    ├── git-status.md
    └── decisions-and-blockers.md
```

## Documentation

Full documentation available at the [DevAgent Docs Website](https://dev-agents-web.vercel.app/) (or run locally from `/docs-website`).

## Git Platform

This project uses **GitLab** with Merge Request (MR) terminology. CI/CD is `.gitlab-ci.yml`.

## License

MIT
