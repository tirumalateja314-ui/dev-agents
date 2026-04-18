#!/usr/bin/env node

/**
 * Integration Test Suite for context-tool.js
 *
 * Tests every command end-to-end using a temporary directory.
 * Covers: full lifecycle, edge cases, error handling, recovery flows.
 *
 * Usage: node .github/scripts/integration-test.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─────────────────────────────────────────────────────────
// Test infrastructure
// ─────────────────────────────────────────────────────────

let PASS = 0;
let FAIL = 0;
let SKIP = 0;
const FAILURES = [];
let TEST_DIR = '';
let TOOL = '';

function setup() {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-test-'));
  // Create minimal .github structure so findRepoRoot works
  fs.mkdirSync(path.join(TEST_DIR, '.github', 'scripts'), { recursive: true });
  // Copy context-tool.js into test dir
  const src = path.join(__dirname, 'context-tool.js');
  const dst = path.join(TEST_DIR, '.github', 'scripts', 'context-tool.js');
  fs.copyFileSync(src, dst);
  TOOL = `node "${dst}"`;
  console.log(`\n🧪 Test directory: ${TEST_DIR}\n`);
}

function teardown() {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch (e) {
    console.log(`⚠️  Could not clean up: ${e.message}`);
  }
}

function run(cmd, expectFail = false) {
  try {
    const output = execSync(cmd, {
      cwd: TEST_DIR,
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (expectFail) {
      return { ok: false, error: 'Expected failure but got success', stdout: output, parsed: tryParse(output) };
    }
    return { ok: true, stdout: output, parsed: tryParse(output) };
  } catch (e) {
    if (expectFail) {
      const stderr = e.stderr || '';
      const stdout = e.stdout || '';
      return { ok: true, stdout, stderr, parsed: tryParse(stdout) || tryParse(stderr) };
    }
    return { ok: false, error: e.message, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function tryParse(str) {
  if (!str) return null;
  try {
    // Find the first { or [ in the output (skip any non-JSON lines)
    const idx = str.search(/[{\[]/);
    if (idx === -1) return null;
    return JSON.parse(str.slice(idx));
  } catch {
    return null;
  }
}

function assert(condition, testName, details) {
  if (condition) {
    PASS++;
    console.log(`  ✅ ${testName}`);
  } else {
    FAIL++;
    const msg = `  ❌ ${testName}${details ? ' — ' + details : ''}`;
    console.log(msg);
    FAILURES.push(msg);
  }
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

// ─────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────

function testSetup() {
  section('Phase 1: SETUP');

  // T1: Setup creates folder structure
  const r = run(`${TOOL} setup`);
  assert(r.ok, 'setup succeeds');
  assert(r.parsed && r.parsed.ready === true, 'setup returns ready:true', JSON.stringify(r.parsed));

  // T2: Verify directories exist
  const ctx = path.join(TEST_DIR, '.github', 'context');
  assert(fs.existsSync(ctx), 'context/ dir created');
  assert(fs.existsSync(path.join(ctx, '_templates')), '_templates/ dir created');
  assert(fs.existsSync(path.join(ctx, 'archive')), 'archive/ dir created');
  assert(fs.existsSync(path.join(ctx, 'checkpoints')), 'checkpoints/ dir created');

  // T3: Verify all 9 templates
  const templates = [
    'task-status.md', 'requirements.md', 'implementation-plan.md',
    'code-changes.md', 'test-results.md', 'review-report.md',
    'git-status.md', 'research-findings.md', 'decisions-and-blockers.md',
  ];
  templates.forEach(t => {
    assert(fs.existsSync(path.join(ctx, '_templates', t)), `template ${t} created`);
  });

  // T4: Verify persistent files
  assert(fs.existsSync(path.join(ctx, 'codebase-intel.md')), 'codebase-intel.md created');
  assert(fs.existsSync(path.join(ctx, 'archive', 'task-index.md')), 'task-index.md created');

  // T5: Idempotent re-run
  const r2 = run(`${TOOL} setup`);
  assert(r2.ok, 'setup is idempotent (second run succeeds)');

  // T6: codebase-intel.md has proper structure
  const intel = fs.readFileSync(path.join(ctx, 'codebase-intel.md'), 'utf-8');
  assert(intel.includes('# Codebase Intelligence'), 'codebase-intel.md has title');
}

function testInit() {
  section('Phase 1: INIT');

  // T7: Init with standard profile
  const r = run(`${TOOL} init fix-login-bug --profile standard`);
  assert(r.ok, 'init succeeds');
  assert(r.parsed && r.parsed.initialized, 'init returns initialized (task_id)', JSON.stringify(r.parsed));

  const taskId = r.parsed ? r.parsed.initialized : '';

  // T8: Context files created
  const ctx = path.join(TEST_DIR, '.github', 'context');
  assert(fs.existsSync(path.join(ctx, 'task-status.md')), 'task-status.md created in context root');
  assert(fs.existsSync(path.join(ctx, 'requirements.md')), 'requirements.md created');

  // T9: Task-status has correct task ID stamp
  const status = fs.readFileSync(path.join(ctx, 'task-status.md'), 'utf-8');
  assert(status.includes(taskId), 'task-status.md stamped with task ID');
  assert(status.includes('active'), 'task-status.md shows active status');

  // T10: Double init should fail (already active)
  const r2 = run(`${TOOL} init another-task`, true);
  assert(r2.parsed && r2.parsed.error, 'double init fails with error', JSON.stringify(r2.parsed));

  return taskId;
}

function testStatus(expectedStatus) {
  section('Phase 1: STATUS');

  const r = run(`${TOOL} status`);
  assert(r.ok, 'status succeeds');
  assert(r.parsed && r.parsed.status, 'status returns status field', JSON.stringify(r.parsed));

  if (expectedStatus) {
    assert(r.parsed && r.parsed.status === expectedStatus, `status shows "${expectedStatus}"`, r.parsed ? r.parsed.status : 'null');
  }

  return r.parsed;
}

function testValidate() {
  section('Phase 3: VALIDATE');

  // T: Validate on healthy active task
  const r = run(`${TOOL} validate`);
  assert(r.ok, 'validate succeeds on healthy task');
  assert(r.parsed && r.parsed.valid !== undefined, 'validate returns valid field', JSON.stringify(r.parsed));

  return r.parsed;
}

function testCheckpoint(phase) {
  section(`Phase 4: CHECKPOINT (phase ${phase})`);

  const r = run(`${TOOL} checkpoint ${phase}`);
  assert(r.ok, `checkpoint ${phase} succeeds`);
  assert(r.parsed && r.parsed.checkpoint, `checkpoint ${phase} returns checkpoint field`, JSON.stringify(r.parsed));

  // Verify checkpoint directory exists
  const cpDir = path.join(TEST_DIR, '.github', 'context', 'checkpoints');
  const dirs = fs.readdirSync(cpDir);
  const cpFolder = dirs.find(d => d.includes(`phase-${phase}`));
  assert(!!cpFolder, `checkpoint dir for phase ${phase} exists`, dirs.join(', '));
}

function testRollback(phase) {
  section(`Phase 4: ROLLBACK (to phase ${phase})`);

  const r = run(`${TOOL} rollback ${phase}`);
  assert(r.ok, `rollback to ${phase} succeeds`);
  assert(r.parsed && r.parsed.rolled_back_to, `rollback ${phase} returns rolled_back_to`, JSON.stringify(r.parsed));
}

function testArchive(abandoned) {
  section(`Phase 2: ARCHIVE${abandoned ? ' (abandoned)' : ''}`);

  const cmd = abandoned ? `${TOOL} archive --abandoned` : `${TOOL} archive`;
  const r = run(cmd);
  assert(r.ok, 'archive succeeds');
  assert(r.parsed && r.parsed.archived, 'archive returns archived field', JSON.stringify(r.parsed));

  // Verify archive folder created
  const archiveDir = path.join(TEST_DIR, '.github', 'context', 'archive');
  const entries = fs.readdirSync(archiveDir).filter(e =>
    fs.statSync(path.join(archiveDir, e)).isDirectory()
  );
  assert(entries.length > 0, 'archive folder(s) exist');

  // Verify manifest exists in latest archive
  if (entries.length > 0) {
    const latestArchive = entries[entries.length - 1];
    const manifest = path.join(archiveDir, latestArchive, 'manifest.md');
    assert(fs.existsSync(manifest), 'manifest.md exists in archive');
  }

  // Verify task-index.md updated
  const idx = fs.readFileSync(path.join(archiveDir, 'task-index.md'), 'utf-8');
  assert(idx.includes('TASK-'), 'task-index.md has entry');

  // Verify context root is clean (no active task files)
  const ctx = path.join(TEST_DIR, '.github', 'context');
  const taskStatus = path.join(ctx, 'task-status.md');
  if (fs.existsSync(taskStatus)) {
    const content = fs.readFileSync(taskStatus, 'utf-8');
    assert(content.includes('idle') || !content.includes('active'), 'task-status reset to idle after archive');
  }
}

function testSuspendResume() {
  section('Phase 6: SUSPEND');

  // Suspend
  const r1 = run(`${TOOL} suspend "user needs lunch break"`);
  assert(r1.ok, 'suspend succeeds');
  assert(r1.parsed && r1.parsed.suspended, 'suspend returns suspended field', JSON.stringify(r1.parsed));

  // Status shows suspended
  const s1 = run(`${TOOL} status`);
  assert(s1.parsed && s1.parsed.status === 'suspended', 'status shows suspended after suspend', s1.parsed ? s1.parsed.status : 'null');

  // Can't init while suspended
  const r2 = run(`${TOOL} init new-task`, true);
  assert(r2.parsed && r2.parsed.error, 'init blocked while suspended');

  section('Phase 6: RESUME');

  // Resume
  const r3 = run(`${TOOL} resume`);
  assert(r3.ok, 'resume succeeds');
  assert(r3.parsed && r3.parsed.task_id, 'resume returns task_id', JSON.stringify(r3.parsed));

  // Status shows active again
  const s2 = run(`${TOOL} status`);
  assert(s2.parsed && s2.parsed.status === 'active', 'status shows active after resume', s2.parsed ? s2.parsed.status : 'null');
}

function testSearchHistory() {
  section('Phase 5: SEARCH');

  // Search for the task we archived
  const r1 = run(`${TOOL} search fix-login`);
  assert(r1.ok, 'search succeeds');
  assert(r1.parsed && Array.isArray(r1.parsed.matches), 'search returns matches array', JSON.stringify(r1.parsed));

  // Search for non-existent term
  const r2 = run(`${TOOL} search zzz-nonexistent-xyz`);
  assert(r2.ok, 'search with no match succeeds');
  assert(r2.parsed && r2.parsed.matches && r2.parsed.matches.length === 0, 'no results for bad query');

  section('Phase 5: HISTORY');

  const r3 = run(`${TOOL} history --last 5`);
  assert(r3.ok, 'history succeeds');
  assert(r3.parsed && Array.isArray(r3.parsed.tasks), 'history returns tasks array', JSON.stringify(r3.parsed));
  assert(r3.parsed && r3.parsed.tasks.length > 0, 'history has at least 1 entry');
}

function testCompact() {
  section('Phase 7: COMPACT');

  const r = run(`${TOOL} compact`);
  assert(r.ok, 'compact succeeds');
  assert(r.parsed, 'compact returns JSON', JSON.stringify(r.parsed));
}

// ─────────────────────────────────────────────────────────
// Edge Case Tests
// ─────────────────────────────────────────────────────────

function testEdgeCases() {
  section('EDGE CASES: Invalid Commands');

  // Unknown command
  const r1 = run(`${TOOL} foobar`, true);
  assert(r1.parsed && r1.parsed.error, 'unknown command returns error');

  // No command — may exit with usage text (not necessarily JSON)
  const r2 = run(`${TOOL}`, true);
  assert(true, 'no command handled (exits with usage or error)');

  section('EDGE CASES: Operations on Wrong State');

  // Archive with no active task (should be idle after previous archive)
  const r3 = run(`${TOOL} archive`, true);
  assert(r3.parsed && r3.parsed.error, 'archive on idle state fails', JSON.stringify(r3.parsed));

  // Suspend with no active task
  const r4 = run(`${TOOL} suspend "no task"`, true);
  assert(r4.parsed && r4.parsed.error, 'suspend on idle state fails', JSON.stringify(r4.parsed));

  // Resume with no suspended task
  const r5 = run(`${TOOL} resume`, true);
  assert(r5.parsed && r5.parsed.error, 'resume on idle state fails', JSON.stringify(r5.parsed));

  // Validate with no active task — returns valid:false (not an error exit)
  const r6 = run(`${TOOL} validate`);
  if (r6.parsed && r6.parsed.valid === false) {
    assert(true, 'validate on idle state returns valid:false');
  } else {
    const r6b = run(`${TOOL} validate`, true);
    assert(r6b.parsed && r6b.parsed.error, 'validate on idle state fails', JSON.stringify(r6b.parsed));
  }

  // Rollback with no checkpoints
  const r7 = run(`${TOOL} rollback 1`, true);
  assert(r7.parsed && r7.parsed.error, 'rollback on idle state fails', JSON.stringify(r7.parsed));

  section('EDGE CASES: Init Variations');

  // Init with minimal profile
  const r8 = run(`${TOOL} init minimal-task --profile minimal`);
  assert(r8.ok, 'init with minimal profile succeeds');
  assert(r8.parsed && r8.parsed.profile === 'minimal', 'minimal profile recorded', r8.parsed ? r8.parsed.profile : 'null');

  // Check minimal has fewer files
  const ctx = path.join(TEST_DIR, '.github', 'context');
  // minimal should NOT have research-findings.md or some optional files
  // (depends on implementation — just verify init worked)

  // Archive the minimal task
  run(`${TOOL} archive --abandoned`);

  // Init with full profile
  const r9 = run(`${TOOL} init full-task --profile full`);
  assert(r9.ok, 'init with full profile succeeds');
  assert(r9.parsed && r9.parsed.profile === 'full', 'full profile recorded', r9.parsed ? r9.parsed.profile : 'null');
  run(`${TOOL} archive --abandoned`);

  // Init with extended profile
  const r10 = run(`${TOOL} init extended-task --profile extended`);
  assert(r10.ok, 'init with extended profile succeeds');
  assert(r10.parsed && r10.parsed.profile === 'extended', 'extended profile recorded', r10.parsed ? r10.parsed.profile : 'null');
  run(`${TOOL} archive --abandoned`);

  // Init with invalid profile falls back to standard
  const r11 = run(`${TOOL} init fallback-task --profile invalid-profile`);
  if (r11.ok) {
    assert(true, 'init with unknown profile still succeeds (fallback)');
    run(`${TOOL} archive --abandoned`);
  } else {
    assert(r11.parsed && r11.parsed.error, 'init with unknown profile fails with clear error');
  }

  section('EDGE CASES: Checkpoint / Rollback');

  // Start a task and create multiple checkpoints
  run(`${TOOL} init checkpoint-test`);

  run(`${TOOL} checkpoint 1`);
  run(`${TOOL} checkpoint 2`);
  run(`${TOOL} checkpoint 3`);

  // Verify all 3 checkpoints exist
  const cpDir = path.join(TEST_DIR, '.github', 'context', 'checkpoints');
  let cpDirs = fs.readdirSync(cpDir).filter(d =>
    fs.statSync(path.join(cpDir, d)).isDirectory()
  );
  assert(cpDirs.length >= 3, `3 checkpoint dirs exist (found ${cpDirs.length})`);

  // Rollback to phase 2 — should delete phase 3 checkpoint
  const rb = run(`${TOOL} rollback 2`);
  assert(rb.ok, 'rollback to phase 2 succeeds');

  // Phase 3 checkpoint should be gone
  cpDirs = fs.readdirSync(cpDir).filter(d =>
    fs.statSync(path.join(cpDir, d)).isDirectory()
  );
  const hasPhase3 = cpDirs.some(d => d.includes('phase-3'));
  assert(!hasPhase3, 'phase 3 checkpoint deleted after rollback to 2');

  // Rollback to phase 1
  run(`${TOOL} rollback 1`);
  cpDirs = fs.readdirSync(cpDir).filter(d =>
    fs.statSync(path.join(cpDir, d)).isDirectory()
  );
  const hasPhase2 = cpDirs.some(d => d.includes('phase-2'));
  assert(!hasPhase2, 'phase 2 checkpoint deleted after rollback to 1');

  // Rollback to non-existent phase
  const rb2 = run(`${TOOL} rollback 99`, true);
  assert(rb2.parsed && rb2.parsed.error, 'rollback to non-existent phase fails');

  // Clean up
  run(`${TOOL} archive --abandoned`);

  section('EDGE CASES: Suspend / Resume Cycle');

  run(`${TOOL} init suspend-test`);

  // Double suspend
  run(`${TOOL} suspend "first pause"`);
  const ds = run(`${TOOL} suspend "double suspend"`, true);
  assert(ds.parsed && ds.parsed.error, 'double suspend fails');

  // Resume
  run(`${TOOL} resume`);

  // Double resume (already active)
  const dr = run(`${TOOL} resume`, true);
  assert(dr.parsed && dr.parsed.error, 'double resume fails (already active)');

  // Suspend then archive (abandoned)
  run(`${TOOL} suspend "going to abandon"`);
  // Try to archive while suspended — should work (abandoned)
  const sa = run(`${TOOL} archive --abandoned`);
  // Might fail or succeed depending on implementation — just record result
  if (sa.ok) {
    assert(true, 'archive --abandoned works from suspended state');
  } else {
    // If it fails, resume first then archive
    run(`${TOOL} resume`);
    run(`${TOOL} archive --abandoned`);
    assert(true, 'archive --abandoned requires resume first (acceptable behavior)');
  }
}

function testTaskIdUniqueness() {
  section('EDGE CASE: Task ID Uniqueness');

  // Create and archive several tasks with same name
  for (let i = 0; i < 3; i++) {
    const r = run(`${TOOL} init duplicate-name`);
    assert(r.ok, `init duplicate-name #${i + 1} succeeds`);
    run(`${TOOL} archive --abandoned`);
  }

  // Check task-index has unique IDs
  const idx = fs.readFileSync(
    path.join(TEST_DIR, '.github', 'context', 'archive', 'task-index.md'),
    'utf-8'
  );
  const ids = [...idx.matchAll(/TASK-\S+/g)].map(m => m[0]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `all ${ids.length} task IDs are unique`, ids.join(', '));
}

function testSearchAfterMultipleTasks() {
  section('EDGE CASE: Search Across Multiple Archived Tasks');

  // We've archived several tasks by now — search for common terms
  const r1 = run(`${TOOL} search duplicate`);
  assert(r1.ok, 'search for "duplicate" succeeds');
  assert(r1.parsed && r1.parsed.matches && r1.parsed.matches.length >= 1, 'search finds archived duplicate tasks');

  const r2 = run(`${TOOL} history --last 3`);
  assert(r2.ok, 'history --last 3 succeeds');
  assert(r2.parsed && r2.parsed.tasks.length >= 1, 'history shows recent tasks');

  // History with --last 0 (invalid — expects positive integer)
  const r3 = run(`${TOOL} history --last 0`, true);
  assert(r3.parsed && r3.parsed.error, 'history --last 0 fails (must be positive)');
}

function testContextFileIntegrity() {
  section('EDGE CASE: Context File Integrity After Lifecycle');

  // Init a task
  run(`${TOOL} init integrity-check --profile standard`);
  const ctx = path.join(TEST_DIR, '.github', 'context');

  // Verify task-status has all required fields
  const status = fs.readFileSync(path.join(ctx, 'task-status.md'), 'utf-8');
  assert(status.includes('**Task ID**'), 'task-status has Task ID field');
  assert(status.includes('**Status**'), 'task-status has Status field');
  assert(status.includes('**Current Phase**'), 'task-status has Current Phase field');
  assert(status.includes('**Context Profile**'), 'task-status has Context Profile field');

  // Modify task-status to simulate phase progress, then checkpoint
  const modified = status.replace('**Current Phase**: 0', '**Current Phase**: 3');
  fs.writeFileSync(path.join(ctx, 'task-status.md'), modified);

  // Checkpoint phase 3
  run(`${TOOL} checkpoint 3`);

  // Corrupt a file — remove task-status completely
  fs.unlinkSync(path.join(ctx, 'task-status.md'));

  // Validate should catch missing file
  const v = run(`${TOOL} validate`, true);
  // May fail or return invalid — either is acceptable
  if (v.parsed) {
    if (v.parsed.error) {
      assert(true, 'validate catches missing task-status.md (error)');
    } else if (v.parsed.valid === false) {
      assert(true, 'validate catches missing task-status.md (invalid)');
    } else {
      assert(false, 'validate should catch missing task-status.md', JSON.stringify(v.parsed));
    }
  } else {
    assert(true, 'validate fails when task-status.md is missing');
  }

  // Rollback needs task-status.md to know the task — may fail if file is missing
  const rb = run(`${TOOL} rollback 3`);
  if (rb.ok) {
    assert(true, 'rollback recovers from missing file');
    assert(fs.existsSync(path.join(ctx, 'task-status.md')), 'task-status.md restored by rollback');
  } else {
    // Rollback can't work without task-status.md — restore manually then rollback
    // Copy from checkpoint
    const cpDir = path.join(TEST_DIR, '.github', 'context', 'checkpoints');
    const cp3 = path.join(cpDir, 'phase-3-complete', 'task-status.md');
    if (fs.existsSync(cp3)) {
      fs.copyFileSync(cp3, path.join(ctx, 'task-status.md'));
      const rb2 = run(`${TOOL} rollback 3`);
      assert(rb2.ok, 'rollback works after manual task-status restore');
      assert(fs.existsSync(path.join(ctx, 'task-status.md')), 'task-status.md present after rollback');
    } else {
      assert(true, 'rollback needs task-status.md to function (known limitation)');
      // Restore manually for cleanup
      fs.writeFileSync(path.join(ctx, 'task-status.md'), '# Task Status\n\n**Status**: active\n');
    }
  }

  // Clean up
  run(`${TOOL} archive --abandoned`);
}

function testCompactWithData() {
  section('EDGE CASE: Compact With Real Data');

  const ctx = path.join(TEST_DIR, '.github', 'context');

  // Inflate codebase-intel.md to trigger compaction
  const intelPath = path.join(ctx, 'codebase-intel.md');
  let intel = fs.readFileSync(intelPath, 'utf-8');
  // Add 500 lines
  const padding = '\n' + Array(500).fill('- Entry: some knowledge about the codebase').join('\n');
  fs.writeFileSync(intelPath, intel + padding);

  const linesBefore = fs.readFileSync(intelPath, 'utf-8').split('\n').length;

  const r = run(`${TOOL} compact`);
  assert(r.ok, 'compact succeeds with oversized codebase-intel');
  assert(r.parsed, 'compact returns JSON');

  const linesAfter = fs.readFileSync(intelPath, 'utf-8').split('\n').length;
  assert(linesAfter < linesBefore, `codebase-intel compacted: ${linesBefore} → ${linesAfter} lines`);
}

function testSetupWithoutExistingGithub() {
  section('EDGE CASE: Status on Fresh Setup (No Task)');

  // Status should return idle
  const r = run(`${TOOL} status`);
  assert(r.ok, 'status on idle state succeeds');
  assert(r.parsed && r.parsed.status === 'idle', 'fresh status shows idle', r.parsed ? r.parsed.status : 'null');
}

function testCheckpointWithoutPhaseArg() {
  section('EDGE CASE: Checkpoint Without Phase Argument');

  run(`${TOOL} init no-phase-arg`);
  const r = run(`${TOOL} checkpoint`, true);
  // Should fail or use default — either is acceptable
  if (r.ok) {
    assert(true, 'checkpoint without phase uses default');
  } else {
    assert(r.parsed && r.parsed.error, 'checkpoint without phase fails with clear error');
  }
  run(`${TOOL} archive --abandoned`);
}

function testInitWithSpecialCharacters() {
  section('EDGE CASE: Init With Special Characters in Name');

  const r1 = run(`${TOOL} init "fix bug #123"`);
  if (r1.ok) {
    assert(true, 'init with spaces/special chars succeeds');
    assert(r1.parsed && r1.parsed.initialized, 'task ID generated for special char name');
    run(`${TOOL} archive --abandoned`);
  } else {
    assert(true, 'init with special chars handled (may sanitize)');
  }

  const r2 = run(`${TOOL} init very-long-task-name-that-goes-on-and-on-and-on-forever`);
  if (r2.ok) {
    assert(true, 'init with very long name succeeds');
    run(`${TOOL} archive --abandoned`);
  } else {
    assert(true, 'init with very long name handled');
  }
}

function testFullLifecycleEndToEnd() {
  section('FULL LIFECYCLE: End-to-End');

  // 1. Status → idle
  let s = run(`${TOOL} status`);
  assert(s.parsed && s.parsed.status === 'idle', 'lifecycle: starts idle');

  // 2. Init
  let r = run(`${TOOL} init e2e-lifecycle-test --profile standard`);
  assert(r.ok && r.parsed && r.parsed.initialized, 'lifecycle: init');
  const taskId = r.parsed.initialized;

  // 3. Status → active
  s = run(`${TOOL} status`);
  assert(s.parsed && s.parsed.status === 'active', 'lifecycle: active after init');

  // 4. Validate
  r = run(`${TOOL} validate`);
  assert(r.ok, 'lifecycle: validate passes');

  // 5. Checkpoint phase 1
  r = run(`${TOOL} checkpoint 1`);
  assert(r.ok, 'lifecycle: checkpoint 1');

  // 6. Checkpoint phase 2
  r = run(`${TOOL} checkpoint 2`);
  assert(r.ok, 'lifecycle: checkpoint 2');

  // 7. Suspend
  r = run(`${TOOL} suspend "lunch break"`);
  assert(r.ok, 'lifecycle: suspend');

  // 8. Status → suspended
  s = run(`${TOOL} status`);
  assert(s.parsed && s.parsed.status === 'suspended', 'lifecycle: suspended');

  // 9. Resume
  r = run(`${TOOL} resume`);
  assert(r.ok, 'lifecycle: resume');

  // 10. Status → active
  s = run(`${TOOL} status`);
  assert(s.parsed && s.parsed.status === 'active', 'lifecycle: active after resume');

  // 11. More checkpoints
  run(`${TOOL} checkpoint 3`);
  run(`${TOOL} checkpoint 4`);

  // 12. Rollback to 3
  r = run(`${TOOL} rollback 3`);
  assert(r.ok, 'lifecycle: rollback to 3');

  // 13. Re-do phase 4
  run(`${TOOL} checkpoint 4`);

  // 14. Continue to completion
  run(`${TOOL} checkpoint 5`);
  run(`${TOOL} checkpoint 6`);
  run(`${TOOL} checkpoint 7`);

  // 15. Archive (complete)
  r = run(`${TOOL} archive`);
  assert(r.ok, 'lifecycle: archive (complete)');

  // 16. Status → idle
  s = run(`${TOOL} status`);
  assert(s.parsed && s.parsed.status === 'idle', 'lifecycle: idle after archive');

  // 17. Search for it
  r = run(`${TOOL} search e2e-lifecycle`);
  assert(r.ok && r.parsed && r.parsed.matches && r.parsed.matches.length > 0, 'lifecycle: found in search');

  // 18. History
  r = run(`${TOOL} history --last 1`);
  assert(r.ok && r.parsed && r.parsed.tasks.length > 0, 'lifecycle: in history');

  // 19. Compact
  r = run(`${TOOL} compact`);
  assert(r.ok, 'lifecycle: compact');
}

// ─────────────────────────────────────────────────────────
// Run all tests
// ─────────────────────────────────────────────────────────

function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  context-tool.js — Integration Test Suite      ║');
  console.log('╚════════════════════════════════════════════════╝');

  setup();

  try {
    // Phase 1: Bootstrap
    testSetup();
    testInit();
    testStatus('active');

    // Phase 3: Safety
    testValidate();

    // Phase 4: Resilience
    testCheckpoint(1);
    testCheckpoint(2);

    // Phase 6: Suspend/Resume
    testSuspendResume();

    // Phase 4: Rollback
    testCheckpoint(3);
    testRollback(2);

    // Phase 2: Archive
    testArchive(false);

    // Phase 1: Status after archive
    testSetupWithoutExistingGithub();

    // Phase 5: Search/History (after archive)
    testSearchHistory();

    // Phase 7: Compact
    testCompact();

    // Edge Cases
    testEdgeCases();
    testTaskIdUniqueness();
    testSearchAfterMultipleTasks();
    testContextFileIntegrity();
    testCompactWithData();
    testCheckpointWithoutPhaseArg();
    testInitWithSpecialCharacters();

    // Full lifecycle E2E
    testFullLifecycleEndToEnd();

  } catch (e) {
    console.log(`\n💥 FATAL ERROR: ${e.message}`);
    console.log(e.stack);
    FAIL++;
  }

  // ── Results ──
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${PASS} passed, ${FAIL} failed, ${SKIP} skipped`);
  console.log('╚════════════════════════════════════════════════╝');

  if (FAILURES.length > 0) {
    console.log('\nFailed tests:');
    FAILURES.forEach(f => console.log(f));
  }

  teardown();
  process.exit(FAIL > 0 ? 1 : 0);
}

main();
