---
name: full-spec
description: Formal specification for complex tasks — requirements document, architecture design, task breakdown with traceability. Use for multi-day features, architecture changes, or when the user explicitly requests formal planning.
---

# Full Specification

You write specs that prevent teams from building the wrong thing. A spec is not documentation for documentation's sake — it's a thinking tool that surfaces disagreements, hidden complexity, and missing requirements BEFORE anyone writes code.

## When a Spec Is Needed (and When It's Not)

**Needs a spec:**
- Feature touches multiple systems or modules (cross-cutting concern).
- The scope is ambiguous — "add calendar support" could mean anything from a date picker to a full scheduling system.
- Multiple people will work on it, or future-you needs to understand past-you's decisions.
- The implementation has irreversible consequences (database schema, public API, data migration).

**Doesn't need a spec:**
- Bug fix with clear reproduction steps. Just fix it.
- Single-file change with obvious scope. Just do it.
- The user said exactly what to build and how. Just build it.

Don't write specs for trivial work. The spec should save more time than it costs.

## The Right Level of Abstraction

The hardest judgment in speccing is abstraction level. Shape Up nails this:

- **Too concrete** (wireframes, exact API contracts, database schemas before understanding the problem): This locks in details before you understand the tradeoffs. The implementation team has no room to adapt when they discover reality.
- **Too abstract** ("build a notification system"): Nobody knows what this means. No boundaries. Scope grows forever.
- **Right level**: The solution is spelled out at the macro level — what it does, how the pieces connect, what's explicitly out of scope — but the micro-level details are left for implementation. The implementer knows WHERE they're going but gets to choose the ROAD.

## Extracting What the User HASN'T Said

This is the core analytical skill. When a user says "add user roles to the app," they've told you maybe 20% of what you need. The other 80% is implicit:

**Ask yourself:**
- **Who are the actors?** Not just "users" — admin, regular user, guest, system/automated? Each actor may see different things and have different permissions.
- **What are the edge cases they haven't mentioned?** "Add roles" — what happens to existing users? Can a user have multiple roles? Can roles be changed? Who can change them? What happens to in-progress work when a role changes mid-session?
- **What are the failure modes?** The user described the happy path. What happens when it fails? What does "fail" even mean in this context?
- **What are the data implications?** New data means new schema, new migrations, new queries. How much data? How fast does it grow? Does it need indexing?
- **What are the integration points?** What existing systems does this touch? Auth? API? UI? Background jobs? Notifications?
- **What's NOT included?** Explicitly listing what's out of scope is as important as listing what's in scope. This prevents scope creep better than anything else.

## Identifying Rabbit Holes

Before anyone starts building, actively look for tricky spots that could eat weeks:

- **Technical unknowns.** "We'll need real-time sync" — have you verified the infrastructure supports WebSockets? Is there a message broker? What happens on reconnection?
- **Design-dependent implementation.** If a design decision dramatically changes implementation difficulty, surface it now. "If we need drag-and-drop reordering, that's 3x the complexity of a static list."
- **Dependency risks.** Does this feature depend on another team, an external API, or a library that's unmaintained?
- **Data migration.** Any schema change on a table with millions of rows needs its own plan. This can't be a footnote.

For each rabbit hole: either resolve it in the spec (make a decision), remove it from scope, or flag it with a mitigation plan.

## Structure of a Spec

Write to `/memories/session/task-spec.md`:

```markdown
# Feature: [Name]

## Problem
What's broken or missing? Why does it matter? Who's affected?
(2-4 sentences. If you can't explain the problem clearly, you don't understand it yet.)

## Appetite
How much time is this worth? Not "how long will it take" — but given the
problem's importance, what's the maximum investment that makes sense?

## Solution
What are we building? Describe the user-visible behavior and the key
technical approach. Include rough sketches of the flow — not wireframes,
not pixel-perfect mockups.

## Out of Scope
Explicitly list what we are NOT building. This is the boundary that
prevents scope creep. Be specific — not "advanced features" but
"multi-language support, bulk import, audit logging."

## Rabbit Holes
Tricky spots identified during shaping. For each: what the risk is, and
either the decision made or the mitigation plan.

## Task Breakdown
Ordered list of implementation tasks. Each task should be:
- Small enough to complete and verify independently
- Ordered by dependency (what blocks what)
- Traceable to a requirement in the Solution section

Mark tasks that are risky or uncertain with [?] so the implementer
knows to timebox exploration.
```

## The Appetite Question

Traditional specs ask "how long will this take?" and get estimates that are always wrong. The better question: **"How much time is this worth?"**

A full-featured calendar might take 6 months. But if only 10% of users want it, is it worth 6 months? Maybe we build the 10% of a calendar that serves 80% of the use case — in 2 weeks. That's a scoping decision, not an estimation problem.

When speccing, always ask: given the value this delivers, what's the maximum time budget? Then shape the solution to fit within that budget. Cut scope, not quality.

## Traceability

Run the requirements tracker to verify coverage:
```
node .github/scripts/requirements-tracker.js
```
Every acceptance criterion must map to at least one task. Every task must trace back to a requirement. If a task traces to nothing, it's either scope creep or a missing requirement — figure out which.

## Spec Review Checklist

Before presenting the spec, verify:
- [ ] Could a developer START working from this without asking clarifying questions? (If not, it's too vague.)
- [ ] Is there anything in the spec they'd have to throw away when they discover reality? (If so, it's too detailed.)
- [ ] Are the out-of-scope items genuinely tempting? (If nobody would ever build them, listing them is noise.)
- [ ] Does each task in the breakdown have a clear "done" definition?
- [ ] Have you identified at least one rabbit hole? (If you found zero, you haven't looked hard enough.)
