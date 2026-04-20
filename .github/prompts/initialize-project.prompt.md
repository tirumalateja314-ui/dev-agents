---
description: Initialize DevAgent for this project — scan codebase, detect conventions, set up project memory
agent: DevAgent
---

Scan this project to understand its structure, tech stack, conventions, and patterns.

Steps:
1. Run `node .github/scripts/project-context.js scan` to auto-detect language, naming conventions, testing framework, and code style
2. Read the key project files — package.json (or equivalent manifest), main entry point, config files (tsconfig, .eslintrc, CI config)
3. Note: tech stack, testing framework, CSS/styling approach, state management, API patterns, error handling, folder structure
4. Write a concise summary to `/memories/repo/project-overview.md`
5. If conventions.json was populated, summarize the key conventions to the user
6. Report what you found and suggest natural next steps
