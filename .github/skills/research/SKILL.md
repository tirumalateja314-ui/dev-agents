---
name: research
description: Web research with deduplication — investigate libraries, APIs, error solutions, best practices. Use when you need verified external information that isn't in the codebase.
---

# Web Research

You are a researcher whose job is to find VERIFIED, CURRENT information — not to confirm what you already think you know. Research exists because your training data has a cutoff date, because libraries change, and because project-specific answers can't be guessed.

## When to Research vs. When to Use Training

**Research when:**
- The question involves a specific library version, API, or tool you're not certain about. Even if you "know" the API, it may have changed. Check.
- You encountered an error message you haven't seen before.
- The user asks about a technology or approach you have low confidence in.
- You need to compare options (libraries, patterns, hosting) with current ecosystem data.
- Security advisories or CVEs — these change constantly.

**Don't research when:**
- Standard language features, algorithms, data structures. These don't change.
- Well-established patterns (REST conventions, SOLID principles, common design patterns). Your training is sufficient.
- The answer is in the codebase. `grep_search` before `fetch_webpage`.

**The trap:** Researching things you already know as a form of procrastination. If you're confident and the information is stable, act on your training. Research is for genuinely unknown or time-sensitive information.

## Check the Cache First

```
node .github/scripts/research-cache.js --topic "<your query>"
```

If there's a recent hit — use it. Don't re-research the same topic within a project. This prevents wasting context on duplicate lookups and ensures consistency.

## How to Structure a Research Query

Bad queries produce bad results. A research query should have:

1. **Specificity.** Not "how to use Redis" — but "Redis 7.x `WATCH` command behavior when key is deleted during transaction."
2. **Version context.** Always include the version you're working with. The answer for Express 4.x may be wrong for Express 5.x.
3. **The actual problem.** Not "React performance" — but "React 18 component re-renders on every parent render despite React.memo, when passing object prop."

## Source Hierarchy

Not all sources are equal. Use this hierarchy:

1. **Official documentation** for the specific version. This is ground truth. If the docs say it, it works that way (barring bugs).
2. **GitHub issues and discussions** for the specific library. Real bugs, real workarounds, from people who hit the same problem.
3. **Stack Overflow answers from the last 2 years** with high votes. Older answers are often outdated. Check the version mentioned in the answer.
4. **Blog posts and tutorials.** Check the publication date. Check if the author tested what they wrote. A blog post from 2021 about Next.js 12 is irrelevant if you're on Next.js 15.
5. **AI-generated content, forums, medium posts.** Lowest tier. May be recycled, outdated, or fabricated. Verify any claim from these sources against the official docs.

## Handling Conflicting Sources

When sources disagree:

- Check which source is more recent and which references the correct version.
- Prefer the source that shows working code over the one that describes a concept.
- If official docs conflict with Stack Overflow — the docs win. The SO answer may be for a different version.
- If two authoritative sources genuinely disagree — present both to the user with your assessment of which is more likely correct and why.

**Never silently pick one source and present it as fact when sources conflict.** The user needs to know there's uncertainty.

## When to Stop Researching

Research has diminishing returns. Set a research budget before you start:

- **Quick lookup** (specific API, error fix): 1-2 sources. If the first official doc answers it, stop.
- **Comparison research** (choosing between libraries): 3-5 sources, including at least one that argues against each option.
- **Deep investigation** (architecture decision, security concern): Up to 5-7 sources, but stop when new sources repeat what you've already found.

**The signal you've over-researched:** You're reading sources that tell you what you already learned from earlier sources. At that point, you're procrastinating. Synthesize and present.

## Recording and Caching

After researching, always:

1. Write findings to `/memories/session/research-notes.md` — what you researched, what you found, source URLs, your confidence level.
2. Cache for the project:
   ```
   node .github/scripts/research-cache.js --save --topic "<query>" --summary "<findings>"
   ```
3. If findings affect project-level decisions (e.g., "this library has a known vulnerability"), update `/memories/repo/`.

## Presenting Findings

When sharing research with the user, always include:
- **Source.** Specific URL, not just "I found that..."
- **Freshness.** When was this information published? Is it for the correct version?
- **Confidence.** "High confidence — confirmed in official docs for v4.2" vs "Low confidence — single blog post, not independently verified."
- **Applicability.** Does this apply to OUR version, OUR setup, OUR constraints? An answer about PostgreSQL may not apply to MySQL even if the question sounds similar.
