#!/usr/bin/env node

/**
 * codebase-diff.js — DevAgent Codebase Change Detector
 *
 * Detects what changed in the codebase since the last scan so Codebase Explorer
 * only re-scans affected areas instead of doing a full scan.
 *
 * Usage: node .github/scripts/codebase-diff.js [--context-dir <path>]
 *
 * Zero dependencies — only Node.js built-in modules.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

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

function execGitSafe(cmd, cwd, timeoutMs) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs || 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    return { error: true, message: err.message || String(err) };
  }
}

function isGitError(result) {
  return result && typeof result === 'object' && result.error === true;
}

function parseHeaders(content) {
  const headers = {};
  if (!content) return headers;
  for (const line of content.split('\n')) {
    const match = line.match(/^\*\*(.+?)\*\*:\s*(.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase().replaceAll(/\s+/g, '_');
      headers[key] = match[2].trim();
    }
  }
  return headers;
}

// ─────────────────────────────────────────────────────────
// SECTION MAPPING
// ─────────────────────────────────────────────────────────

const TECH_STACK_FILES = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'go.mod', 'go.sum', 'cargo.toml', 'cargo.lock',
  'requirements.txt', 'pyproject.toml', 'setup.py', 'pipfile', 'pipfile.lock',
  'gemfile', 'gemfile.lock', 'build.gradle', 'pom.xml',
  'composer.json', 'composer.lock', '.csproj',
]);

const CI_CD_PATTERNS = [
  '.github/workflows/', '.gitlab-ci', 'jenkinsfile', '.circleci/',
  'dockerfile', 'docker-compose', '.dockerignore',
  'vercel.json', 'netlify.toml', 'fly.toml',
];

const TEST_PATTERNS = [
  'test/', 'tests/', '__tests__/', 'spec/',
  '.test.', '.spec.', '_test.',
];

const STRUCTURE_FILES = new Set([
  '.gitignore', 'readme.md', 'readme', 'license', 'contributing.md',
  'tsconfig.json', '.eslintrc', '.prettierrc', '.editorconfig',
]);

function mapFileToSections(filePath) {
  const sections = new Set();
  const lower = filePath.toLowerCase().replaceAll('\\', '/');
  const base = path.basename(lower);

  // Tech Stack
  if (TECH_STACK_FILES.has(base)) {
    sections.add('Tech Stack');
  }

  // CI/CD
  if (CI_CD_PATTERNS.some(p => lower.includes(p))) {
    sections.add('CI/CD');
  }

  // Testing
  if (TEST_PATTERNS.some(p => lower.includes(p))) {
    sections.add('Testing Setup');
  }

  // Project Structure
  if (STRUCTURE_FILES.has(base)) {
    sections.add('Project Structure');
  }

  // Source file → Conventions
  const srcExts = ['.js', '.ts', '.py', '.java', '.go', '.rb', '.cs', '.php', '.rs', '.tsx', '.jsx'];
  if (srcExts.some(e => lower.endsWith(e))) {
    sections.add('Conventions');
  }

  // New directory → Structure
  if (lower.includes('/') && !sections.has('Project Structure')) {
    // If it's in a new top-level dir, flag structure
    const topDir = lower.split('/')[0];
    if (topDir && !['src', 'lib', 'test', 'tests', 'node_modules', '.github'].includes(topDir)) {
      sections.add('Project Structure');
    }
  }

  return [...sections];
}

// ─────────────────────────────────────────────────────────
// STEP 1: Extract last scan timestamp
// ─────────────────────────────────────────────────────────

function extractLastScanTimestamp(contextDir) {
  const intelContent = readFileSafe(path.join(contextDir, 'codebase-intel.md'));
  if (!intelContent) return null;

  const headers = parseHeaders(intelContent);
  const timestamp = headers.last_updated || headers['last updated'] || headers.last_scanned || null;

  if (!timestamp) return null;
  if (timestamp.toLowerCase().includes('pending') || timestamp.toLowerCase().includes('template')) {
    return null;
  }

  // Validate it parses as a date
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  return timestamp;
}

// ─────────────────────────────────────────────────────────
// STEP 2: Get changes since last scan
// ─────────────────────────────────────────────────────────

function getChangesSinceTimestamp(repoRoot, timestamp) {
  const changes = { added: [], modified: [], deleted: [], renamed: [] };

  // Try to find the commit closest to the timestamp
  const commitAtTime = execGitSafe(
    `git log --until="${timestamp}" --format=%H -1`,
    repoRoot
  );

  if (isGitError(commitAtTime) || !commitAtTime) {
    // Timestamp older than git history or no commits → full scan
    return null;
  }

  const baseCommit = commitAtTime;

  // Get diff with filters
  const added = execGitSafe(`git diff --name-only --diff-filter=A ${baseCommit}..HEAD`, repoRoot);
  if (!isGitError(added) && added) {
    changes.added = added.split('\n').filter(Boolean);
  }

  const modified = execGitSafe(`git diff --name-only --diff-filter=M ${baseCommit}..HEAD`, repoRoot);
  if (!isGitError(modified) && modified) {
    changes.modified = modified.split('\n').filter(Boolean);
  }

  const deleted = execGitSafe(`git diff --name-only --diff-filter=D ${baseCommit}..HEAD`, repoRoot);
  if (!isGitError(deleted) && deleted) {
    changes.deleted = deleted.split('\n').filter(Boolean);
  }

  // Renamed files
  const renamed = execGitSafe(`git diff --name-status --diff-filter=R ${baseCommit}..HEAD`, repoRoot);
  if (!isGitError(renamed) && renamed) {
    for (const line of renamed.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        changes.renamed.push({ from: parts[1], to: parts[2] });
      }
    }
  }

  // Count commits since scan
  const commitCount = execGitSafe(
    `git rev-list --count ${baseCommit}..HEAD`,
    repoRoot
  );

  return {
    changes,
    commits_since_scan: isGitError(commitCount) ? 0 : Number.parseInt(commitCount, 10) || 0,
    base_commit: baseCommit,
  };
}

// ─────────────────────────────────────────────────────────
// STEP 3: Map changes to sections
// ─────────────────────────────────────────────────────────

function mapChangesToSections(changes) {
  const sectionSet = new Set();
  const allFiles = [
    ...changes.added,
    ...changes.modified,
    ...changes.deleted,
    ...changes.renamed.map(r => r.to),
  ];

  for (const file of allFiles) {
    const sections = mapFileToSections(file);
    for (const s of sections) sectionSet.add(s);
  }

  // New directories → structure
  for (const file of changes.added) {
    const dir = path.dirname(file);
    if (dir && dir !== '.') {
      // Check if this dir is new (all files in it are added)
      const dirFiles = changes.added.filter(f => f.startsWith(dir + '/') || f.startsWith(dir + '\\'));
      if (dirFiles.length > 0) {
        sectionSet.add('Project Structure');
      }
    }
  }

  // Deleted directories
  if (changes.deleted.length > 0) {
    sectionSet.add('Project Structure');
  }

  return [...sectionSet];
}

// ─────────────────────────────────────────────────────────
// STEP 4: Generate recommendation
// ─────────────────────────────────────────────────────────

function generateRecommendation(changes, affectedSections) {
  const totalChanges =
    changes.added.length +
    changes.modified.length +
    changes.deleted.length +
    changes.renamed.length;

  if (totalChanges === 0) {
    return 'No changes since last scan. Skip refresh.';
  }

  const focusAreas = [];
  if (changes.added.length > 0) {
    const dirs = [...new Set(changes.added.map(f => path.dirname(f)).filter(d => d !== '.'))];
    if (dirs.length > 0) {
      focusAreas.push(`new files in ${dirs.slice(0, 3).join(', ')}`);
    }
  }
  if (changes.modified.some(f => TECH_STACK_FILES.has(path.basename(f).toLowerCase()))) {
    focusAreas.push('updated dependency files');
  }
  if (changes.deleted.length > 0) {
    focusAreas.push(`${changes.deleted.length} deleted file(s)`);
  }

  const focusStr = focusAreas.length > 0 ? ` Focus on: ${focusAreas.join(', ')}.` : '';

  if (totalChanges < 5) {
    return `Minor refresh. Update: ${affectedSections.join(', ')}.${focusStr}`;
  }
  if (totalChanges <= 20) {
    return `Partial refresh needed.${focusStr} Affected sections: ${affectedSections.join(', ')}.`;
  }
  return `Significant changes (${totalChanges} files). Consider full re-scan.${focusStr}`;
}

// ─────────────────────────────────────────────────────────
// Truncation helper
// ─────────────────────────────────────────────────────────

function truncateList(list, max) {
  if (list.length <= max) return { items: list, truncated: false };
  return { items: list.slice(0, max), truncated: true, total: list.length };
}

// ─────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────

function runCodebaseDiff(contextDir, repoRoot) {
  // Check git is available
  const isRepo = execGitSafe('git rev-parse --is-inside-work-tree', repoRoot);
  if (isGitError(isRepo) || isRepo !== 'true') {
    return {
      last_scanned: null,
      current_head: null,
      commits_since_scan: 0,
      changes: { added: [], modified: [], deleted: [], renamed: [] },
      affected_sections: [],
      recommendation: 'Not a git repository. Full scan needed.',
    };
  }

  // Current HEAD
  const currentHead = execGitSafe('git rev-parse --short HEAD', repoRoot);
  const headHash = isGitError(currentHead) ? null : currentHead;

  // Step 1: Extract timestamp
  const lastScanned = extractLastScanTimestamp(contextDir);

  if (!lastScanned) {
    return {
      last_scanned: null,
      current_head: headHash,
      commits_since_scan: 0,
      changes: { added: [], modified: [], deleted: [], renamed: [] },
      affected_sections: [],
      recommendation: 'No previous scan found. Full scan needed.',
    };
  }

  // Step 2: Get changes
  const diffResult = getChangesSinceTimestamp(repoRoot, lastScanned);

  if (!diffResult) {
    return {
      last_scanned: lastScanned,
      current_head: headHash,
      commits_since_scan: 0,
      changes: { added: [], modified: [], deleted: [], renamed: [] },
      affected_sections: [],
      recommendation: 'Scan timestamp older than git history. Full scan needed.',
    };
  }

  const { changes, commits_since_scan } = diffResult;

  // Cap at 50 per category
  const MAX = 50;
  const cappedChanges = {
    added: changes.added.length > MAX ? changes.added.slice(0, MAX) : changes.added,
    modified: changes.modified.length > MAX ? changes.modified.slice(0, MAX) : changes.modified,
    deleted: changes.deleted.length > MAX ? changes.deleted.slice(0, MAX) : changes.deleted,
    renamed: changes.renamed.length > MAX ? changes.renamed.slice(0, MAX) : changes.renamed,
  };

  const truncated =
    changes.added.length > MAX ||
    changes.modified.length > MAX ||
    changes.deleted.length > MAX ||
    changes.renamed.length > MAX;

  // Step 3: Map to sections
  const affectedSections = mapChangesToSections(changes);

  // Step 4: Recommendation
  const recommendation = generateRecommendation(changes, affectedSections);

  const result = {
    last_scanned: lastScanned,
    current_head: headHash,
    commits_since_scan,
    changes: cappedChanges,
    affected_sections: affectedSections,
    recommendation,
  };

  if (truncated) {
    result.truncated = true;
    result.total_changes = {
      added: changes.added.length,
      modified: changes.modified.length,
      deleted: changes.deleted.length,
      renamed: changes.renamed.length,
    };
  }

  return result;
}

function main() {
  const repoRoot = findRepoRoot(process.cwd());
  const contextDirFlag = getFlag('--context-dir');
  const contextDir = contextDirFlag
    ? path.resolve(contextDirFlag)
    : path.join(repoRoot, '.github', 'context');

  const result = runCodebaseDiff(contextDir, repoRoot);
  output(result);
}

if (require.main === module) {
  main();
}

module.exports = {
  runCodebaseDiff,
  extractLastScanTimestamp,
  getChangesSinceTimestamp,
  mapChangesToSections,
  mapFileToSections,
  generateRecommendation,
};
