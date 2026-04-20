#!/usr/bin/env node

/**
 * code-check.js — DevAgent Code Quality Check CLI
 *
 * Security, convention, performance, and test quality checks on changed files.
 * Merges review-prep.js scanning logic with git-based file detection.
 *
 * Usage:
 *   node code-check.js [--changed-only] [--concise]
 *   node code-check.js --security-only [--concise]
 *   node code-check.js --conventions-only [--concise]
 *
 * Hook integration (PostToolUse):
 *   Reads stdin JSON, checks only the edited file, outputs additionalContext.
 *   Exits immediately (<100ms) for non-file-edit tool invocations.
 *
 * Built with zero dependencies — only Node.js built-in modules.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

// Import scan logic from review-prep
const reviewPrep = require('./review-prep');

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

function execGitSafe(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
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
// HOOK: TOOL NAME FILTERING
// ─────────────────────────────────────────────────────────

const FILE_EDIT_TOOLS = new Set([
  'create_file',
  'replace_string_in_file',
  'multi_replace_string_in_file',
  'edit_notebook_file',
]);

/**
 * Extract file paths from tool input based on tool name.
 * VS Code uses camelCase property names (filePath, not file_path).
 */
function extractEditedFiles(toolName, toolInput) {
  if (!toolInput) return [];
  switch (toolName) {
    case 'replace_string_in_file':
    case 'create_file':
    case 'edit_notebook_file':
      return toolInput.filePath ? [toolInput.filePath] : [];
    case 'multi_replace_string_in_file':
      return (toolInput.replacements || [])
        .map(r => r.filePath)
        .filter(Boolean);
    default:
      return [];
  }
}

// ─────────────────────────────────────────────────────────
// FILE DETECTION
// ─────────────────────────────────────────────────────────

/**
 * Get files with uncommitted changes via git diff.
 * Replaces V1's getChangedFiles() which read code-changes.md.
 */
function getChangedFilesFromGit(repoRoot) {
  const unstaged = execGitSafe('git diff --name-only', repoRoot);
  const staged = execGitSafe('git diff --name-only --cached', repoRoot);
  const untracked = execGitSafe('git ls-files --others --exclude-standard', repoRoot);

  const files = new Set();
  for (const output of [unstaged, staged, untracked]) {
    if (output) {
      for (const line of output.split('\n')) {
        const f = line.trim();
        if (f) files.add(f);
      }
    }
  }

  return Array.from(files).map(file => ({ file, action: 'MODIFY' }));
}

/**
 * Build file list from specific paths (e.g., from hook tool_input).
 * Converts absolute paths to repo-relative.
 */
function getSpecificFiles(filePaths, repoRoot) {
  return filePaths
    .map(p => {
      const absPath = path.isAbsolute(p) ? p : path.join(repoRoot, p);
      const relPath = path.relative(repoRoot, absPath).replace(/\\/g, '/');
      return { file: relPath, action: 'MODIFY' };
    })
    .filter(({ file }) => {
      const fullPath = path.join(repoRoot, file);
      return fs.existsSync(fullPath);
    });
}

// ─────────────────────────────────────────────────────────
// FILE CONTENT READING
// ─────────────────────────────────────────────────────────

const MAX_FILE_LINES = 5000;

function isBinaryContent(content) {
  // Check for null bytes (binary indicator)
  return content.includes('\0');
}

function isMinifiedContent(content) {
  const lines = content.split('\n');
  if (lines.length < 3 && content.length > 5000) return true;
  const avgLineLength = content.length / Math.max(lines.length, 1);
  return avgLineLength > 500 && lines.length < 10;
}

/**
 * Read and prepare file contents for scanning.
 * Similar to review-prep's readFileContents but independent.
 */
function readFileContents(changedFiles, repoRoot) {
  const fileContents = [];

  for (const { file, action } of changedFiles) {
    if (action === 'DELETE' || action === 'READ') continue;

    const fullPath = path.join(repoRoot, file);
    const content = readFileSafe(fullPath);
    if (content === null || isBinaryContent(content) || isMinifiedContent(content)) continue;

    let scanContent = content;
    const lines = content.split('\n');
    if (lines.length > MAX_FILE_LINES) {
      const head = lines.slice(0, 2000).join('\n');
      const tail = lines.slice(-500).join('\n');
      scanContent = head + '\n/* ... truncated ... */\n' + tail;
    }

    fileContents.push({
      filePath: file,
      content: scanContent,
      isTest: reviewPrep.isTestFile(file),
      isEnvEx: /\.env\.example$/i.test(file),
    });
  }
  return fileContents;
}

// ─────────────────────────────────────────────────────────
// LANGUAGE DETECTION
// ─────────────────────────────────────────────────────────

/**
 * Detect language from conventions.json or file extensions.
 */
function detectLanguage(repoRoot, changedFiles) {
  // Try conventions.json first
  const convPath = path.join(repoRoot, '.github', 'context', 'conventions.json');
  const convContent = readFileSafe(convPath);
  if (convContent) {
    try {
      const conv = JSON.parse(convContent);
      if (conv.language?.primary) return conv.language.primary;
      if (conv.conventions?.language?.primary) return conv.conventions.language.primary;
    } catch { /* ignore parse errors */ }
  }

  // Fallback: detect from changed file extensions
  const extCounts = {};
  const extMap = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.java': 'java', '.go': 'go',
    '.rb': 'ruby', '.rs': 'rust', '.cs': 'csharp', '.php': 'php',
  };

  for (const { file } of changedFiles) {
    const ext = path.extname(file).toLowerCase();
    const lang = extMap[ext];
    if (lang) extCounts[lang] = (extCounts[lang] || 0) + 1;
  }

  let maxLang = 'javascript';
  let maxCount = 0;
  for (const [lang, count] of Object.entries(extCounts)) {
    if (count > maxCount) { maxLang = lang; maxCount = count; }
  }
  return maxLang;
}

// ─────────────────────────────────────────────────────────
// RUN CHECKS
// ─────────────────────────────────────────────────────────

function runChecks(fileContents, repoRoot, options = {}) {
  const contextDir = path.join(repoRoot, '.github', 'context');
  const language = detectLanguage(repoRoot, fileContents.map(f => ({ file: f.filePath })));

  const result = {
    files_scanned: fileContents.length,
    language_detected: language || 'unknown',
  };

  // Security scan
  if (!options.conventionsOnly) {
    const securityFindings = reviewPrep.securityScan(fileContents, language);
    result.security = {
      status: securityFindings.length === 0 ? 'clean' : 'issues_found',
      findings: securityFindings.length > 0 ? securityFindings : undefined,
    };
  }

  // Performance scan
  if (!options.securityOnly && !options.conventionsOnly) {
    const performanceFindings = reviewPrep.performanceScan(fileContents);
    result.performance = {
      status: performanceFindings.length === 0 ? 'clean' : 'warnings',
      findings: performanceFindings.length > 0 ? performanceFindings : undefined,
    };
  }

  // Convention scan
  if (!options.securityOnly) {
    const conventionResult = reviewPrep.conventionScan(fileContents, contextDir);
    result.conventions = {
      status: (conventionResult.violations || []).length === 0 ? 'clean' : 'violations_found',
      violations: (conventionResult.violations || []).length > 0 ? conventionResult.violations : undefined,
      note: conventionResult.note || undefined,
    };
  }

  // Test quality scan
  if (!options.securityOnly && !options.conventionsOnly) {
    const testResult = reviewPrep.testQualityScan(fileContents);
    result.test_quality = testResult;
  }

  // Summary
  const allFindings = [
    ...(result.security?.findings || []),
    ...(result.performance?.findings || []),
    ...(result.conventions?.violations || []),
    ...(result.test_quality?.issues || []),
  ];

  const blockers = allFindings.filter(f => f.severity === 'BLOCKER').length;
  const warnings = allFindings.filter(f => f.severity === 'WARNING').length;
  const suggestions = allFindings.filter(f => f.severity === 'SUGGESTION').length;

  let verdict = 'CLEAN';
  if (blockers > 0) verdict = 'CHANGES_REQUIRED';
  else if (warnings > 3) verdict = 'CHANGES_REQUIRED';
  else if (warnings > 0) verdict = 'APPROVED_WITH_WARNINGS';

  result.summary = { blockers, warnings, suggestions, verdict };

  return result;
}

// ─────────────────────────────────────────────────────────
// CONCISE FORMATTER
// ─────────────────────────────────────────────────────────

function formatFindingsConcise(result) {
  const allFindings = [
    ...(result.security?.findings || []),
    ...(result.performance?.findings || []),
    ...(result.conventions?.violations || []),
    ...(result.test_quality?.issues || []),
  ];

  if (allFindings.length === 0) return '';

  // Sort: BLOCKER first, then WARNING, then SUGGESTION
  // Use ?? (nullish coalescing) not || because BLOCKER=0 is falsy
  const order = { BLOCKER: 0, WARNING: 1, SUGGESTION: 2 };
  allFindings.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));

  const lines = [];
  for (const f of allFindings) {
    const severity = f.severity === 'BLOCKER' ? 'CRITICAL' : (f.severity || 'INFO');
    const location = f.line ? `${f.file}:${f.line}` : (f.file || 'unknown');
    const desc = f.category || f.fix || 'Issue found';
    lines.push(`${severity}: ${desc} in ${location}`);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────

function main() {
  const hookInput = readHookInput();
  const isConcise = hasFlag('--concise');
  const changedOnly = hasFlag('--changed-only');
  const securityOnly = hasFlag('--security-only');
  const conventionsOnly = hasFlag('--conventions-only');
  const repoRoot = findRepoRoot(process.cwd());

  // ── Hook mode: fast exit for non-file-edit tools ──
  if (hookInput && hookInput.tool_name) {
    if (!FILE_EDIT_TOOLS.has(hookInput.tool_name)) {
      process.exit(0);
    }

    const editedFiles = extractEditedFiles(hookInput.tool_name, hookInput.tool_input);
    if (editedFiles.length === 0) {
      process.exit(0);
    }

    const changedFiles = getSpecificFiles(editedFiles, repoRoot);
    if (changedFiles.length === 0) {
      process.exit(0);
    }

    const fileContents = readFileContents(changedFiles, repoRoot);
    if (fileContents.length === 0) {
      process.exit(0);
    }

    const result = runChecks(fileContents, repoRoot);
    const concise = formatFindingsConcise(result);

    if (concise) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: hookInput.hookEventName || 'PostToolUse',
          additionalContext: concise,
        },
      }));
    }
    // No output = no findings = silent
    return;
  }

  // ── CLI mode ──
  const changedFiles = getChangedFilesFromGit(repoRoot);

  if (changedFiles.length === 0) {
    if (!isConcise) {
      console.log(JSON.stringify({
        files_scanned: 0,
        summary: { blockers: 0, warnings: 0, suggestions: 0, verdict: 'CLEAN' },
      }, null, 2));
    }
    // Concise mode: silent when clean
    return;
  }

  const fileContents = readFileContents(changedFiles, repoRoot);

  if (fileContents.length === 0) {
    if (!isConcise) {
      console.log(JSON.stringify({
        files_scanned: 0,
        note: 'Changed files are binary or unreadable',
        summary: { blockers: 0, warnings: 0, suggestions: 0, verdict: 'CLEAN' },
      }, null, 2));
    }
    return;
  }

  const result = runChecks(fileContents, repoRoot, { securityOnly, conventionsOnly });

  if (isConcise) {
    const concise = formatFindingsConcise(result);
    if (concise) console.log(concise);
    // Silent when clean
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getChangedFilesFromGit,
  getSpecificFiles,
  readFileContents,
  runChecks,
  formatFindingsConcise,
  extractEditedFiles,
  FILE_EDIT_TOOLS,
};
