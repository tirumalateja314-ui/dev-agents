#!/usr/bin/env node

/**
 * git-safety-check.js — DevAgent Git Safety Verification CLI
 *
 * Automates the 20+ step manual safety procedure that Git Manager must
 * perform before any git operation. Returns structured JSON with safe/unsafe
 * status, categorized changes, and rollback info.
 *
 * Usage: node .github/scripts/git-safety-check.js [--context-dir <path>]
 *
 * Built with zero dependencies — only Node.js built-in modules.
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

function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
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
    return { error: true, message: err.message || String(err), stderr: err.stderr || '' };
  }
}

function isGitError(result) {
  return result && typeof result === 'object' && result.error === true;
}

function parseContextHeaders(content) {
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
// STEP 1: Check git is available and this is a git repo
// ─────────────────────────────────────────────────────────

function checkGitRepo(repoRoot) {
  const result = execGitSafe('git rev-parse --is-inside-work-tree', repoRoot);
  if (isGitError(result) || result !== 'true') {
    return { isRepo: false };
  }

  const toplevel = execGitSafe('git rev-parse --show-toplevel', repoRoot);
  return {
    isRepo: true,
    toplevel: isGitError(toplevel) ? repoRoot : toplevel,
  };
}

// ─────────────────────────────────────────────────────────
// STEP 2: Gather git state
// ─────────────────────────────────────────────────────────

function detectDefaultBranch(repoRoot) {
  const branchAll = execGitSafe('git branch -a', repoRoot);
  if (isGitError(branchAll) || !branchAll) return null;
  const branches = branchAll.split('\n').map(b => b.trim().replace(/^\*\s*/, ''));
  const candidates = ['main', 'master', 'develop'];
  for (const name of candidates) {
    if (branches.some(b => b === name || b.includes(`remotes/origin/${name}`))) {
      return name;
    }
  }
  return null;
}

function parseRemotes(repoRoot) {
  const remotes = execGitSafe('git remote -v', repoRoot);
  if (isGitError(remotes) || !remotes) return [];
  const result = [];
  for (const line of remotes.split('\n')) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/);
    if (match) {
      result.push({ name: match[1], url: match[2], type: match[3] });
    }
  }
  return result;
}

function parseRecentCommits(repoRoot) {
  const log = execGitSafe('git log --oneline -5', repoRoot);
  if (isGitError(log) || !log) return [];
  const result = [];
  for (const line of log.split('\n')) {
    const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
    if (match) {
      result.push({ hash: match[1], message: match[2] });
    }
  }
  return result;
}

function gatherGitState(repoRoot) {
  const state = {
    branch: null,
    head: null,
    default_branch: null,
    is_detached: false,
    remotes: [],
    recent_commits: [],
  };

  const head = execGitSafe('git rev-parse HEAD', repoRoot);
  if (!isGitError(head)) {
    state.head = head;
  }

  const branch = execGitSafe('git branch --show-current', repoRoot);
  if (!isGitError(branch) && branch) {
    state.branch = branch;
  } else {
    state.is_detached = state.head !== null;
  }

  state.default_branch = detectDefaultBranch(repoRoot);
  state.remotes = parseRemotes(repoRoot);
  state.recent_commits = parseRecentCommits(repoRoot);

  return state;
}

// ─────────────────────────────────────────────────────────
// STEP 3: Detect uncommitted changes
// ─────────────────────────────────────────────────────────

function classifyStatusLine(line, changes) {
  const indexStatus = line[0];
  const workStatus = line[1];
  const filePath = line.slice(3).trim();

  changes.total++;

  if (indexStatus === '?' && workStatus === '?') {
    changes.untracked.push(filePath);
    return;
  }
  if (indexStatus !== ' ' && indexStatus !== '?') {
    changes.staged.push(filePath);
  }
  if (workStatus !== ' ' && workStatus !== '?') {
    changes.unstaged.push(filePath);
  }
}

function detectUncommittedChanges(repoRoot) {
  const changes = {
    total: 0,
    staged: [],
    unstaged: [],
    untracked: [],
  };

  const porcelain = execGitSafe('git status --porcelain', repoRoot);
  if (isGitError(porcelain) || !porcelain) return changes;

  const lines = porcelain.split('\n').filter(Boolean);
  const MAX_FILES = 50;

  for (const line of lines) {
    if (changes.total >= MAX_FILES) {
      changes.truncated = true;
      changes.actual_total = lines.length;
      break;
    }
    classifyStatusLine(line, changes);
  }

  return changes;
}

// ─────────────────────────────────────────────────────────
// STEP 4: Categorize changes (task-related vs unrelated)
// ─────────────────────────────────────────────────────────

function parsePlannedFiles(codeChangesContent) {
  const plannedFiles = new Set();
  if (!codeChangesContent) return plannedFiles;
  const rowPattern = /\|\s*`?([^|`]+\.\w+)`?\s*\|\s*([^|]+)\s*\|/g;
  let match;
  while ((match = rowPattern.exec(codeChangesContent)) !== null) {
    const file = match[1].trim().toLowerCase().replace(/^\.\//, '');
    if (file !== 'file' && !file.includes('---')) {
      plannedFiles.add(file);
    }
  }
  return plannedFiles;
}

function classifyChangedFile(filePath, plannedFiles, contextRelative, result) {
  const normalized = filePath.toLowerCase().replaceAll('\\', '/').replace(/^\.\//, '');

  if (normalized.includes('.github/context/') || normalized.includes(contextRelative.toLowerCase())) {
    result.context_files_exposed.push(filePath);
    return;
  }

  const isRelated = [...plannedFiles].some(pf =>
    normalized.endsWith(pf) || pf.endsWith(normalized) || normalized === pf
  );

  if (isRelated) {
    result.related_to_task.push(filePath);
  } else {
    result.unrelated_to_task.push(filePath);
  }
}

function categorizeChanges(changes, codeChangesContent, contextDir) {
  const result = {
    related_to_task: [],
    unrelated_to_task: [],
    context_files_exposed: [],
  };

  const plannedFiles = parsePlannedFiles(codeChangesContent);
  const contextRelative = contextDir ? path.basename(path.dirname(contextDir)) + '/' + path.basename(contextDir) : '.github/context';

  const allChangedFiles = [
    ...changes.staged,
    ...changes.unstaged,
    ...changes.untracked,
  ];
  const seen = new Set();

  for (const filePath of allChangedFiles) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    classifyChangedFile(filePath, plannedFiles, contextRelative, result);
  }

  return result;
}

// ─────────────────────────────────────────────────────────
// STEP 5: Check remote status
// ─────────────────────────────────────────────────────────

function checkRemoteStatus(repoRoot, gitState) {
  const result = {
    ahead: 0,
    behind: 0,
    diverged: false,
    fetch_success: false,
  };

  if (gitState.remotes.length === 0) return result;

  // Determine remote and upstream branch
  const primaryRemote = gitState.remotes.find(r => r.name === 'origin') || gitState.remotes[0];
  const remoteName = primaryRemote.name;
  const upstreamBranch = gitState.default_branch || gitState.branch || 'main';

  // Fetch (with timeout)
  const fetchResult = execGitSafe(`git fetch ${remoteName}`, repoRoot, 15000);
  if (!isGitError(fetchResult)) {
    result.fetch_success = true;
  }
  // Even if fetch fails, try to use cached refs

  // Count behind
  const behind = execGitSafe(`git rev-list --count HEAD..${remoteName}/${upstreamBranch}`, repoRoot);
  if (!isGitError(behind)) {
    result.behind = Number.parseInt(behind, 10) || 0;
  }

  // Count ahead
  const ahead = execGitSafe(`git rev-list --count ${remoteName}/${upstreamBranch}..HEAD`, repoRoot);
  if (!isGitError(ahead)) {
    result.ahead = Number.parseInt(ahead, 10) || 0;
  }

  // Diverged if both ahead and behind
  result.diverged = result.ahead > 0 && result.behind > 0;

  return result;
}

// ─────────────────────────────────────────────────────────
// STEP 6: Edge case detection
// ─────────────────────────────────────────────────────────

function checkGitLock(gitDir, checks) {
  const lockPath = path.join(gitDir, 'index.lock');
  if (!fs.existsSync(lockPath)) return;
  checks.git_lock_file = true;
  try {
    const stat = fs.statSync(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > 5 * 60 * 1000) {
      checks.git_lock_stale = true;
    }
  } catch { /* ignore */ }
}

function checkGitignoreForContext(repoRoot) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;
  const gitignore = readFileSafe(gitignorePath) || '';
  return gitignore.includes('.github/context/') ||
    gitignore.includes('.github/context') ||
    gitignore.includes('context/');
}

function checkLargeFiles(repoRoot) {
  const largeFiles = [];
  const numstat = execGitSafe('git diff --staged --numstat', repoRoot);
  if (isGitError(numstat) || !numstat) return largeFiles;
  for (const line of numstat.split('\n')) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const added = Number.parseInt(parts[0], 10);
      if (added > 10000) {
        largeFiles.push({ file: parts[2], lines_added: added });
      }
    }
  }
  return largeFiles;
}

function detectEdgeCases(repoRoot, gitState) {
  const gitDir = path.join(repoRoot, '.git');
  const protectedBranches = ['main', 'master', 'develop', 'production', 'staging', 'release'];
  const shallow = execGitSafe('git rev-parse --is-shallow-repository', repoRoot);

  const checks = {
    detached_head: gitState.is_detached,
    missing_remote: gitState.remotes.length === 0,
    large_files: checkLargeFiles(repoRoot),
    git_lock_file: false,
    git_lock_stale: false,
    protected_branch: Boolean(gitState.branch && protectedBranches.includes(gitState.branch)),
    context_files_in_gitignore: checkGitignoreForContext(repoRoot),
    merge_in_progress: fs.existsSync(path.join(gitDir, 'MERGE_HEAD')),
    rebase_in_progress: fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply')),
    shallow_clone: !isGitError(shallow) && shallow === 'true',
    has_submodules: fs.existsSync(path.join(repoRoot, '.gitmodules')),
  };

  checkGitLock(gitDir, checks);

  return checks;
}

// ─────────────────────────────────────────────────────────
// STEP 7: Build warnings and blockers
// ─────────────────────────────────────────────────────────

function collectBlockers(gitState, edgeCases) {
  const blockers = [];
  if (edgeCases.detached_head) {
    blockers.push('Detached HEAD — checkout a branch before git operations');
  }
  if (edgeCases.git_lock_file) {
    blockers.push(edgeCases.git_lock_stale
      ? 'Stale .git/index.lock file (>5 min old) — likely from a crashed process. Delete it: git rm -f .git/index.lock'
      : '.git/index.lock exists — another git process may be running');
  }
  if (edgeCases.merge_in_progress) {
    blockers.push('Merge in progress — resolve or abort (git merge --abort) before proceeding');
  }
  if (edgeCases.rebase_in_progress) {
    blockers.push('Rebase in progress — resolve or abort (git rebase --abort) before proceeding');
  }
  if (gitState.head === null) {
    blockers.push('Empty repository — no commits yet. Create an initial commit first.');
  }
  return blockers;
}

function collectWarnings(gitState, uncommitted, categorized, remoteStatus, edgeCases) {
  const warnings = [];
  if (edgeCases.missing_remote) {
    warnings.push('No remote configured — push operations will fail. Add a remote: git remote add origin <url>');
  }
  if (remoteStatus.behind > 0) {
    warnings.push(`Remote is ${remoteStatus.behind} commit(s) ahead — consider pulling first`);
  }
  if (remoteStatus.diverged) {
    warnings.push('Local and remote have diverged — rebase or merge needed before push');
  }
  if (!remoteStatus.fetch_success && gitState.remotes.length > 0) {
    warnings.push('Failed to fetch from remote — network error or auth issue. Working with cached refs.');
  }
  if (categorized.unrelated_to_task.length > 0) {
    warnings.push(`${categorized.unrelated_to_task.length} uncommitted file(s) unrelated to current task — consider stashing or committing separately`);
  }
  if (categorized.context_files_exposed.length > 0 && !edgeCases.context_files_in_gitignore) {
    warnings.push('Context files are staged or modified but NOT in .gitignore — add .github/context/ to .gitignore');
  }
  if (!edgeCases.context_files_in_gitignore) {
    warnings.push('.github/context/ not found in .gitignore — context files may be accidentally committed');
  }
  if (edgeCases.protected_branch) {
    warnings.push(`On protected branch "${gitState.branch}" — create a feature branch before committing`);
  }
  if (edgeCases.shallow_clone) {
    warnings.push('Shallow clone detected — some git operations may fail. Run: git fetch --unshallow');
  }
  for (const f of edgeCases.large_files) {
    warnings.push(`Large file staged: ${f.file} (${f.lines_added} lines added) — consider .gitignore or Git LFS`);
  }
  if (uncommitted.truncated) {
    warnings.push(`Very dirty working tree (${uncommitted.actual_total} files) — list truncated to 50. Consider cleaning up.`);
  }
  return warnings;
}

function buildWarningsAndBlockers(gitState, uncommitted, categorized, remoteStatus, edgeCases) {
  return {
    warnings: collectWarnings(gitState, uncommitted, categorized, remoteStatus, edgeCases),
    blockers: collectBlockers(gitState, edgeCases),
  };
}

// ─────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────

function main() {
  const repoRoot = findRepoRoot(process.cwd());
  const contextDirFlag = getFlag('--context-dir');
  const contextDir = contextDirFlag
    ? path.resolve(contextDirFlag)
    : path.join(repoRoot, '.github', 'context');

  // Step 1: Check git repo
  const repoCheck = checkGitRepo(repoRoot);
  if (!repoCheck.isRepo) {
    output({
      safe_to_proceed: false,
      timestamp: now(),
      git_state: null,
      uncommitted_changes: null,
      remote_status: null,
      edge_case_checks: null,
      warnings: [],
      blockers: ['Not a git repository'],
      rollback_info: null,
    });
    return;
  }

  // Step 2: Gather git state
  const gitState = gatherGitState(repoRoot);

  // Step 3: Detect uncommitted changes
  const uncommitted = detectUncommittedChanges(repoRoot);

  // Step 4: Categorize changes
  const codeChangesContent = readFileSafe(path.join(contextDir, 'code-changes.md'));
  const categorized = categorizeChanges(uncommitted, codeChangesContent, contextDir);

  // Step 5: Remote status
  const remoteStatus = checkRemoteStatus(repoRoot, gitState);

  // Step 6: Edge case detection
  const edgeCases = detectEdgeCases(repoRoot, gitState);

  // Step 7: Build warnings and blockers
  const { warnings, blockers } = buildWarningsAndBlockers(
    gitState, uncommitted, categorized, remoteStatus, edgeCases
  );

  const safeToProceed = blockers.length === 0;

  output({
    safe_to_proceed: safeToProceed,
    timestamp: now(),
    git_state: {
      branch: gitState.branch,
      head: gitState.head,
      default_branch: gitState.default_branch,
      is_detached: gitState.is_detached,
      remotes: gitState.remotes.length > 0 ? gitState.remotes : undefined,
      recent_commits: gitState.recent_commits.length > 0 ? gitState.recent_commits : undefined,
    },
    uncommitted_changes: {
      total: uncommitted.total,
      staged: uncommitted.staged.length > 0 ? uncommitted.staged : undefined,
      unstaged: uncommitted.unstaged.length > 0 ? uncommitted.unstaged : undefined,
      untracked: uncommitted.untracked.length > 0 ? uncommitted.untracked : undefined,
      related_to_task: categorized.related_to_task.length > 0 ? categorized.related_to_task : undefined,
      unrelated_to_task: categorized.unrelated_to_task.length > 0 ? categorized.unrelated_to_task : undefined,
      context_files_exposed: categorized.context_files_exposed.length > 0 ? categorized.context_files_exposed : undefined,
    },
    remote_status: remoteStatus,
    edge_case_checks: edgeCases,
    warnings: warnings.length > 0 ? warnings : undefined,
    blockers: blockers.length > 0 ? blockers : undefined,
    rollback_info: gitState.head ? {
      current_head: gitState.head,
      restore_command: `git reset --hard ${gitState.head}`,
    } : null,
  });
}

// Only run CLI when executed directly
if (require.main === module) {
  main();
}

module.exports = {
  checkGitRepo,
  gatherGitState,
  detectUncommittedChanges,
  categorizeChanges,
  checkRemoteStatus,
  detectEdgeCases,
  buildWarningsAndBlockers,
};
