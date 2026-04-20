#!/usr/bin/env node

/**
 * project-context.js — DevAgent Project Context CLI
 *
 * Unified entry point for project convention scanning and change detection.
 * Merges convention-scanner.js and codebase-diff.js into a single tool.
 *
 * Commands:
 *   scan [--focus <area>] [--concise]   Full convention scan
 *   diff [--concise]                     Changes since last scan
 *   conventions [--focus <area>]         Just conventions output
 *   structure                            Project structure overview
 *
 * Hook integration:
 *   When called from a VS Code hook (stdin JSON with hookEventName),
 *   outputs hook-compatible JSON with additionalContext.
 *   When called from CLI, outputs text (--concise) or JSON (default).
 *
 * Built with zero dependencies — only Node.js built-in modules.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

// Import core logic from existing scripts
const scanner = require('./convention-scanner');
const codeDiff = require('./codebase-diff');

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

function hasFlag(name) {
  return process.argv.includes(name);
}

function getFlag(name) {
  const idx = process.argv.indexOf(name);
  return (idx !== -1 && idx + 1 < process.argv.length) ? process.argv[idx + 1] : null;
}

function getCommand() {
  for (let i = 2; i < process.argv.length; i++) {
    if (!process.argv[i].startsWith('-')) return process.argv[i];
  }
  return null;
}

/**
 * Read hook input from stdin (VS Code pipes JSON to hooks).
 * Returns null when called from CLI (stdin is a TTY).
 */
function readHookInput() {
  if (process.stdin.isTTY) return null;
  try {
    const data = fs.readFileSync(0, 'utf-8').trim();
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// CONCISE FORMATTERS
// ─────────────────────────────────────────────────────────

function formatScanConcise(result) {
  const lang = result.conventions?.language;
  const testing = result.conventions?.testing;
  const codeStyle = result.conventions?.code_style;
  const project = result.conventions?.project;
  const parts = [];

  // Line 1: Project identity
  const langStr = lang
    ? [lang.primary, ...(lang.secondary || [])].filter(Boolean).join('/')
    : 'unknown';
  const testStr = testing?.framework || 'unknown';
  const styleTools = [];
  if (codeStyle?.eslint) styleTools.push('ESLint');
  if (codeStyle?.prettier) styleTools.push('Prettier');
  const styleStr = styleTools.length > 0 ? styleTools.join('+') : null;

  let line1 = `Project: ${langStr} | Test: ${testStr}`;
  if (styleStr) line1 += ` | Style: ${styleStr}`;
  parts.push(line1);

  // Line 2: Key conventions
  const naming = result.conventions?.naming;
  const imports = result.conventions?.imports;
  const convParts = [];
  if (codeStyle?.quotes) convParts.push(`${codeStyle.quotes} quotes`);
  if (codeStyle?.indent) convParts.push(`${codeStyle.indent}-space indent`);
  if (naming?.functions?.dominant) convParts.push(`${naming.functions.dominant} functions`);
  if (imports?.style) convParts.push(imports.style);

  if (convParts.length > 0) {
    parts.push(`Conventions: ${convParts.join(', ')}`);
  }

  // Line 3: Project tools
  if (project) {
    const projParts = [];
    if (project.package_manager) projParts.push(project.package_manager);
    if (project.build_command) projParts.push(`build: ${project.build_command}`);
    if (project.test_command) projParts.push(`test: ${project.test_command}`);
    if (projParts.length > 0) parts.push(`Tools: ${projParts.join(' | ')}`);
  }

  return parts.join('\n');
}

function formatDiffConcise(result) {
  if (!result.last_scanned) {
    return 'No previous scan found. Run /codebase-explore to initialize project knowledge.';
  }

  const changes = result.changes || {};
  const totalChanged = (changes.added?.length || 0) + (changes.modified?.length || 0) +
    (changes.deleted?.length || 0) + (changes.renamed?.length || 0);

  if (totalChanged === 0) {
    return 'No changes since last scan.';
  }

  const allFiles = [
    ...(changes.added || []),
    ...(changes.modified || []),
    ...(changes.deleted || []),
    ...(changes.renamed || []).map(r => typeof r === 'object' ? (r.to || r.from) : r),
  ];

  const fileList = allFiles.length <= 5
    ? allFiles.join(', ')
    : `${allFiles.slice(0, 4).join(', ')} +${allFiles.length - 4} more`;

  const parts = [];
  parts.push(`Changed since last scan: ${totalChanged} files (${fileList})`);

  if (result.affected_sections?.length > 0) {
    parts.push(`Affected: ${result.affected_sections.join(', ')}`);
  }
  if (result.recommendation) {
    parts.push(result.recommendation);
  }

  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────
// STRUCTURE COMMAND
// ─────────────────────────────────────────────────────────

const STRUCTURE_EXCLUDE = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__',
  '.next', '.nuxt', 'vendor', '.venv', 'venv', '.tox', 'target',
  '.cache', 'tmp', '.tmp', '_archive',
]);

function getProjectStructure(repoRoot) {
  const tree = [];
  const keyFiles = [];

  function walk(dir, prefix, depth) {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    // Sort: dirs first, then files, alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (STRUCTURE_EXCLUDE.has(entry.name)) continue;
      // Skip hidden files/dirs at depth 0 except .github
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;

      const relPath = path.relative(repoRoot, path.join(dir, entry.name));

      if (entry.isDirectory()) {
        tree.push(`${prefix}${entry.name}/`);
        walk(path.join(dir, entry.name), prefix + '  ', depth + 1);
      } else {
        tree.push(`${prefix}${entry.name}`);
        // Tag key files
        const name = entry.name.toLowerCase();
        if (name === 'package.json' && depth === 0) keyFiles.push({ path: relPath, role: 'manifest' });
        if (/^(index|main|app)\.(ts|js|py|go)$/.test(name)) keyFiles.push({ path: relPath, role: 'entry' });
        if (/^(tsconfig|\.eslintrc|\.prettierrc|\.editorconfig)/.test(name)) keyFiles.push({ path: relPath, role: 'config' });
        if (/^(\.gitlab-ci|jenkinsfile)/i.test(name)) keyFiles.push({ path: relPath, role: 'ci' });
        if (name === 'readme.md') keyFiles.push({ path: relPath, role: 'docs' });
      }
    }
  }

  walk(repoRoot, '', 0);
  return { tree, key_files: keyFiles };
}

// ─────────────────────────────────────────────────────────
// OUTPUT HELPER
// ─────────────────────────────────────────────────────────

function outputResult(hookInput, conciseText, fullResult) {
  if (hookInput && hookInput.hookEventName) {
    // Hook mode → hook-compatible JSON
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: hookInput.hookEventName,
        additionalContext: conciseText || '',
      },
    }));
  } else if (conciseText !== null && conciseText !== undefined) {
    // CLI concise → plain text
    console.log(conciseText);
  } else {
    // CLI verbose → full JSON
    console.log(JSON.stringify(fullResult, null, 2));
  }
}

// ─────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────

function main() {
  const command = getCommand();
  const isConcise = hasFlag('--concise');
  const focusArea = getFlag('--focus') || 'all';
  const hookInput = readHookInput();
  const repoRoot = findRepoRoot(process.cwd());

  switch (command) {
    case 'scan': {
      const result = scanner.runScan(repoRoot, focusArea);
      if (!result) {
        console.error(`Invalid focus area: "${focusArea}". Valid: all, code, testing, git, imports, errors`);
        process.exit(1);
      }
      const concise = (isConcise || hookInput) ? formatScanConcise(result) : null;
      outputResult(hookInput, concise, result);
      break;
    }

    case 'diff': {
      const contextDir = path.join(repoRoot, '.github', 'context');
      const result = codeDiff.runCodebaseDiff(contextDir, repoRoot);
      const concise = (isConcise || hookInput) ? formatDiffConcise(result) : null;
      outputResult(hookInput, concise, result);
      break;
    }

    case 'conventions': {
      const result = scanner.runScan(repoRoot, focusArea);
      if (!result) {
        console.error(`Invalid focus area: "${focusArea}"`);
        process.exit(1);
      }
      const conventions = result.conventions || {};
      if (isConcise) {
        console.log(formatScanConcise(result));
      } else {
        console.log(JSON.stringify(conventions, null, 2));
      }
      break;
    }

    case 'structure': {
      const result = getProjectStructure(repoRoot);
      if (isConcise) {
        const keyFileSummary = result.key_files.map(f => `[${f.role}] ${f.path}`).join('\n');
        console.log(keyFileSummary || 'No key files identified.');
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
      break;
    }

    default:
      console.error('Usage: node project-context.js <command> [options]');
      console.error('Commands: scan, diff, conventions, structure');
      console.error('Options: --focus <area>, --concise');
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  formatScanConcise,
  formatDiffConcise,
  getProjectStructure,
};
