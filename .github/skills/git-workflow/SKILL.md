---
name: git-workflow
description: Git operations — branching strategy, commit conventions, merge request creation, CI/CD awareness. Use when performing git operations or when the user asks about git workflow.
---

# Git Workflow

You handle git operations as a thoughtful collaborator, not a command executor. A commit message shows whether a developer is a good collaborator. A clean git history makes debugging possible. A sloppy one makes it archaeology.

## Safety: Non-Negotiable

**Before ANY push operation**, run:
```
node .github/scripts/git-safety-check.js
```
If blockers are found, resolve them before pushing. Never skip, never override.

**Dangerous operations require explicit user confirmation before execution:**
- `git push --force` / `git push -f` — rewrites shared history
- `git reset --hard` — destroys uncommitted work
- `git rebase` on any branch that others might have pulled
- Deleting remote branches
- Amending commits that have been pushed

For these: explain what will happen, what could go wrong, and ask. Don't proceed on assumption.

## Discover the Project's Way First

Don't impose conventions. Discover them.

```bash
# What branching pattern does this project use?
git branch -a | head -30

# What commit message style exists?
git log --oneline -20

# Is there a CI pipeline? What does it check?
# Look at .gitlab-ci.yml, .github/workflows/, Jenkinsfile
```

If the project uses conventional commits — use conventional commits. If it uses a ticket-number prefix — use ticket numbers. If commits are full sentences — write full sentences. Match what's there.

**Only if no pattern exists**, default to:
- Branches: `<type>/<short-description>` (e.g., `feat/user-roles`, `fix/auth-timeout`)
- Commits: Conventional Commits format (below)

## Writing Commit Messages That Help Future Debugging

Six months from now, someone will run `git log --oneline` or `git blame` on a confusing line. Your commit message is the only context they'll have. Make it count.

**The 7 Rules (from cbeams, widely adopted):**
1. Separate subject from body with a blank line
2. Limit the subject line to 50 characters
3. Capitalize the subject line
4. Do not end the subject line with a period
5. Use the imperative mood in the subject line ("Add feature" not "Added feature")
6. Wrap the body at 72 characters
7. Use the body to explain **what** and **why**, not how

The code shows HOW. The commit message explains WHY. "Refactor auth middleware" tells you nothing. "Refactor auth middleware to support multiple token issuers" tells you everything.

**Conventional Commits format (when the project uses it):**
```
<type>[optional scope]: <description>

[optional body explaining what and why]

[optional footer(s)]
```

Types: `feat` (new feature, bumps minor), `fix` (bug fix, bumps patch), `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`

Breaking changes: add `!` after type/scope (`feat!: remove legacy auth`) or add `BREAKING CHANGE:` footer.

**Examples of good vs bad commits:**

```
# BAD — what changed is obvious from the diff, WHY is missing
fix: update validation

# GOOD — explains the problem that motivated the change
fix(auth): reject expired tokens even when signature is valid

Previously, token validation checked signature but not expiry when
the token was issued by the legacy auth service. This allowed
expired tokens to pass validation for legacy users.

Closes #847
```

## When to Commit (Granularity)

**Each commit should represent one logical change.** The test: can you describe the commit in one sentence without using "and"? If not, split it.

- Refactoring + feature in one commit? Split. The refactor should be a separate commit that doesn't change behavior.
- File rename + content changes? Two commits. One rename (easy to verify), one content change (needs review).
- Fix + test for the fix? One commit. The test proves the fix works — they belong together.

**Never commit:**
- Generated files that should be in .gitignore (node_modules, build output, .env)
- Debug logging you added while investigating
- Commented-out code "just in case"

## Branching

Branch from the latest version of the target branch:
```bash
git fetch origin
git checkout -b feat/your-feature origin/main  # or origin/develop, whatever the project uses
```

Keep branches short-lived. A branch that lives for weeks accumulates merge conflicts and drifts from the target. If the feature is large, break it into smaller branches that merge incrementally.

## Merge Requests (GitLab — NOT "Pull Requests")

This project uses GitLab. The term is **Merge Request (MR)**.

An MR should include:
- **Title:** What this MR does, in one line (matches the main commit message style)
- **Description:** Problem being solved, approach taken, how it was tested, anything the reviewer should pay attention to
- **Linked issues:** `Closes #123` or `Relates to #456` — this creates traceability

Before creating an MR:
1. Rebase on the target branch to avoid merge conflicts in review
2. Ensure CI pipeline passes — don't waste a reviewer's time on code that doesn't build
3. Self-review the diff once. You'll catch things.

## CI/CD Awareness

- Check `.gitlab-ci.yml` for pipeline stages and requirements
- If pipeline fails after push — investigate and fix immediately, don't leave it red
- Don't push to protected branches directly — always use MRs
- If the pipeline has flaky tests (pass/fail randomly), note it but don't ignore real failures
