#!/usr/bin/env node

/**
 * context-tool.js — DevAgent Context Management CLI
 *
 * Handles all context file mechanics: setup, init, status, archive,
 * validate, checkpoint, rollback, search, history, suspend, resume, compact.
 *
 * Usage: node .github/scripts/context-tool.js <command> [args]
 *
 * Built with zero dependencies — only Node.js built-in modules (fs, path).
 */

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────
// CONFIGURABLE CONSTANTS — tune these based on real usage
// ─────────────────────────────────────────────────────────

const CODEBASE_INTEL_MAX_LINES = 400;    // Trigger compaction above this
const CODEBASE_INTEL_TARGET_LINES = 300; // Compact down to this
const TASK_INDEX_MAX_ENTRIES = 50;        // Split index above this
const TASK_INDEX_RECENT_KEEP = 20;        // Keep this many in active index
const COMPACT_EVERY_N_TASKS = 5;          // Auto-compact trigger
const RESEARCH_FINDINGS_MAX_LINES = 500;  // Archive if exceeds (per-task)

// ─────────────────────────────────────────────────────────
// PATH RESOLUTION
// ─────────────────────────────────────────────────────────

// Support --context-dir flag for separate repo approach
const contextDirFlag = getFlag('--context-dir');

// Resolve base paths
const REPO_ROOT = findRepoRoot(process.cwd());
const SCRIPTS_DIR = path.join(REPO_ROOT, '.github', 'scripts');
const CONTEXT_DIR = contextDirFlag
  ? path.resolve(contextDirFlag)
  : path.join(REPO_ROOT, '.github', 'context');
const TEMPLATES_DIR = path.join(CONTEXT_DIR, '_templates');
const ARCHIVE_DIR = path.join(CONTEXT_DIR, 'archive');
const CHECKPOINTS_DIR = path.join(CONTEXT_DIR, 'checkpoints');

// Context file names (task-level — copied from templates per task)
const TASK_LEVEL_FILES = [
  'task-status.md',
  'requirements.md',
  'implementation-plan.md',
  'code-changes.md',
  'test-results.md',
  'review-report.md',
  'git-status.md',
  'research-findings.md',
  'decisions-and-blockers.md',
];

// Persistent file (NOT a template — created directly by setup)
const PERSISTENT_FILE = 'codebase-intel.md';

// ─────────────────────────────────────────────────────────
// TEMPLATE CONTENTS
// ─────────────────────────────────────────────────────────

const TEMPLATES = {
  'task-status.md': `# Task Status

**Task ID**: (pending)
**Status**: idle
**Started**: (pending)
**Last Updated**: (pending)
**Current Phase**: (none)
**Phase Progress**: (none)
**Previous Task**: (none)
**Context Profile**: (pending)

## Phase History
| Phase | Started | Completed | Agent | Notes |
|-------|---------|-----------|-------|-------|
`,

  'requirements.md': `# Requirements

**Task ID**: (pending)
**Last Updated**: (pending)
**Updated By**: Story Analyst

## User Story Summary
(To be filled by Story Analyst)

## Acceptance Criteria
1. (To be filled by Story Analyst)

## Questions & Clarifications
(None yet)
`,

  'implementation-plan.md': `# Implementation Plan

**Task ID**: (pending)
**Last Updated**: (pending)
**Updated By**: Architect Planner

## Approach Summary
(To be filled by Architect Planner)

## File-by-File Plan
(To be filled by Architect Planner)

## Risk Assessment
(To be filled by Architect Planner)
`,

  'code-changes.md': `# Code Changes

**Task ID**: (pending)
**Last Updated**: (pending)
**Updated By**: Developer

## Files Changed
| File | Action | What Changed | Why |
|------|--------|-------------|-----|

## Deviations from Plan
(None yet)
`,

  'test-results.md': `# Test Results

**Task ID**: (pending)
**Last Updated**: (pending)
**Updated By**: Tester

## Tests Written
(To be filled by Tester)

## Pass/Fail Count
- **Total**: 0
- **Passing**: 0
- **Failing**: 0

## Acceptance Criteria Mapping
| Criteria # | Test | Status |
|-----------|------|--------|
`,

  'review-report.md': `# Review Report

**Task ID**: (pending)
**Last Updated**: (pending)
**Updated By**: Reviewer

## Verdict
(To be filled by Reviewer)

## Issues Found
(None yet)

## Requirements Verified
| Requirement | Verified | Notes |
|------------|----------|-------|
`,

  'git-status.md': `# Git Status

**Task ID**: (pending)
**Last Updated**: (pending)
**Updated By**: Git Manager

## Branch Name
(To be filled by Git Manager)

## Commit List
(None yet)

## Push Status
(Not pushed)
`,

  'research-findings.md': `# Research Findings

**Task ID**: (pending)
**Last Updated**: (pending)
**Updated By**: Researcher

<!-- This file accumulates WITHIN a task (multiple entries appended).
     At task completion, the entire file is archived and reset for the next task. -->
`,

  'decisions-and-blockers.md': `# Decisions and Blockers

**Task ID**: (pending)
**Last Updated**: (pending)
**Updated By**: Coordinator

## Decision Log
| # | Decision | Reason | Date | Agent |
|---|----------|--------|------|-------|

## Open Blockers
(None)
`,
};

const CODEBASE_INTEL_INITIAL = `# Codebase Intelligence

**Last Updated**: (pending)
**Updated By**: Codebase Explorer

<!-- This file persists across tasks. It is NOT reset per task. -->
<!-- Codebase Explorer updates relevant sections after code changes. -->

## Tech Stack
(To be filled by Codebase Explorer on first scan)

## Project Structure
(To be filled by Codebase Explorer on first scan)

## Key Conventions
(To be filled by Codebase Explorer on first scan)
`;

const TASK_INDEX_INITIAL = `# Task Index

| Task ID | Date | Status | Summary | Files Changed | Tags |
|---------|------|--------|---------|---------------|------|
`;

// ─────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.github'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  // Fallback: use cwd
  return path.resolve(startDir);
}

function getFlag(flagName) {
  const idx = process.argv.indexOf(flagName);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return null;
}

function getProfileFlag() {
  return getFlag('--profile') || 'standard';
}

function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function countLines(filePath) {
  const content = readFileContent(filePath);
  if (!content) return 0;
  return content.split('\n').length;
}

function output(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function fail(message) {
  output({ error: true, message });
  process.exit(1);
}

/**
 * Parse the YAML-like frontmatter from a context file.
 * Reads lines matching **Key**: Value pattern.
 */
function parseContextHeaders(content) {
  const headers = {};
  if (!content) return headers;
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\*\*(.+?)\*\*:\s*(.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
      headers[key] = match[2].trim();
    }
  }
  return headers;
}

/**
 * Generate a Task ID from a short name.
 * Format: TASK-{YYYY-MM-DD}-{short-kebab-name}
 */
function generateTaskId(name) {
  const kebab = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 5)
    .join('-');

  const base = `TASK-${today()}-${kebab}`;

  // Check for duplicates in archive
  const indexPath = path.join(ARCHIVE_DIR, 'task-index.md');
  if (fileExists(indexPath)) {
    const indexContent = readFileContent(indexPath);
    if (indexContent && indexContent.includes(base)) {
      // Find the next available suffix
      let suffix = 2;
      while (indexContent.includes(`${base}-${suffix}`)) {
        suffix++;
      }
      return `${base}-${suffix}`;
    }
  }

  return base;
}

/**
 * Stamp a template with Task ID and timestamp.
 */
function stampTemplate(content, taskId) {
  const timestamp = now();
  return content
    .replace(/\*\*Task ID\*\*: \(pending\)/g, `**Task ID**: ${taskId}`)
    .replace(/\*\*Last Updated\*\*: \(pending\)/g, `**Last Updated**: ${timestamp}`)
    .replace(/\*\*Started\*\*: \(pending\)/g, `**Started**: ${timestamp}`);
}

// ─────────────────────────────────────────────────────────
// COMMAND: setup
// Creates the full folder structure and templates from scratch.
// One-time operation for first-time repos.
// ─────────────────────────────────────────────────────────

function cmdSetup() {
  const foldersCreated = [];
  const templatesCreated = [];

  // Create directories
  for (const dir of [CONTEXT_DIR, TEMPLATES_DIR, ARCHIVE_DIR, CHECKPOINTS_DIR]) {
    ensureDir(dir);
    foldersCreated.push(path.basename(dir));
  }

  // Create 9 task-level templates
  for (const [filename, content] of Object.entries(TEMPLATES)) {
    const filePath = path.join(TEMPLATES_DIR, filename);
    if (!fileExists(filePath)) {
      writeFile(filePath, content);
      templatesCreated.push(filename);
    }
  }

  // Create persistent codebase-intel.md (NOT a template)
  const codebaseIntelPath = path.join(CONTEXT_DIR, PERSISTENT_FILE);
  const persistentCreated = [];
  if (!fileExists(codebaseIntelPath)) {
    writeFile(codebaseIntelPath, CODEBASE_INTEL_INITIAL);
    persistentCreated.push(PERSISTENT_FILE);
  }

  // Create empty task-index.md
  const taskIndexPath = path.join(ARCHIVE_DIR, 'task-index.md');
  if (!fileExists(taskIndexPath)) {
    writeFile(taskIndexPath, TASK_INDEX_INITIAL);
  }

  // Create idle task-status.md so `status` command works immediately
  const taskStatusPath = path.join(CONTEXT_DIR, 'task-status.md');
  if (!fileExists(taskStatusPath)) {
    const idleStatus = `# Task Status

**Task ID**: (none)
**Status**: idle
**Started**: (none)
**Last Updated**: ${now()}
**Current Phase**: (none)
**Phase Progress**: (none)
**Previous Task**: (none)
**Context Profile**: (none)

## Phase History
| Phase | Started | Completed | Agent | Notes |
|-------|---------|-----------|-------|-------|
`;
    writeFile(taskStatusPath, idleStatus);
  }

  output({
    setup: 'complete',
    templates_created: templatesCreated.length,
    persistent_files_created: persistentCreated,
    folders_created: foldersCreated,
    ready: true,
  });
}

// ─────────────────────────────────────────────────────────
// COMMAND: init <name> [--profile <profile>]
// Generates Task ID, copies templates to active context,
// sets status to active.
// ─────────────────────────────────────────────────────────

function cmdInit() {
  const name = process.argv[3];
  if (!name || name.startsWith('--')) {
    fail('Usage: context-tool init <task-name> [--profile <profile>]');
  }

  // Verify setup has been done
  if (!fileExists(TEMPLATES_DIR)) {
    fail('Templates not found. Run `context-tool setup` first.');
  }

  // Check for active/suspended task
  const statusPath = path.join(CONTEXT_DIR, 'task-status.md');
  if (fileExists(statusPath)) {
    const content = readFileContent(statusPath);
    const headers = parseContextHeaders(content);
    const currentStatus = headers.status;
    if (currentStatus === 'active') {
      fail(
        `Active task detected: ${headers.task_id || '(unknown)'}. ` +
        'Archive or suspend it before starting a new task. ' +
        'Run `context-tool archive --abandoned` or `context-tool suspend "reason"`.'
      );
    }
    if (currentStatus === 'suspended') {
      fail(
        `Suspended task detected: ${headers.task_id || '(unknown)'}. ` +
        'Archive or resume it before starting a new task. ' +
        'Run `context-tool archive --abandoned` or `context-tool resume`.'
      );
    }
  }

  const profile = getProfileFlag();
  const taskId = generateTaskId(name);
  const timestamp = now();

  // Determine previous task from current task-status
  let previousTask = '(none)';
  if (fileExists(statusPath)) {
    const content = readFileContent(statusPath);
    const headers = parseContextHeaders(content);
    if (headers.previous_task && headers.previous_task !== '(none)') {
      previousTask = headers.previous_task;
    } else if (headers.task_id && headers.task_id !== '(none)') {
      previousTask = `${headers.task_id} (${headers.status || 'unknown'})`;
    }
  }

  // Copy templates to active context
  const filesCreated = [];
  for (const filename of TASK_LEVEL_FILES) {
    const templatePath = path.join(TEMPLATES_DIR, filename);
    const targetPath = path.join(CONTEXT_DIR, filename);

    if (!fileExists(templatePath)) {
      // If template missing, use embedded template
      const embeddedContent = TEMPLATES[filename];
      if (embeddedContent) {
        writeFile(targetPath, stampTemplate(embeddedContent, taskId));
        filesCreated.push(filename);
      }
    } else {
      const content = readFileContent(templatePath);
      writeFile(targetPath, stampTemplate(content, taskId));
      filesCreated.push(filename);
    }
  }

  // Write the active task-status.md with full info
  const taskStatusContent = `# Task Status

**Task ID**: ${taskId}
**Status**: active
**Started**: ${timestamp}
**Last Updated**: ${timestamp}
**Current Phase**: Phase 1: REQUIREMENTS
**Phase Progress**: Waiting for Story Analyst
**Previous Task**: ${previousTask}
**Context Profile**: ${profile}

## Phase History
| Phase | Started | Completed | Agent | Notes |
|-------|---------|-----------|-------|-------|
| Phase 1 | ${timestamp} | — | Story Analyst | In progress |
`;

  writeFile(path.join(CONTEXT_DIR, 'task-status.md'), taskStatusContent);

  output({
    initialized: taskId,
    profile,
    files_created: filesCreated.length,
    status: 'active',
    current_phase: 1,
    phase_name: 'REQUIREMENTS',
    previous_task: previousTask,
  });
}

// ─────────────────────────────────────────────────────────
// COMMAND: status
// Returns current task state as JSON. Used by Coordinator
// at conversation start and for "where are we?" queries.
// ─────────────────────────────────────────────────────────

function cmdStatus() {
  const statusPath = path.join(CONTEXT_DIR, 'task-status.md');

  // Check if setup has been done
  if (!fileExists(CONTEXT_DIR) || !fileExists(TEMPLATES_DIR)) {
    output({
      status: 'not_initialized',
      setup_needed: true,
      suggestion: 'Context system not set up. Run `context-tool setup` first.',
    });
    return;
  }

  // Check if task-status.md exists
  if (!fileExists(statusPath)) {
    output({
      status: 'idle',
      task_id: null,
      setup_needed: false,
      suggestion: 'No active task. Ready to accept a new task.',
    });
    return;
  }

  const content = readFileContent(statusPath);
  if (!content) {
    output({
      status: 'orphaned',
      suggestion: 'task-status.md exists but is empty or unreadable. Investigate or archive.',
    });
    return;
  }

  const headers = parseContextHeaders(content);
  const status = headers.status || 'unknown';
  const taskId = headers.task_id || null;
  const currentPhase = headers.current_phase || '(none)';
  const phaseProgress = headers.phase_progress || '(none)';
  const previousTask = headers.previous_task || '(none)';
  const profile = headers.context_profile || 'standard';
  const started = headers.started || null;
  const lastUpdated = headers.last_updated || null;

  // Parse phase number from "Phase N: NAME"
  let phaseNum = null;
  let phaseName = null;
  const phaseMatch = currentPhase.match(/Phase\s+(\d+):\s*(.+)/i);
  if (phaseMatch) {
    phaseNum = parseInt(phaseMatch[1], 10);
    phaseName = phaseMatch[2].trim();
  }

  // Check codebase refresh needed (look for the flag in headers or idle status)
  const codebaseRefreshNeeded = headers.codebase_refresh_needed === 'true';

  // Count tasks since last compact
  let tasksSinceCompact = 0;
  const indexPath = path.join(ARCHIVE_DIR, 'task-index.md');
  if (fileExists(indexPath)) {
    const indexContent = readFileContent(indexPath);
    if (indexContent) {
      // Count data rows (lines with | that aren't the header)
      const lines = indexContent.split('\n').filter(
        (l) => l.startsWith('|') && !l.includes('Task ID') && !l.includes('---')
      );
      tasksSinceCompact = lines.length % COMPACT_EVERY_N_TASKS;
    }
  }

  // Count codebase-intel.md lines
  const codebaseIntelPath = path.join(CONTEXT_DIR, PERSISTENT_FILE);
  const codebaseIntelLines = fileExists(codebaseIntelPath)
    ? countLines(codebaseIntelPath)
    : 0;

  // Count total archived tasks
  let archiveTaskCount = 0;
  if (fileExists(indexPath)) {
    const indexContent = readFileContent(indexPath);
    if (indexContent) {
      archiveTaskCount = indexContent.split('\n').filter(
        (l) => l.startsWith('| TASK-')
      ).length;
    }
  }

  // Detect context files that exist
  const existingFiles = TASK_LEVEL_FILES.filter((f) =>
    fileExists(path.join(CONTEXT_DIR, f))
  );
  if (fileExists(codebaseIntelPath)) {
    existingFiles.push(PERSISTENT_FILE);
  }

  // Detect available checkpoints
  const checkpoints = [];
  if (fileExists(CHECKPOINTS_DIR)) {
    try {
      const dirs = fs.readdirSync(CHECKPOINTS_DIR, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.startsWith('phase-')) {
          checkpoints.push(d.name);
        }
      }
    } catch {
      // ignore read errors
    }
  }

  // Build suggestion based on status
  let suggestion = '';
  switch (status) {
    case 'idle':
      suggestion = 'No active task. Ready to accept a new task.';
      break;
    case 'active':
      suggestion = `Task was active when session ended. Ask user: resume, abandon, or review?`;
      break;
    case 'suspended':
      suggestion = `Task was explicitly suspended. Ask user: resume or abandon?`;
      break;
    case 'completed':
      suggestion = `Task completed but not archived. Run \`context-tool archive\` to clean up.`;
      break;
    default:
      suggestion = `Unknown status "${status}". Investigate context files.`;
  }

  // Check for orphaned files (files exist but status is idle/unknown)
  if (status === 'idle' && existingFiles.length > 2) {
    // More than just task-status.md and codebase-intel.md
    suggestion = 'Orphaned context files detected from a previous task. Archive or investigate.';
  }

  // Calculate days since last update (for stale detection)
  let daysSinceUpdate = null;
  if (lastUpdated && lastUpdated !== '(pending)' && lastUpdated !== '(none)') {
    try {
      const updateDate = new Date(lastUpdated);
      const nowDate = new Date();
      daysSinceUpdate = Math.floor(
        (nowDate.getTime() - updateDate.getTime()) / (1000 * 60 * 60 * 24)
      );
    } catch {
      // ignore date parse errors
    }
  }

  // Build last_task_changed_files from previous task archive if needed
  let lastTaskChangedFiles = [];
  if (codebaseRefreshNeeded && previousTask && previousTask !== '(none)') {
    const prevTaskId = previousTask.replace(/\s*\(.+\)\s*$/, '');
    const prevCodeChanges = path.join(ARCHIVE_DIR, prevTaskId, 'code-changes.md');
    if (fileExists(prevCodeChanges)) {
      const ccContent = readFileContent(prevCodeChanges);
      if (ccContent) {
        // Extract file paths from the table rows
        const fileMatches = ccContent.matchAll(/\|\s*`?([^|`]+\.\w+)`?\s*\|/g);
        for (const m of fileMatches) {
          const fp = m[1].trim();
          if (fp && !fp.includes('File') && !fp.includes('---')) {
            lastTaskChangedFiles.push(fp);
          }
        }
      }
    }
  }

  output({
    status,
    task_id: taskId === '(none)' ? null : taskId,
    phase: phaseNum,
    phase_name: phaseName,
    phase_progress: phaseProgress !== '(none)' ? phaseProgress : null,
    context_profile: profile !== '(none)' ? profile : null,
    started,
    last_updated: lastUpdated,
    days_since_update: daysSinceUpdate,
    previous_task: previousTask !== '(none)' ? previousTask : null,
    codebase_refresh_needed: codebaseRefreshNeeded,
    last_task_changed_files: lastTaskChangedFiles.length > 0 ? lastTaskChangedFiles : null,
    tasks_since_compact: tasksSinceCompact,
    codebase_intel_lines: codebaseIntelLines,
    archive_task_count: archiveTaskCount,
    existing_context_files: existingFiles,
    checkpoints: checkpoints.length > 0 ? checkpoints : null,
    suggested_default: profile !== '(none)' ? profile : 'standard',
    setup_needed: false,
    suggestion,
  });
}

// ─────────────────────────────────────────────────────────
// COMMAND: archive [--abandoned]
// Archives a completed or abandoned task:
//   1. Reads context files, extracts metadata
//   2. Generates manifest.md (summary card)
//   3. Creates archive folder, moves all task files
//   4. Appends entry to task-index.md
//   5. Cleans up checkpoints
//   6. Resets task-status.md to idle
// ─────────────────────────────────────────────────────────

function cmdArchive() {
  const isAbandoned = process.argv.includes('--abandoned');

  // Read current task-status.md
  const statusPath = path.join(CONTEXT_DIR, 'task-status.md');
  if (!fileExists(statusPath)) {
    fail('No task-status.md found. Nothing to archive.');
  }

  const statusContent = readFileContent(statusPath);
  if (!statusContent) {
    fail('task-status.md is empty or unreadable.');
  }

  const statusHeaders = parseContextHeaders(statusContent);
  const taskId = statusHeaders.task_id;
  const currentStatus = statusHeaders.status;

  // Guard: must have a real task to archive
  if (!taskId || taskId === '(none)') {
    fail('No active task to archive. task-status.md has no Task ID.');
  }

  if (currentStatus === 'idle') {
    fail('Task is already idle. Nothing to archive.');
  }

  const archiveStatus = isAbandoned ? 'abandoned' : 'completed';

  // Gather metadata from all context files
  const contextData = {};
  for (const filename of TASK_LEVEL_FILES) {
    const filePath = path.join(CONTEXT_DIR, filename);
    if (fileExists(filePath)) {
      contextData[filename] = {
        content: readFileContent(filePath),
        headers: parseContextHeaders(readFileContent(filePath)),
      };
    }
  }

  // Extract summary from requirements.md
  let summary = '(no summary)';
  if (contextData['requirements.md']) {
    const reqContent = contextData['requirements.md'].content;
    // Try to extract from "## User Story Summary" section
    const summaryMatch = reqContent.match(
      /## User Story Summary\s*\n([\s\S]*?)(?=\n##|\n\*\*|$)/
    );
    if (summaryMatch) {
      const rawSummary = summaryMatch[1].trim();
      if (rawSummary && !rawSummary.startsWith('(To be filled')) {
        // Take first line or first 120 chars
        summary = rawSummary.split('\n')[0].slice(0, 120);
      }
    }
  }

  // Extract files changed from code-changes.md
  let filesChanged = [];
  let filesChangedCount = 0;
  let codebaseRefreshNeeded = false;
  if (contextData['code-changes.md']) {
    const ccContent = contextData['code-changes.md'].content;
    // Parse table rows: | filename | action | ...
    const rows = ccContent.split('\n').filter((l) => {
      return l.startsWith('|') && !l.includes('File') && !l.includes('---') && !l.includes('Action');
    });
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        const file = cells[0].replace(/`/g, '');
        const action = cells[1];
        if (file && file.includes('.')) {
          filesChanged.push({ file, action });
        }
      }
    }
    filesChangedCount = filesChanged.length;
    codebaseRefreshNeeded = filesChangedCount > 0;
  }

  // Extract key decisions from decisions-and-blockers.md
  let decisions = [];
  if (contextData['decisions-and-blockers.md']) {
    const dbContent = contextData['decisions-and-blockers.md'].content;
    const rows = dbContent.split('\n').filter((l) => {
      return l.startsWith('|') && !l.includes('Decision') && !l.includes('---') && !l.includes('#');
    });
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        decisions.push(`${cells[1]} (${cells[2] || ''})`);
      }
    }
  }

  // Extract tags — derive from summary + file types + key decisions
  const tags = deriveTaskTags(summary, filesChanged, decisions, contextData);

  // Extract outcome from review-report.md or git-status.md
  let outcome = '(no outcome recorded)';
  if (contextData['review-report.md']) {
    const rrContent = contextData['review-report.md'].content;
    const verdictMatch = rrContent.match(/## Verdict\s*\n([\s\S]*?)(?=\n##|$)/);
    if (verdictMatch) {
      const rawVerdict = verdictMatch[1].trim();
      if (rawVerdict && !rawVerdict.startsWith('(To be filled')) {
        outcome = rawVerdict.split('\n')[0].slice(0, 200);
      }
    }
  }
  if (outcome === '(no outcome recorded)' && contextData['git-status.md']) {
    const gsContent = contextData['git-status.md'].content;
    const gsHeaders = contextData['git-status.md'].headers;
    if (gsHeaders.branch_name && gsHeaders.branch_name !== '(To be filled by Git Manager)') {
      outcome = `Branch: ${gsHeaders.branch_name}`;
      const pushMatch = gsContent.match(/## Push Status\s*\n([\s\S]*?)(?=\n##|$)/);
      if (pushMatch) {
        const pushText = pushMatch[1].trim();
        if (pushText && pushText !== '(Not pushed)') {
          outcome += `. ${pushText.split('\n')[0]}`;
        }
      }
    }
  }

  // Determine final phase reached
  const finalPhase = statusHeaders.current_phase || '(unknown)';

  // Calculate duration
  const started = statusHeaders.started;
  let duration = '(unknown)';
  if (started && started !== '(none)' && started !== '(pending)') {
    try {
      const startDate = new Date(started);
      const endDate = new Date();
      const diffMs = endDate.getTime() - startDate.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 60) {
        duration = `${diffMins}m`;
      } else {
        const hours = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        duration = `${hours}h ${mins}m`;
      }
    } catch {
      // ignore date errors
    }
  }

  // ── Generate manifest.md ──

  const filesChangedSection = filesChanged.length > 0
    ? filesChanged.map((f) => `- ${f.action}: \`${f.file}\``).join('\n')
    : '(no files changed)';

  const decisionsSection = decisions.length > 0
    ? decisions.map((d, i) => `${i + 1}. ${d}`).join('\n')
    : '(no decisions recorded)';

  const manifestContent = `# Task Manifest

**Task ID**: ${taskId}
**Date**: ${today()}
**Status**: ${archiveStatus}
**Duration**: ${duration}
**Final Phase Reached**: ${finalPhase}

## Summary
${summary}

## Files Changed
${filesChangedSection}

## Key Decisions
${decisionsSection}

## Tags
${tags.join(', ')}

## Outcome
${outcome}
`;

  // ── Create archive folder and move files ──

  const archiveFolderPath = path.join(ARCHIVE_DIR, taskId);
  ensureDir(archiveFolderPath);

  // Write manifest first
  writeFile(path.join(archiveFolderPath, 'manifest.md'), manifestContent);

  // Move all task-level context files (NOT codebase-intel.md)
  let filesMoved = 0;
  for (const filename of TASK_LEVEL_FILES) {
    const srcPath = path.join(CONTEXT_DIR, filename);
    if (fileExists(srcPath)) {
      const content = readFileContent(srcPath);
      writeFile(path.join(archiveFolderPath, filename), content);
      fs.unlinkSync(srcPath);
      filesMoved++;
    }
  }

  // ── Append to task-index.md ──

  const indexPath = path.join(ARCHIVE_DIR, 'task-index.md');
  if (!fileExists(indexPath)) {
    writeFile(indexPath, TASK_INDEX_INITIAL);
  }

  const indexEntry = `| ${taskId} | ${today()} | ${archiveStatus} | ${summary.slice(0, 60)} | ${filesChangedCount} files | ${tags.join(', ')} |`;
  const indexContent = readFileContent(indexPath);
  writeFile(indexPath, indexContent.trimEnd() + '\n' + indexEntry + '\n');

  // ── Clean up checkpoints ──

  if (fileExists(CHECKPOINTS_DIR)) {
    try {
      const dirs = fs.readdirSync(CHECKPOINTS_DIR, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.startsWith('phase-')) {
          const checkpointPath = path.join(CHECKPOINTS_DIR, d.name);
          fs.rmSync(checkpointPath, { recursive: true, force: true });
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }

  // ── Reset task-status.md to idle ──

  const idleStatus = `# Task Status

**Task ID**: (none)
**Status**: idle
**Started**: (none)
**Last Updated**: ${now()}
**Current Phase**: (none)
**Phase Progress**: (none)
**Previous Task**: ${taskId} (${archiveStatus})
**Context Profile**: (none)
**Codebase Refresh Needed**: ${codebaseRefreshNeeded}

## Phase History
| Phase | Started | Completed | Agent | Notes |
|-------|---------|-----------|-------|-------|
`;

  writeFile(path.join(CONTEXT_DIR, 'task-status.md'), idleStatus);

  output({
    archived: taskId,
    status: 'idle',
    archive_status: archiveStatus,
    manifest: 'created',
    index_updated: true,
    codebase_refresh_needed: codebaseRefreshNeeded,
    files_moved: filesMoved,
    archive_path: path.relative(REPO_ROOT, archiveFolderPath),
    tags,
    summary: summary.slice(0, 80),
  });
}

/**
 * Derive tags from task metadata.
 * Combines keywords from summary, file extensions, and decisions.
 */
function deriveTaskTags(summary, filesChanged, decisions, contextData) {
  const tagSet = new Set();

  // Extract words from summary (3+ chars, lowercase, no common words)
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'was', 'are', 'were',
    'been', 'have', 'has', 'had', 'not', 'but', 'all', 'can', 'will', 'would',
    'should', 'could', 'does', 'did', 'its', 'than', 'into', 'about', 'after',
    'before', 'between', 'each', 'also', 'just', 'more', 'some', 'such', 'only',
    'very', 'when', 'which', 'filled', 'story', 'analyst', 'pending',
  ]);

  if (summary && summary !== '(no summary)') {
    const words = summary
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w));
    // Take top 5 meaningful words
    for (const w of words.slice(0, 5)) {
      tagSet.add(w);
    }
  }

  // Extract file-type tags from changed files
  const extMap = {
    '.jsx': 'react', '.tsx': 'react', '.js': 'javascript', '.ts': 'typescript',
    '.css': 'css', '.scss': 'scss', '.html': 'html', '.py': 'python',
    '.go': 'golang', '.rs': 'rust', '.java': 'java', '.sql': 'sql',
    '.yml': 'yaml', '.yaml': 'yaml', '.json': 'json', '.md': 'docs',
    '.vue': 'vue', '.svelte': 'svelte',
  };

  for (const f of filesChanged) {
    const ext = path.extname(f.file).toLowerCase();
    if (extMap[ext]) {
      tagSet.add(extMap[ext]);
    }
  }

  // Extract common domain keywords from decisions
  const domainKeywords = [
    'auth', 'login', 'jwt', 'session', 'api', 'database', 'cache', 'routing',
    'navigation', 'sidebar', 'header', 'footer', 'modal', 'form', 'payment',
    'stripe', 'webhook', 'email', 'notification', 'search', 'filter', 'sort',
    'pagination', 'security', 'performance', 'testing', 'deployment', 'ci',
    'docker', 'kubernetes', 'migration', 'refactor', 'bugfix', 'hotfix',
  ];

  const allText = [
    summary,
    ...decisions,
    ...filesChanged.map((f) => f.file),
  ].join(' ').toLowerCase();

  for (const keyword of domainKeywords) {
    if (allText.includes(keyword)) {
      tagSet.add(keyword);
    }
  }

  return Array.from(tagSet).slice(0, 10);
}

// ─────────────────────────────────────────────────────────
// COMMAND: validate
// Checks context file consistency before delegation.
// 4 checks: Task ID consistency, required sections,
// staleness (timestamp ordering), phase sequence.
// Returns { valid, checks, errors, recoverable, suggestion }
// ─────────────────────────────────────────────────────────

/**
 * Minimum-fidelity invariants per file.
 * Each entry maps a filename to an array of required section markers.
 * These are checked as case-insensitive substring matches against
 * the file content (headings or bold keys).
 */
const REQUIRED_SECTIONS = {
  'task-status.md': [
    { key: 'Task ID', check: 'header', headerKey: 'task_id' },
    { key: 'Status', check: 'header', headerKey: 'status' },
    { key: 'Current Phase', check: 'header', headerKey: 'current_phase' },
    { key: 'Phase History', check: 'heading', heading: '## Phase History' },
  ],
  'requirements.md': [
    { key: 'Task ID', check: 'header', headerKey: 'task_id' },
    { key: 'User Story Summary', check: 'heading', heading: '## User Story Summary' },
    { key: 'Acceptance Criteria', check: 'heading', heading: '## Acceptance Criteria' },
  ],
  'implementation-plan.md': [
    { key: 'Task ID', check: 'header', headerKey: 'task_id' },
    { key: 'Approach Summary', check: 'heading', heading: '## Approach Summary' },
    { key: 'File-by-File Plan', check: 'heading', heading: '## File-by-File Plan' },
    { key: 'Risk Assessment', check: 'heading', heading: '## Risk Assessment' },
  ],
  'code-changes.md': [
    { key: 'Task ID', check: 'header', headerKey: 'task_id' },
    { key: 'Files Changed', check: 'heading', heading: '## Files Changed' },
    { key: 'Deviations', check: 'heading', heading: '## Deviations' },
  ],
  'test-results.md': [
    { key: 'Task ID', check: 'header', headerKey: 'task_id' },
    { key: 'Tests Written', check: 'heading', heading: '## Tests Written' },
    { key: 'Pass/Fail Count', check: 'heading', heading: '## Pass/Fail Count' },
    { key: 'Acceptance Criteria Mapping', check: 'heading', heading: '## Acceptance Criteria Mapping' },
  ],
  'review-report.md': [
    { key: 'Task ID', check: 'header', headerKey: 'task_id' },
    { key: 'Verdict', check: 'heading', heading: '## Verdict' },
    { key: 'Issues Found', check: 'heading', heading: '## Issues Found' },
    { key: 'Requirements Verified', check: 'heading', heading: '## Requirements Verified' },
  ],
  'git-status.md': [
    { key: 'Task ID', check: 'header', headerKey: 'task_id' },
    { key: 'Branch Name', check: 'heading', heading: '## Branch Name' },
    { key: 'Commit List', check: 'heading', heading: '## Commit List' },
    { key: 'Push Status', check: 'heading', heading: '## Push Status' },
  ],
  'research-findings.md': [
    { key: 'Task ID', check: 'header', headerKey: 'task_id' },
    // Question, Sources, Findings are per-entry — check at least one entry exists
    // or that the file has the header (fresh template is valid)
  ],
  'decisions-and-blockers.md': [
    { key: 'Task ID', check: 'header', headerKey: 'task_id' },
    { key: 'Decision Log', check: 'heading', heading: '## Decision Log' },
    { key: 'Open Blockers', check: 'heading', heading: '## Open Blockers' },
  ],
};

/**
 * Staleness cascade: upstream → downstream.
 * If upstream timestamp > downstream timestamp, downstream is stale.
 * The ordering represents the natural flow of information.
 */
const STALENESS_CASCADE = [
  // [upstream_file, downstream_file, description]
  ['requirements.md', 'implementation-plan.md', 'Plan may be stale — requirements were updated after the plan was written'],
  ['implementation-plan.md', 'code-changes.md', 'Code may not match the plan — plan was updated after code was written'],
  ['code-changes.md', 'test-results.md', 'Tests may not cover latest code changes — code was updated after tests were run'],
  ['test-results.md', 'review-report.md', 'Review may be stale — test results were updated after the review'],
  ['requirements.md', 'code-changes.md', 'Code may not match requirements — requirements changed after code was written'],
  ['requirements.md', 'test-results.md', 'Tests may not cover updated requirements'],
  ['requirements.md', 'review-report.md', 'Review may not reflect updated requirements'],
];

/**
 * Phase prerequisites: which files MUST exist at each phase.
 * If the current phase is N and prerequisite files are missing, that's an error.
 */
const PHASE_PREREQUISITES = {
  1: [], // Phase 1: REQUIREMENTS — no prerequisites, just starting
  2: ['task-status.md'], // Phase 2: CODEBASE SCAN — task must exist
  3: ['task-status.md', 'requirements.md'], // Phase 3: PLANNING — needs requirements
  4: ['task-status.md', 'requirements.md', 'implementation-plan.md'], // Phase 4: DEVELOPMENT
  5: ['task-status.md', 'requirements.md', 'implementation-plan.md', 'code-changes.md'], // Phase 5: TESTING
  6: ['task-status.md', 'requirements.md', 'implementation-plan.md', 'code-changes.md', 'test-results.md'], // Phase 6: REVIEW
  7: ['task-status.md', 'requirements.md', 'implementation-plan.md', 'code-changes.md', 'test-results.md', 'review-report.md'], // Phase 7: GIT
  8: ['task-status.md', 'requirements.md', 'implementation-plan.md', 'code-changes.md', 'test-results.md', 'review-report.md', 'git-status.md'], // Phase 8: COMPLETE
};

function cmdValidate() {
  const errors = [];
  const checks = {
    task_id: 'ok',
    sections: 'ok',
    staleness: 'ok',
    phase_sequence: 'ok',
  };

  // ── Guard: must have an active task ──

  const statusPath = path.join(CONTEXT_DIR, 'task-status.md');
  if (!fileExists(statusPath)) {
    output({
      valid: false,
      checks: { task_id: 'skip', sections: 'skip', staleness: 'skip', phase_sequence: 'skip' },
      errors: [{ check: 'setup', message: 'No task-status.md found. Run `context-tool setup` first.' }],
      recoverable: false,
      suggestion: 'Context system not initialized. Run `context-tool setup` then `context-tool init <name>`.',
    });
    return;
  }

  const statusContent = readFileContent(statusPath);
  const statusHeaders = parseContextHeaders(statusContent);
  const activeTaskId = statusHeaders.task_id;
  const currentStatus = statusHeaders.status;
  const currentPhase = statusHeaders.current_phase || '(none)';

  if (!activeTaskId || activeTaskId === '(none)' || currentStatus === 'idle') {
    output({
      valid: false,
      checks: { task_id: 'skip', sections: 'skip', staleness: 'skip', phase_sequence: 'skip' },
      errors: [{ check: 'task_id', message: 'No active task. Cannot validate idle state.' }],
      recoverable: false,
      suggestion: 'No active task to validate. Start a task with `context-tool init <name>` first.',
    });
    return;
  }

  // Parse phase number
  let phaseNum = null;
  const phaseMatch = currentPhase.match(/Phase\s+(\d+)/i);
  if (phaseMatch) {
    phaseNum = parseInt(phaseMatch[1], 10);
  }

  // ── CHECK 1: Task ID consistency ──
  // All existing context files must have the same Task ID as task-status.md

  const filesWithWrongId = [];
  for (const filename of TASK_LEVEL_FILES) {
    if (filename === 'task-status.md') continue; // Already have this
    const filePath = path.join(CONTEXT_DIR, filename);
    if (!fileExists(filePath)) continue; // File doesn't exist yet — not an error here

    const content = readFileContent(filePath);
    if (!content) continue;

    const headers = parseContextHeaders(content);
    const fileTaskId = headers.task_id;

    if (fileTaskId && fileTaskId !== '(pending)' && fileTaskId !== activeTaskId) {
      filesWithWrongId.push({
        file: filename,
        expected: activeTaskId,
        found: fileTaskId,
      });
    }
  }

  if (filesWithWrongId.length > 0) {
    checks.task_id = 'fail';
    for (const f of filesWithWrongId) {
      errors.push({
        check: 'task_id',
        message: `${f.file} has Task ID "${f.found}" but active task is "${f.expected}"`,
        file: f.file,
      });
    }
  }

  // ── CHECK 2: Required sections ──
  // Each existing context file must have its minimum-fidelity invariants

  const sectionErrors = [];
  for (const [filename, requirements] of Object.entries(REQUIRED_SECTIONS)) {
    const filePath = path.join(CONTEXT_DIR, filename);
    if (!fileExists(filePath)) continue; // File doesn't exist — checked in phase sequence

    const content = readFileContent(filePath);
    if (!content) {
      sectionErrors.push({ file: filename, missing: 'entire file content (empty)' });
      continue;
    }

    const headers = parseContextHeaders(content);
    const contentLower = content.toLowerCase();

    for (const req of requirements) {
      let found = false;

      if (req.check === 'header') {
        // Check that the header key exists and has a non-placeholder value
        const val = headers[req.headerKey];
        found = val && val !== '(pending)' && val !== '(none)' && val !== '';
      } else if (req.check === 'heading') {
        // Check that the heading exists in the file (case-insensitive)
        found = contentLower.includes(req.heading.toLowerCase());
      }

      if (!found) {
        sectionErrors.push({ file: filename, missing: req.key });
      }
    }
  }

  if (sectionErrors.length > 0) {
    checks.sections = 'fail';
    for (const e of sectionErrors) {
      errors.push({
        check: 'sections',
        message: `${e.file} missing required section: "${e.missing}"`,
        file: e.file,
      });
    }
  }

  // ── CHECK 3: Staleness ──
  // Upstream files should have timestamps ≤ downstream files.
  // If upstream was updated AFTER downstream, downstream is stale.

  const fileTimestamps = {};
  for (const filename of TASK_LEVEL_FILES) {
    const filePath = path.join(CONTEXT_DIR, filename);
    if (!fileExists(filePath)) continue;

    const content = readFileContent(filePath);
    if (!content) continue;

    const headers = parseContextHeaders(content);
    const ts = headers.last_updated;
    if (ts && ts !== '(pending)' && ts !== '(none)') {
      try {
        const date = new Date(ts);
        if (!isNaN(date.getTime())) {
          fileTimestamps[filename] = date;
        }
      } catch {
        // ignore bad dates
      }
    }
  }

  const stalenessErrors = [];
  for (const [upstream, downstream, description] of STALENESS_CASCADE) {
    const upTs = fileTimestamps[upstream];
    const downTs = fileTimestamps[downstream];

    // Only check if both files exist and have valid timestamps
    if (upTs && downTs && upTs > downTs) {
      stalenessErrors.push({
        upstream,
        downstream,
        upstream_ts: upTs.toISOString(),
        downstream_ts: downTs.toISOString(),
        description,
      });
    }
  }

  if (stalenessErrors.length > 0) {
    checks.staleness = 'fail';
    for (const e of stalenessErrors) {
      errors.push({
        check: 'staleness',
        message: `${e.downstream} is older than ${e.upstream} — ${e.description}`,
        upstream: e.upstream,
        downstream: e.downstream,
      });
    }
  }

  // ── CHECK 4: Phase sequence ──
  // Current phase must have all prerequisite files present

  const phaseSequenceErrors = [];
  if (phaseNum !== null && PHASE_PREREQUISITES[phaseNum]) {
    const required = PHASE_PREREQUISITES[phaseNum];
    for (const filename of required) {
      const filePath = path.join(CONTEXT_DIR, filename);
      if (!fileExists(filePath)) {
        phaseSequenceErrors.push({
          phase: phaseNum,
          missing_file: filename,
        });
      }
    }
  }

  if (phaseSequenceErrors.length > 0) {
    checks.phase_sequence = 'fail';
    for (const e of phaseSequenceErrors) {
      errors.push({
        check: 'phase_sequence',
        message: `Phase ${e.phase} requires ${e.missing_file} but it does not exist`,
        phase: e.phase,
        file: e.missing_file,
      });
    }
  }

  // ── Determine recoverability and build suggestion ──

  const valid = errors.length === 0;
  let recoverable = true;
  let suggestion = '';

  if (valid) {
    suggestion = 'All checks passed. Safe to proceed with delegation.';
  } else {
    // Determine recoverable based on error types
    const hasTaskIdMismatch = checks.task_id === 'fail';
    const hasMissingSections = checks.sections === 'fail';
    const hasStaleness = checks.staleness === 'fail';
    const hasMissingPrereqs = checks.phase_sequence === 'fail';

    // Task ID mismatch is potentially non-recoverable (contamination)
    if (hasTaskIdMismatch) {
      recoverable = false;
      suggestion = 'Task ID mismatch detected — possible context contamination. Options: restore from checkpoint, or archive and start fresh.';
    }

    // Staleness is recoverable (re-run the stale phase)
    if (hasStaleness && !hasTaskIdMismatch) {
      // Find which phase to re-run based on the stale downstream file
      const staleFiles = stalenessErrors.map((e) => e.downstream);
      const phaseMap = {
        'implementation-plan.md': 'Phase 3 (planning)',
        'code-changes.md': 'Phase 4 (development)',
        'test-results.md': 'Phase 5 (testing)',
        'review-report.md': 'Phase 6 (review)',
      };
      const phasesToRerun = [...new Set(staleFiles.map((f) => phaseMap[f]).filter(Boolean))];
      suggestion = `Stale context detected. Re-run ${phasesToRerun.join(' and ')} to refresh against updated upstream files.`;
    }

    // Missing sections is recoverable (agent needs to fill them)
    if (hasMissingSections && !hasTaskIdMismatch && !hasStaleness) {
      const affectedFiles = [...new Set(sectionErrors.map((e) => e.file))];
      suggestion = `Missing required sections in: ${affectedFiles.join(', ')}. The owning agents need to complete these sections before proceeding.`;
    }

    // Missing phase prerequisites is recoverable
    if (hasMissingPrereqs && !hasTaskIdMismatch && !hasStaleness && !hasMissingSections) {
      const missingFiles = phaseSequenceErrors.map((e) => e.missing_file);
      suggestion = `Phase ${phaseNum} requires files that don't exist yet: ${missingFiles.join(', ')}. Complete earlier phases first.`;
    }

    // Combined issues — build a composite suggestion
    if (!suggestion) {
      const issueTypes = [];
      if (hasTaskIdMismatch) issueTypes.push('Task ID mismatch');
      if (hasMissingSections) issueTypes.push('missing sections');
      if (hasStaleness) issueTypes.push('stale files');
      if (hasMissingPrereqs) issueTypes.push('missing prerequisite files');
      suggestion = `Multiple issues detected: ${issueTypes.join(', ')}. Review errors and address each before proceeding.`;
    }
  }

  output({
    valid,
    checks,
    errors: errors.length > 0 ? errors : undefined,
    recoverable,
    suggestion,
  });
}

// ─────────────────────────────────────────────────────────
// COMMAND: checkpoint <phase>
// Copies ALL current context files to a checkpoint folder.
// Called by Coordinator after each phase gate approval.
// ─────────────────────────────────────────────────────────

/** Phase number → human-readable name map */
const PHASE_NAMES = {
  1: 'REQUIREMENTS',
  2: 'CODEBASE_SCAN',
  3: 'PLANNING',
  4: 'DEVELOPMENT',
  5: 'TESTING',
  6: 'REVIEW',
  7: 'GIT',
  8: 'COMPLETE',
};

function cmdCheckpoint() {
  const phaseArg = process.argv[3];
  if (!phaseArg) {
    fail('Usage: context-tool checkpoint <phase-number>');
  }

  const phaseNum = parseInt(phaseArg, 10);
  if (isNaN(phaseNum) || phaseNum < 1 || phaseNum > 8) {
    fail(`Invalid phase number: "${phaseArg}". Must be 1-8.`);
  }

  // Must have an active task
  const statusPath = path.join(CONTEXT_DIR, 'task-status.md');
  if (!fileExists(statusPath)) {
    fail('No task-status.md found. Cannot checkpoint without an active task.');
  }

  const statusContent = readFileContent(statusPath);
  const statusHeaders = parseContextHeaders(statusContent);

  if (!statusHeaders.task_id || statusHeaders.task_id === '(none)') {
    fail('No active task. Cannot checkpoint idle state.');
  }

  if (statusHeaders.status !== 'active' && statusHeaders.status !== 'suspended') {
    fail(`Task status is "${statusHeaders.status}". Can only checkpoint active or suspended tasks.`);
  }

  const checkpointName = `phase-${phaseNum}-complete`;
  const checkpointDir = path.join(CHECKPOINTS_DIR, checkpointName);

  // Create checkpoint directory (overwrite if exists — re-checkpointing same phase is valid)
  if (fileExists(checkpointDir)) {
    fs.rmSync(checkpointDir, { recursive: true, force: true });
  }
  ensureDir(checkpointDir);

  // Copy ALL existing context files (task-level + persistent)
  const copiedFiles = [];

  for (const filename of TASK_LEVEL_FILES) {
    const srcPath = path.join(CONTEXT_DIR, filename);
    if (fileExists(srcPath)) {
      const content = readFileContent(srcPath);
      writeFile(path.join(checkpointDir, filename), content);
      copiedFiles.push(filename);
    }
  }

  // Also copy codebase-intel.md (might have been refreshed this phase)
  const codebaseIntelPath = path.join(CONTEXT_DIR, PERSISTENT_FILE);
  if (fileExists(codebaseIntelPath)) {
    const content = readFileContent(codebaseIntelPath);
    writeFile(path.join(checkpointDir, PERSISTENT_FILE), content);
    copiedFiles.push(PERSISTENT_FILE);
  }

  // Log checkpoint in task-status.md by appending a note
  const timestamp = now();
  const checkpointNote = `\n> **Checkpoint**: ${checkpointName} created at ${timestamp} (${copiedFiles.length} files)\n`;
  writeFile(statusPath, statusContent + checkpointNote);

  output({
    checkpoint: checkpointName,
    task_id: statusHeaders.task_id,
    phase: phaseNum,
    phase_name: PHASE_NAMES[phaseNum] || 'UNKNOWN',
    files_copied: copiedFiles.length,
    copied_files: copiedFiles,
    timestamp,
  });
}

// ─────────────────────────────────────────────────────────
// COMMAND: rollback <phase>
// Restores context files from a checkpoint.
// Deletes checkpoints after the target phase.
// Updates task-status.md to the phase AFTER the checkpoint
// (i.e., rollback to phase-3-complete → current phase = 4).
// ─────────────────────────────────────────────────────────

function cmdRollback() {
  const phaseArg = process.argv[3];
  if (!phaseArg) {
    fail('Usage: context-tool rollback <phase-number>');
  }

  const phaseNum = parseInt(phaseArg, 10);
  if (isNaN(phaseNum) || phaseNum < 1 || phaseNum > 8) {
    fail(`Invalid phase number: "${phaseArg}". Must be 1-8.`);
  }

  // Must have an active task
  const statusPath = path.join(CONTEXT_DIR, 'task-status.md');
  if (!fileExists(statusPath)) {
    fail('No task-status.md found. Cannot rollback without an active task.');
  }

  const statusContent = readFileContent(statusPath);
  const statusHeaders = parseContextHeaders(statusContent);

  if (!statusHeaders.task_id || statusHeaders.task_id === '(none)') {
    fail('No active task. Cannot rollback idle state.');
  }

  // Check checkpoint exists
  const checkpointName = `phase-${phaseNum}-complete`;
  const checkpointDir = path.join(CHECKPOINTS_DIR, checkpointName);

  if (!fileExists(checkpointDir)) {
    // List available checkpoints for helpful error
    const available = [];
    if (fileExists(CHECKPOINTS_DIR)) {
      try {
        const dirs = fs.readdirSync(CHECKPOINTS_DIR, { withFileTypes: true });
        for (const d of dirs) {
          if (d.isDirectory() && d.name.startsWith('phase-')) {
            available.push(d.name);
          }
        }
      } catch { /* ignore */ }
    }
    fail(
      `Checkpoint "${checkpointName}" not found. ` +
      (available.length > 0
        ? `Available checkpoints: ${available.join(', ')}`
        : 'No checkpoints exist.')
    );
  }

  // Read all files from checkpoint
  const checkpointFiles = fs.readdirSync(checkpointDir).filter((f) => f.endsWith('.md'));

  // Restore files from checkpoint → active context
  const restoredFiles = [];
  for (const filename of checkpointFiles) {
    const srcPath = path.join(checkpointDir, filename);
    const destPath = path.join(CONTEXT_DIR, filename);
    const content = readFileContent(srcPath);
    if (content !== null) {
      writeFile(destPath, content);
      restoredFiles.push(filename);
    }
  }

  // Delete checkpoints AFTER the target phase
  const deletedCheckpoints = [];
  if (fileExists(CHECKPOINTS_DIR)) {
    try {
      const dirs = fs.readdirSync(CHECKPOINTS_DIR, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.startsWith('phase-')) {
          const match = d.name.match(/phase-(\d+)-complete/);
          if (match) {
            const cpPhase = parseInt(match[1], 10);
            if (cpPhase > phaseNum) {
              fs.rmSync(path.join(CHECKPOINTS_DIR, d.name), { recursive: true, force: true });
              deletedCheckpoints.push(d.name);
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Determine the phase we're rolling back TO (the next phase after checkpoint)
  const nextPhase = phaseNum + 1;
  const nextPhaseName = PHASE_NAMES[nextPhase] || 'UNKNOWN';
  const timestamp = now();

  // Update task-status.md with rollback info
  const taskStatusContent = `# Task Status

**Task ID**: ${statusHeaders.task_id}
**Status**: active
**Started**: ${statusHeaders.started || timestamp}
**Last Updated**: ${timestamp}
**Current Phase**: Phase ${nextPhase}: ${nextPhaseName}
**Phase Progress**: Rolled back from later phase — restarting Phase ${nextPhase}
**Previous Task**: ${statusHeaders.previous_task || '(none)'}
**Context Profile**: ${statusHeaders.context_profile || 'standard'}

## Phase History
| Phase | Started | Completed | Agent | Notes |
|-------|---------|-----------|-------|-------|
| Rollback | ${timestamp} | ${timestamp} | Coordinator | Rolled back to ${checkpointName}. Deleted: ${deletedCheckpoints.length > 0 ? deletedCheckpoints.join(', ') : 'none'}. |
`;

  writeFile(path.join(CONTEXT_DIR, 'task-status.md'), taskStatusContent);

  output({
    rolled_back_to: checkpointName,
    task_id: statusHeaders.task_id,
    restored_files: restoredFiles,
    deleted_checkpoints: deletedCheckpoints,
    current_phase: nextPhase,
    phase_name: nextPhaseName,
    timestamp,
  });
}

// ─────────────────────────────────────────────────────────
// COMMAND: search <query>
// Searches task-index.md rows and archive manifests by keyword/tag.
// Returns matching tasks with metadata and archive paths.
// ─────────────────────────────────────────────────────────

/**
 * Parse task-index.md into an array of row objects.
 * Expected format: | Task ID | Date | Status | Summary | Files Changed | Tags |
 */
function parseTaskIndex() {
  const indexPath = path.join(ARCHIVE_DIR, 'task-index.md');
  if (!fileExists(indexPath)) return [];

  const content = readFileContent(indexPath);
  if (!content) return [];

  const lines = content.split('\n');
  const rows = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip header, separator, and empty lines
    if (!trimmed.startsWith('|')) continue;
    if (trimmed.includes('------')) continue;
    if (trimmed.includes('Task ID') && trimmed.includes('Date') && trimmed.includes('Status')) continue;

    // Split on | but keep empty cells (don't filter(Boolean) — tags can be empty)
    const rawCells = trimmed.split('|').map((c) => c.trim());
    // Remove leading/trailing empty strings from split
    const cells = rawCells.slice(1, rawCells.length - 1);
    if (cells.length < 5) continue;

    rows.push({
      task_id: cells[0],
      date: cells[1],
      status: cells[2],
      summary: cells[3],
      files_changed: cells[4],
      tags: (cells[5] || '').split(',').map((t) => t.trim()).filter(Boolean),
    });
  }

  return rows;
}

function cmdSearch() {
  const query = process.argv.slice(3).join(' ').trim();
  if (!query) {
    fail('Usage: context-tool search <query>');
  }

  // Check setup
  const indexPath = path.join(ARCHIVE_DIR, 'task-index.md');
  if (!fileExists(indexPath)) {
    fail('No task-index.md found. Run setup first or complete at least one task.');
  }

  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/);
  const rows = parseTaskIndex();

  if (rows.length === 0) {
    output({ query, matches: [], message: 'No tasks in history.' });
    return;
  }

  // Phase 1: Search task-index.md rows (fast — single file)
  const indexMatches = [];
  for (const row of rows) {
    const searchable = [
      row.task_id,
      row.date,
      row.status,
      row.summary,
      row.files_changed,
      row.tags.join(' '),
    ].join(' ').toLowerCase();

    // All query terms must match (AND logic for multi-word queries)
    const allTermsMatch = queryTerms.every((term) => searchable.includes(term));
    if (allTermsMatch) {
      indexMatches.push(row);
    }
  }

  // Phase 2: For index matches, enrich with manifest data if available
  const results = [];
  for (const match of indexMatches) {
    const archivePath = path.join(ARCHIVE_DIR, match.task_id);
    const manifestPath = path.join(archivePath, 'manifest.md');
    const result = {
      task_id: match.task_id,
      date: match.date,
      status: match.status,
      summary: match.summary,
      tags: match.tags,
      files_changed: match.files_changed,
      archive_path: `.github/context/archive/${match.task_id}/`,
    };

    // Try to read manifest for richer data
    if (fileExists(manifestPath)) {
      const manifestContent = readFileContent(manifestPath);
      if (manifestContent) {
        result.has_manifest = true;
        // Extract key sections from manifest
        const summaryMatch = manifestContent.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n$)/);
        if (summaryMatch) result.full_summary = summaryMatch[1].trim();
        const outcomeMatch = manifestContent.match(/## Outcome\s*\n([\s\S]*?)(?=\n## |\n$)/);
        if (outcomeMatch) result.outcome = outcomeMatch[1].trim();
      }
    }

    results.push(result);
  }

  // Phase 3: If no index matches, do a deeper search across manifests
  if (results.length === 0 && fileExists(ARCHIVE_DIR)) {
    try {
      const archiveDirs = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true });
      for (const d of archiveDirs) {
        if (!d.isDirectory() || !d.name.startsWith('TASK-')) continue;

        const manifestPath = path.join(ARCHIVE_DIR, d.name, 'manifest.md');
        if (!fileExists(manifestPath)) continue;

        const manifestContent = readFileContent(manifestPath);
        if (!manifestContent) continue;

        const manifestLower = manifestContent.toLowerCase();
        const allTermsMatch = queryTerms.every((term) => manifestLower.includes(term));
        if (!allTermsMatch) continue;

        // Parse manifest headers
        const headers = parseContextHeaders(manifestContent);
        const summaryMatch = manifestContent.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n$)/);
        const outcomeMatch = manifestContent.match(/## Outcome\s*\n([\s\S]*?)(?=\n## |\n$)/);
        const tagsMatch = manifestContent.match(/## Tags\s*\n(.*)/);

        results.push({
          task_id: headers.task_id || d.name,
          date: headers.date || 'unknown',
          status: headers.status || 'unknown',
          summary: summaryMatch ? summaryMatch[1].trim().slice(0, 80) : d.name,
          tags: tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean) : [],
          files_changed: 'see manifest',
          archive_path: `.github/context/archive/${d.name}/`,
          has_manifest: true,
          full_summary: summaryMatch ? summaryMatch[1].trim() : undefined,
          outcome: outcomeMatch ? outcomeMatch[1].trim() : undefined,
          match_source: 'manifest_deep_search',
        });
      }
    } catch { /* ignore directory read errors */ }
  }

  output({
    query,
    matches: results,
    total: results.length,
    searched_index: true,
    searched_manifests: results.length === 0 || results.some((r) => r.match_source === 'manifest_deep_search'),
  });
}

// ─────────────────────────────────────────────────────────
// COMMAND: history [--last N]
// Returns last N task summaries from task-index.md.
// Default: last 5 tasks.
// ─────────────────────────────────────────────────────────

function cmdHistory() {
  // Check setup
  const indexPath = path.join(ARCHIVE_DIR, 'task-index.md');
  if (!fileExists(indexPath)) {
    fail('No task-index.md found. Run setup first or complete at least one task.');
  }

  // Parse --last N flag
  let lastN = 5; // default
  const lastFlag = getFlag('--last');
  if (lastFlag) {
    const parsed = parseInt(lastFlag, 10);
    if (isNaN(parsed) || parsed < 1) {
      fail(`Invalid --last value: "${lastFlag}". Must be a positive integer.`);
    }
    lastN = parsed;
  }

  const rows = parseTaskIndex();

  if (rows.length === 0) {
    output({ tasks: [], total: 0, showing: 0, message: 'No tasks in history.' });
    return;
  }

  // Take last N entries (task-index is append-only, so last = most recent)
  const recentRows = rows.slice(-lastN);

  // Enrich with manifest data
  const tasks = [];
  for (const row of recentRows) {
    const task = {
      task_id: row.task_id,
      date: row.date,
      status: row.status,
      summary: row.summary,
      tags: row.tags,
      files_changed: row.files_changed,
      archive_path: `.github/context/archive/${row.task_id}/`,
    };

    // Try to add outcome from manifest
    const manifestPath = path.join(ARCHIVE_DIR, row.task_id, 'manifest.md');
    if (fileExists(manifestPath)) {
      const manifestContent = readFileContent(manifestPath);
      if (manifestContent) {
        task.has_manifest = true;
        const outcomeMatch = manifestContent.match(/## Outcome\s*\n([\s\S]*?)(?=\n## |\n$)/);
        if (outcomeMatch) task.outcome = outcomeMatch[1].trim();
      }
    }

    tasks.push(task);
  }

  output({
    tasks,
    total: rows.length,
    showing: tasks.length,
    requested: lastN,
  });
}

// ─────────────────────────────────────────────────────────
// COMMAND: suspend [reason]
// Checkpoints current state, marks task as suspended.
// Context files stay in place (NOT archived) — ready for resume.
// ─────────────────────────────────────────────────────────

function cmdSuspend() {
  const reason = process.argv.slice(3).join(' ').trim() || 'no reason provided';

  // Must have an active task
  const statusPath = path.join(CONTEXT_DIR, 'task-status.md');
  if (!fileExists(statusPath)) {
    fail('No task-status.md found. Nothing to suspend.');
  }

  const statusContent = readFileContent(statusPath);
  const statusHeaders = parseContextHeaders(statusContent);

  if (!statusHeaders.task_id || statusHeaders.task_id === '(none)') {
    fail('No active task to suspend.');
  }

  if (statusHeaders.status === 'suspended') {
    fail(`Task ${statusHeaders.task_id} is already suspended.`);
  }

  if (statusHeaders.status !== 'active') {
    fail(`Task status is "${statusHeaders.status}". Can only suspend active tasks.`);
  }

  // Determine current phase number
  let phaseNum = null;
  if (statusHeaders.current_phase) {
    const phaseMatch = statusHeaders.current_phase.match(/Phase\s+(\d+)/i);
    if (phaseMatch) phaseNum = parseInt(phaseMatch[1], 10);
  }

  // Create a checkpoint of current state (auto-checkpoint before suspend)
  const checkpointName = `suspended-phase-${phaseNum || 'unknown'}`;
  const checkpointDir = path.join(CHECKPOINTS_DIR, checkpointName);

  if (fileExists(checkpointDir)) {
    fs.rmSync(checkpointDir, { recursive: true, force: true });
  }
  ensureDir(checkpointDir);

  const copiedFiles = [];
  for (const filename of TASK_LEVEL_FILES) {
    const srcPath = path.join(CONTEXT_DIR, filename);
    if (fileExists(srcPath)) {
      writeFile(path.join(checkpointDir, filename), readFileContent(srcPath));
      copiedFiles.push(filename);
    }
  }
  // Also checkpoint codebase-intel
  const codebaseIntelPath = path.join(CONTEXT_DIR, PERSISTENT_FILE);
  if (fileExists(codebaseIntelPath)) {
    writeFile(path.join(checkpointDir, PERSISTENT_FILE), readFileContent(codebaseIntelPath));
    copiedFiles.push(PERSISTENT_FILE);
  }

  // Update task-status.md to suspended
  const timestamp = now();
  const suspendedStatusContent = `# Task Status

**Task ID**: ${statusHeaders.task_id}
**Status**: suspended
**Started**: ${statusHeaders.started || timestamp}
**Last Updated**: ${timestamp}
**Current Phase**: ${statusHeaders.current_phase || `Phase ${phaseNum}: ${PHASE_NAMES[phaseNum] || 'UNKNOWN'}`}
**Phase Progress**: ${statusHeaders.phase_progress || '(suspended)'}
**Previous Task**: ${statusHeaders.previous_task || '(none)'}
**Context Profile**: ${statusHeaders.context_profile || 'standard'}
**Suspended At**: ${timestamp}
**Suspended Reason**: ${reason}

## Phase History
| Phase | Started | Completed | Agent | Notes |
|-------|---------|-----------|-------|-------|
| Suspended | ${timestamp} | — | Coordinator | Reason: ${reason}. Checkpoint: ${checkpointName} (${copiedFiles.length} files). |
`;

  writeFile(statusPath, suspendedStatusContent);

  output({
    suspended: statusHeaders.task_id,
    phase: phaseNum,
    phase_name: PHASE_NAMES[phaseNum] || 'UNKNOWN',
    reason,
    checkpoint: 'created',
    checkpoint_name: checkpointName,
    files_checkpointed: copiedFiles.length,
    timestamp,
  });
}

// ─────────────────────────────────────────────────────────
// COMMAND: resume
// Reads suspended task state, sets back to active.
// Calculates days_suspended and stale_warning.
// ─────────────────────────────────────────────────────────

function cmdResume() {
  // Must have a suspended task
  const statusPath = path.join(CONTEXT_DIR, 'task-status.md');
  if (!fileExists(statusPath)) {
    fail('No task-status.md found. Nothing to resume.');
  }

  const statusContent = readFileContent(statusPath);
  const statusHeaders = parseContextHeaders(statusContent);

  if (!statusHeaders.task_id || statusHeaders.task_id === '(none)') {
    fail('No task to resume. System is idle.');
  }

  if (statusHeaders.status === 'active') {
    fail(`Task ${statusHeaders.task_id} is already active. Nothing to resume.`);
  }

  if (statusHeaders.status !== 'suspended') {
    fail(`Task status is "${statusHeaders.status}". Can only resume suspended tasks.`);
  }

  // Calculate days suspended
  let daysSuspended = 0;
  const suspendedAt = statusHeaders.suspended_at;
  if (suspendedAt) {
    try {
      const suspendedDate = new Date(suspendedAt);
      const nowDate = new Date();
      daysSuspended = Math.floor((nowDate - suspendedDate) / (1000 * 60 * 60 * 24));
    } catch { /* ignore parse errors */ }
  }

  const staleWarning = daysSuspended > 7;

  // Determine current phase
  let phaseNum = null;
  let phaseName = 'UNKNOWN';
  if (statusHeaders.current_phase) {
    const phaseMatch = statusHeaders.current_phase.match(/Phase\s+(\d+)/i);
    if (phaseMatch) {
      phaseNum = parseInt(phaseMatch[1], 10);
      phaseName = PHASE_NAMES[phaseNum] || 'UNKNOWN';
    }
  }

  // Update task-status.md back to active
  const timestamp = now();
  const resumedStatusContent = `# Task Status

**Task ID**: ${statusHeaders.task_id}
**Status**: active
**Started**: ${statusHeaders.started || timestamp}
**Last Updated**: ${timestamp}
**Current Phase**: ${statusHeaders.current_phase || `Phase ${phaseNum}: ${phaseName}`}
**Phase Progress**: Resumed from suspension
**Previous Task**: ${statusHeaders.previous_task || '(none)'}
**Context Profile**: ${statusHeaders.context_profile || 'standard'}

## Phase History
| Phase | Started | Completed | Agent | Notes |
|-------|---------|-----------|-------|-------|
| Resumed | ${timestamp} | ${timestamp} | Coordinator | Resumed after ${daysSuspended} day(s) suspended. Was: ${statusHeaders.suspended_reason || 'no reason'}. ${staleWarning ? 'STALE WARNING: consider codebase refresh.' : ''} |
`;

  writeFile(statusPath, resumedStatusContent);

  output({
    task_id: statusHeaders.task_id,
    phase: phaseNum,
    phase_name: phaseName,
    suspended_at: suspendedAt || 'unknown',
    suspended_reason: statusHeaders.suspended_reason || 'no reason provided',
    days_suspended: daysSuspended,
    stale_warning: staleWarning,
    status: 'active',
    timestamp,
  });
}

// ─────────────────────────────────────────────────────────
// COMMAND: compact
// Compacts oversized context files:
//   - codebase-intel.md: if > CODEBASE_INTEL_MAX_LINES → trim to TARGET
//   - task-index.md: if > TASK_INDEX_MAX_ENTRIES → split recent/cold
// Script does mechanical compaction (dedup, trim old sections).
// AI-level summarization is flagged for Codebase Explorer.
// ─────────────────────────────────────────────────────────

/**
 * Compact codebase-intel.md by keeping section structure but trimming
 * older/duplicated content. Returns { compacted, before_lines, after_lines }.
 */
function compactCodebaseIntel() {
  const filePath = path.join(CONTEXT_DIR, PERSISTENT_FILE);
  if (!fileExists(filePath)) {
    return { skipped: true, reason: 'codebase-intel.md not found' };
  }

  const content = readFileContent(filePath);
  if (!content) return { skipped: true, reason: 'codebase-intel.md is empty' };

  const lines = content.split('\n');
  const beforeLines = lines.length;

  if (beforeLines <= CODEBASE_INTEL_MAX_LINES) {
    return { skipped: true, reason: `${beforeLines} lines (under ${CODEBASE_INTEL_MAX_LINES} threshold)` };
  }

  // Strategy: Parse into sections (## headings), keep structure.
  // Within each section, remove lines containing [UPDATED], [OLD], [DEPRECATED].
  // If still over target, trim each section proportionally.
  const sections = [];
  let currentSection = { heading: '', lines: [] };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentSection.heading || currentSection.lines.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { heading: line, lines: [] };
    } else {
      currentSection.lines.push(line);
    }
  }
  sections.push(currentSection); // push last section

  // Pass 1: Remove lines with stale markers
  const staleMarkers = ['[UPDATED]', '[OLD]', '[DEPRECATED]', '[REMOVED]', '[SUPERSEDED]'];
  for (const section of sections) {
    section.lines = section.lines.filter((line) => {
      const upper = line.toUpperCase();
      return !staleMarkers.some((marker) => upper.includes(marker));
    });
  }

  // Pass 2: Remove consecutive blank lines (keep max 1)
  for (const section of sections) {
    const cleaned = [];
    let lastWasBlank = false;
    for (const line of section.lines) {
      const isBlank = line.trim() === '';
      if (isBlank && lastWasBlank) continue;
      cleaned.push(line);
      lastWasBlank = isBlank;
    }
    section.lines = cleaned;
  }

  // Check line count after Pass 1+2
  let totalLines = sections.reduce((sum, s) => sum + (s.heading ? 1 : 0) + s.lines.length, 0);

  // Pass 3: If still over target, trim each section proportionally
  if (totalLines > CODEBASE_INTEL_TARGET_LINES) {
    const headingLines = sections.filter((s) => s.heading).length;
    const availableForContent = CODEBASE_INTEL_TARGET_LINES - headingLines - 5; // 5 lines buffer
    const totalContentLines = sections.reduce((sum, s) => sum + s.lines.length, 0);

    if (totalContentLines > 0 && availableForContent > 0) {
      for (const section of sections) {
        const proportion = section.lines.length / totalContentLines;
        const allowedLines = Math.max(3, Math.floor(proportion * availableForContent));
        if (section.lines.length > allowedLines) {
          section.lines = section.lines.slice(0, allowedLines);
          section.lines.push('', '> _(trimmed by compact — run codebase scan for full details)_');
        }
      }
    }
  }

  // Reassemble
  const compactedLines = [];
  for (const section of sections) {
    if (section.heading) compactedLines.push(section.heading);
    compactedLines.push(...section.lines);
  }

  const afterLines = compactedLines.length;

  // Write back
  writeFile(filePath, compactedLines.join('\n'));

  return {
    compacted: true,
    before_lines: beforeLines,
    after_lines: afterLines,
    lines_removed: beforeLines - afterLines,
  };
}

/**
 * Split task-index.md if entries exceed TASK_INDEX_MAX_ENTRIES.
 * Keeps TASK_INDEX_RECENT_KEEP most recent in active index.
 * Moves older entries to task-index-cold.md.
 */
function compactTaskIndex() {
  const indexPath = path.join(ARCHIVE_DIR, 'task-index.md');
  if (!fileExists(indexPath)) {
    return { skipped: true, reason: 'task-index.md not found' };
  }

  const rows = parseTaskIndex();
  if (rows.length <= TASK_INDEX_MAX_ENTRIES) {
    return { skipped: true, reason: `${rows.length} entries (under ${TASK_INDEX_MAX_ENTRIES} threshold)` };
  }

  // Split: keep recent, move old to cold storage
  const recentRows = rows.slice(-TASK_INDEX_RECENT_KEEP);
  const coldRows = rows.slice(0, rows.length - TASK_INDEX_RECENT_KEEP);

  // Build recent index
  const recentContent = `# Task Index

> Recent tasks (last ${TASK_INDEX_RECENT_KEEP}). See \`task-index-cold.md\` for older history.

| Task ID | Date | Status | Summary | Files Changed | Tags |
|---------|------|--------|---------|---------------|------|
${recentRows.map((r) => `| ${r.task_id} | ${r.date} | ${r.status} | ${r.summary} | ${r.files_changed} | ${r.tags.join(', ')} |`).join('\n')}
`;

  // Build or append to cold index
  const coldPath = path.join(ARCHIVE_DIR, 'task-index-cold.md');
  let coldContent;

  if (fileExists(coldPath)) {
    // Append to existing cold index
    const existingCold = readFileContent(coldPath) || '';
    const coldEntries = coldRows.map((r) =>
      `| ${r.task_id} | ${r.date} | ${r.status} | ${r.summary} | ${r.files_changed} | ${r.tags.join(', ')} |`
    ).join('\n');
    coldContent = existingCold.trimEnd() + '\n' + coldEntries + '\n';
  } else {
    coldContent = `# Task Index — Cold Storage

> Older completed tasks moved here by compact. Most recent tasks are in \`task-index.md\`.

| Task ID | Date | Status | Summary | Files Changed | Tags |
|---------|------|--------|---------|---------------|------|
${coldRows.map((r) => `| ${r.task_id} | ${r.date} | ${r.status} | ${r.summary} | ${r.files_changed} | ${r.tags.join(', ')} |`).join('\n')}
`;
  }

  writeFile(indexPath, recentContent);
  writeFile(coldPath, coldContent);

  return {
    split: true,
    total_entries: rows.length,
    recent_kept: recentRows.length,
    cold_moved: coldRows.length,
  };
}

function cmdCompact() {
  // Check setup
  if (!fileExists(CONTEXT_DIR)) {
    fail('Context directory not found. Run setup first.');
  }

  const results = {
    compacted: [],
    split: [],
    skipped: [],
    needs_ai_compaction: false,
  };

  // 1. Compact codebase-intel.md
  const intelResult = compactCodebaseIntel();
  if (intelResult.skipped) {
    results.skipped.push(`codebase-intel.md (${intelResult.reason})`);
  } else if (intelResult.compacted) {
    results.compacted.push(`codebase-intel.md (${intelResult.before_lines} → ${intelResult.after_lines} lines, -${intelResult.lines_removed})`);
    // If still over target after mechanical compaction, flag for AI
    if (intelResult.after_lines > CODEBASE_INTEL_TARGET_LINES) {
      results.needs_ai_compaction = true;
    }
  }

  // 2. Split task-index.md
  const indexResult = compactTaskIndex();
  if (indexResult.skipped) {
    results.skipped.push(`task-index.md (${indexResult.reason})`);
  } else if (indexResult.split) {
    results.split.push(`task-index.md (${indexResult.total_entries} entries → ${indexResult.recent_kept} recent + ${indexResult.cold_moved} cold)`);
  }

  output(results);
}

// ─────────────────────────────────────────────────────────
// COMMAND ROUTER
// ─────────────────────────────────────────────────────────

const COMMANDS = {
  setup: cmdSetup,
  init: cmdInit,
  status: cmdStatus,
  archive: cmdArchive,
  validate: cmdValidate,
  checkpoint: cmdCheckpoint,
  rollback: cmdRollback,
  search: cmdSearch,
  history: cmdHistory,
  suspend: cmdSuspend,
  resume: cmdResume,
  compact: cmdCompact,
};

function main() {
  const command = process.argv[2];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
DevAgent Context Tool — CLI for context file management

Usage: node .github/scripts/context-tool.js <command> [args]

Commands:
  setup                          Create folder structure + templates (one-time)
  init <name> [--profile <p>]    Start new task (generates Task ID, copies templates)
  status                         Show current task state as JSON
  archive [--abandoned]          Archive completed/abandoned task
  validate                       Check context file consistency
  checkpoint <phase>             Save phase checkpoint
  rollback <phase>               Restore from checkpoint
  search <query>                 Search task history by keyword
  history [--last N]             Show last N task summaries (default: 5)
  suspend [reason]               Pause current task
  resume                         Resume suspended task
  compact                        Compact oversized context files

Flags:
  --context-dir <path>           Use external context directory
  --profile <profile>            Context profile: minimal|standard|full|extended
`);
    process.exit(0);
  }

  const handler = COMMANDS[command];
  if (!handler) {
    fail(`Unknown command: "${command}". Run with --help to see available commands.`);
  }

  try {
    handler();
  } catch (err) {
    fail(`Command "${command}" failed: ${err.message}`);
  }
}

main();
