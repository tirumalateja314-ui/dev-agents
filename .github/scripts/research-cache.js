#!/usr/bin/env node

/**
 * research-cache.js — DevAgent Research Cache Checker
 *
 * Lightweight cache checker for the Researcher agent. Scans research-findings.md
 * for existing entries before starting a new search. Prevents duplicate research
 * and provides current tech stack context.
 *
 * Usage: node .github/scripts/research-cache.js --topic <search-topic> [--context-dir <path>]
 *
 * Zero dependencies — only Node.js built-in modules.
 */

const fs = require('node:fs');
const path = require('node:path');

// ─────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.github'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(startDir);
}

function getFlag(flagName) {
  const idx = process.argv.indexOf(flagName);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return null;
}

function output(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function fail(message) {
  output({ error: true, message });
  process.exit(1);
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function isTemplate(content) {
  if (!content) return true;
  const lower = content.toLowerCase();
  return lower.includes('(pending)') ||
    lower.includes('(to be filled)') ||
    lower.includes('(not yet written)') ||
    lower.includes('(template)');
}

// ─────────────────────────────────────────────────────────
// STEP 1-2: Parse research entries from research-findings.md
// ─────────────────────────────────────────────────────────

function parseResearchEntries(content) {
  if (!content || isTemplate(content)) return [];

  const entries = [];
  const sections = content.split(/^##\s+/m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0].trim();
    if (!title || title.startsWith('#')) continue; // skip top-level heading remnants

    // Extract date if present (look for YYYY-MM-DD pattern)
    let date = null;
    for (const line of lines.slice(0, 5)) {
      const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        date = dateMatch[1];
        break;
      }
    }

    // First 2 meaningful content lines as preview
    const contentLines = lines.slice(1)
      .filter(l => l.trim() && !l.startsWith('**') && !l.match(/^\d{4}-\d{2}-\d{2}/))
      .slice(0, 2);
    const summaryPreview = contentLines.join(' ').trim().slice(0, 150);

    entries.push({ title, date, summary_preview: summaryPreview || '(no summary)' });
  }

  return entries;
}

// ─────────────────────────────────────────────────────────
// STEP 3: Fuzzy match topic against entries
// ─────────────────────────────────────────────────────────

function extractKeywords(text) {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
    'and', 'or', 'but', 'not', 'so', 'if', 'then', 'than', 'that', 'this',
    'how', 'what', 'which', 'who', 'when', 'where', 'why', 'best', 'practices',
  ]);

  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

function matchRelevance(topicKeywords, entryTitle) {
  const entryKeywords = extractKeywords(entryTitle);
  if (topicKeywords.length === 0 || entryKeywords.length === 0) return 'none';

  let matchCount = 0;
  for (const tk of topicKeywords) {
    for (const ek of entryKeywords) {
      // Exact match or substring match
      if (tk === ek || ek.includes(tk) || tk.includes(ek)) {
        matchCount++;
        break;
      }
    }
  }

  const ratio = matchCount / topicKeywords.length;
  if (ratio >= 0.6) return 'high';
  if (ratio >= 0.3) return 'medium';
  if (matchCount > 0) return 'low';
  return 'none';
}

// ─────────────────────────────────────────────────────────
// STEP 4: Extract tech stack from codebase-intel.md
// ─────────────────────────────────────────────────────────

function extractTechStack(contextDir) {
  const content = readFileSafe(path.join(contextDir, 'codebase-intel.md'));
  if (!content || isTemplate(content)) {
    return { detected_from: 'not available' };
  }

  const result = { detected_from: 'codebase-intel.md' };

  // Find tech stack section
  const techMatch = content.match(/tech(?:nology)?\s*stack[:\s]*([\s\S]*?)(?=\n##|\n---|$)/i)
    || content.match(/languages?\s*&?\s*frameworks?[:\s]*([\s\S]*?)(?=\n##|\n---|$)/i);
  if (techMatch) {
    const lines = techMatch[1].split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .slice(0, 5);

    // Try to extract primary language
    const langMatch = lines.join(' ').match(/(?:primary|main|language)[:\s]*(\w+)/i);
    if (langMatch) {
      result.primary_language = langMatch[1].toLowerCase();
    }

    // Try to extract frameworks
    const frameworks = [];
    const fwPattern = /(?:framework|library|using)[:\s]*([^,\n]+(?:,\s*[^,\n]+)*)/gi;
    let fwMatch;
    while ((fwMatch = fwPattern.exec(lines.join(' '))) !== null) {
      const items = fwMatch[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      frameworks.push(...items);
    }
    if (frameworks.length > 0) {
      result.frameworks = frameworks;
    }

    // Fallback: just include raw lines
    if (!result.primary_language && !result.frameworks) {
      result.summary = lines.join('; ').trim();
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────

function checkResearchCache(topic, contextDir) {
  if (!topic) {
    return { error: true, message: 'Missing required flag: --topic <search-topic>' };
  }

  // Step 1-2: Parse entries
  const researchContent = readFileSafe(path.join(contextDir, 'research-findings.md'));
  const entries = parseResearchEntries(researchContent);

  // Step 3: Match topic
  const topicKeywords = extractKeywords(topic);
  const cachedEntries = [];

  for (const entry of entries) {
    const relevance = matchRelevance(topicKeywords, entry.title);
    if (relevance !== 'none') {
      cachedEntries.push({ ...entry, relevance });
    }
  }

  // Sort by relevance: high > medium > low
  const order = { high: 0, medium: 1, low: 2 };
  cachedEntries.sort((a, b) => order[a.relevance] - order[b.relevance]);

  // Step 4: Tech stack
  const techStack = extractTechStack(contextDir);

  // Build recommendation
  let recommendation;
  if (!researchContent || isTemplate(researchContent)) {
    recommendation = 'No prior research.';
  } else if (cachedEntries.length === 0) {
    recommendation = 'No cached research on this topic.';
  } else {
    const highCount = cachedEntries.filter(e => e.relevance === 'high').length;
    const suffix = cachedEntries.length === 1 ? 'y' : 'ies';
    const highNote = highCount > 0 ? ` (${highCount} high relevance)` : '';
    recommendation = `Found ${cachedEntries.length} relevant cached entr${suffix}${highNote}. Review before searching.`;
  }

  return {
    topic,
    cached_entries: cachedEntries,
    tech_stack: techStack,
    recommendation,
  };
}

function main() {
  const topic = getFlag('--topic');
  if (!topic) fail('Missing required flag: --topic <search-topic>');

  const repoRoot = findRepoRoot(process.cwd());
  const contextDirFlag = getFlag('--context-dir');
  const contextDir = contextDirFlag
    ? path.resolve(contextDirFlag)
    : path.join(repoRoot, '.github', 'context');

  const result = checkResearchCache(topic, contextDir);
  if (result.error) fail(result.message);
  output(result);
}

if (require.main === module) {
  main();
}

module.exports = {
  checkResearchCache,
  parseResearchEntries,
  extractKeywords,
  matchRelevance,
  extractTechStack,
};
