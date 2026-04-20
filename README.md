# DevAgent — AI Development Agent for VS Code

A single intelligent agent inside VS Code Copilot that adapts its approach to match task complexity. Simple tasks get done immediately. Complex tasks get planned first. Git operations are always safety-checked.

## How It Works

You talk to **DevAgent**. It decides the approach based on what you ask:

```
                     YOU
                      │
                      ▼
                  DevAgent
                 /        \
        (complex?)    (git ops?)
           │               │
           ▼               ▼
        Planner      Git Operations
           │               │
           └───► back ◄────┘
```

| Agent | Role | When Used |
|-------|------|-----------|
| DevAgent | Primary agent — explores, codes, tests, reviews | Always |
| Planner | Read-only analysis, creates implementation plans | Complex/architecture tasks |
| Git Operations | Safe git commands with pre-flight checks | Branching, committing, pushing |

## Task Calibration

DevAgent assesses every task and picks the right level of effort:

- **Trivial** (typo, rename, config) — just does it, no questions
- **Moderate** (feature, bug fix) — explores, implements, verifies
- **Complex** (architecture, migration) — hands off to Planner first
- **Debug** (something broken) — investigates, diagnoses, fixes

No fixed phases. No approval gates for simple work. The agent uses judgment.

## Safety

- **Git hooks** — 12+ destructive git patterns blocked automatically (force push, reset --hard, etc.)
- **Code checks** — every file edit is scanned for security, performance, and convention issues
- **Stop hook** — git state summary shown at end of every conversation

## Project Structure

```
.github/
├── agents/
│   ├── devagent.agent.md             # Primary agent
│   ├── planner.agent.md              # Read-only planning subagent
│   └── git-ops.agent.md              # Git operations subagent
├── hooks/
│   └── devagent-hooks.json           # Automated pre/post tool checks
├── instructions/
│   └── copilot-instructions.md       # Global rules (all agents)
├── skills/                           # On-demand domain expertise
│   ├── code-review/
│   ├── codebase-explore/
│   ├── full-spec/
│   ├── git-workflow/
│   ├── research/
│   └── testing/
├── scripts/                          # Automation (zero npm deps)
│   ├── code-check.js
│   ├── git-safety-check.js
│   ├── project-context.js
│   ├── convention-scanner.js
│   ├── codebase-diff.js
│   ├── review-prep.js
│   ├── automation-tests.js           # 90 unit tests
│   └── integration-test.js           # 20 integration tests
├── prompts/                          # Quick-launch entry points
│   ├── initialize-project.prompt.md
│   └── quick-fix.prompt.md
├── context/                          # Runtime project intel
│   ├── codebase-intel.md
│   ├── conventions.json
│   └── README.md
└── _archive/v1/                      # Previous 9-agent system
```

## Quick Start

1. Install [VS Code](https://code.visualstudio.com/) with [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat)
2. Clone this repo's `.github/` folder into your project
3. Open VS Code and talk to DevAgent: `@DevAgent add a search bar to the header`

## Running Tests

```bash
cd .github/scripts
node automation-tests.js       # 90 unit tests
node integration-test.js       # 20 integration tests
```

All scripts are CommonJS, zero npm dependencies, Node.js >= 18.

## Git Platform

This project uses **GitLab** with Merge Request (MR) terminology.

## V1 → V2

V2 replaced 9 specialized agents with 1 adaptive agent + 2 lightweight subagents.
See [_archive/v1/MIGRATION.md](.github/_archive/v1/MIGRATION.md) for details.

## License

MIT
