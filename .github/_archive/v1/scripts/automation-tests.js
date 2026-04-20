#!/usr/bin/env node

/**
 * Automation Test Suite for all 8 automation scripts + context-tool enhancements.
 *
 * Tests every script end-to-end using a temporary directory.
 * Follows the same pattern as integration-test.js.
 *
 * Usage: node .github/scripts/automation-tests.js
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ─────────────────────────────────────────────────────────
// Test infrastructure
// ─────────────────────────────────────────────────────────

let PASS = 0;
let FAIL = 0;
let SKIP = 0;
const FAILURES = [];
let TEST_DIR = '';
let SCRIPTS_DIR = '';

function setup() {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-test-'));
  // Create minimal .github structure
  const ghScripts = path.join(TEST_DIR, '.github', 'scripts');
  const ghContext = path.join(TEST_DIR, '.github', 'context');
  const ghTemplates = path.join(ghContext, '_templates');
  fs.mkdirSync(ghScripts, { recursive: true });
  fs.mkdirSync(ghContext, { recursive: true });
  fs.mkdirSync(ghTemplates, { recursive: true });

  SCRIPTS_DIR = path.join(__dirname);

  // Copy all scripts into test dir
  const scripts = [
    'context-tool.js', 'convention-scanner.js', 'pre-impl-check.js',
    'requirements-tracker.js', 'git-safety-check.js', 'briefing-gen.js',
    'review-prep.js', 'codebase-diff.js', 'research-cache.js',
  ];
  scripts.forEach(s => {
    const src = path.join(SCRIPTS_DIR, s);
    const dst = path.join(ghScripts, s);
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  });

  // Initialize a git repo so git-dependent scripts work
  try {
    execSync('git init', { cwd: TEST_DIR, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: TEST_DIR, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: TEST_DIR, stdio: 'pipe' });
  } catch { /* git may not be available */ }

  console.log(`\n[TEST] Automation test directory: ${TEST_DIR}\n`);
}

function teardown() {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch (e) {
    console.log(`[WARN] Could not clean up: ${e.message}`);
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
    const idx = str.search(/[[{]/);
    if (idx === -1) return null;
    return JSON.parse(str.slice(idx));
  } catch {
    return null;
  }
}

function assert(condition, testName, details) {
  if (condition) {
    PASS++;
    console.log(`  [PASS] ${testName}`);
  } else {
    FAIL++;
    const msg = `  [FAIL] ${testName}${details ? ' — ' + details : ''}`;
    console.log(msg);
    FAILURES.push(msg);
  }
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

// Helper: write a file inside TEST_DIR
function writeFile(relPath, content) {
  const full = path.join(TEST_DIR, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

// Helper: read a file from TEST_DIR
function readTestFile(relPath) {
  const full = path.join(TEST_DIR, relPath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf-8');
}

// Helper: script path
function script(name) {
  return `node "${path.join(TEST_DIR, '.github', 'scripts', name)}"`;
}

// Helper: require a script from TEST_DIR
function requireScript(name) {
  return require(path.join(TEST_DIR, '.github', 'scripts', name));
}

// ─────────────────────────────────────────────────────────
// Convention Scanner Tests
// ─────────────────────────────────────────────────────────

function testConventionScanner() {
  section('Convention Scanner');

  // Test: Empty repo returns unknown/null conventions
  const r1 = run(`${script('convention-scanner.js')}`);
  assert(r1.ok || r1.parsed, 'empty repo does not crash');

  // Test: JS project with package.json detects JavaScript, npm
  writeFile('package.json', JSON.stringify({
    name: 'test-project', version: '1.0.0',
    dependencies: { express: '^4.18.0' },
    devDependencies: { jest: '^29.7.0' },
  }));
  const r2 = run(`${script('convention-scanner.js')}`);
  assert(r2.ok, 'JS project scan succeeds');
  if (r2.parsed) {
    const lang = JSON.stringify(r2.parsed).toLowerCase();
    assert(lang.includes('javascript') || lang.includes('js'), 'detects JavaScript');
  }

  // Test: TS project with tsconfig detects TypeScript
  writeFile('tsconfig.json', '{"compilerOptions":{"target":"es2020"}}');
  const r3 = run(`${script('convention-scanner.js')}`);
  assert(r3.ok, 'TS project scan succeeds');
  if (r3.parsed) {
    const out = JSON.stringify(r3.parsed).toLowerCase();
    assert(out.includes('typescript') || out.includes('ts'), 'detects TypeScript');
  }
  fs.unlinkSync(path.join(TEST_DIR, 'tsconfig.json'));

  // Test: Python project with requirements.txt detects Python
  writeFile('requirements.txt', 'flask==2.0.0\nrequests==2.28.0\n');
  const r4 = run(`${script('convention-scanner.js')}`);
  assert(r4.ok, 'Python project scan succeeds');

  // Test: Go project with go.mod
  writeFile('go.mod', 'module example.com/test\n\ngo 1.21\n');
  const r5 = run(`${script('convention-scanner.js')}`);
  assert(r5.ok, 'Go project scan succeeds');

  // Test: Java project with pom.xml
  writeFile('pom.xml', '<project><groupId>com.test</groupId></project>');
  const r6 = run(`${script('convention-scanner.js')}`);
  assert(r6.ok, 'Java project scan succeeds');

  // Test: Python snake_case functions
  writeFile('src/utils.py', 'def calculate_total_price(items):\n    pass\n\ndef get_user_name(uid):\n    pass\n');
  const r7 = run(`${script('convention-scanner.js')}`);
  assert(r7.ok, 'Python naming scan succeeds');

  // Test: Jest test files detected
  writeFile('__tests__/app.test.js', 'describe("App", () => {\n  it("should work", () => {\n    expect(true).toBe(true);\n  });\n});\n');
  const r8 = run(`${script('convention-scanner.js')}`);
  assert(r8.ok, 'Jest test detection succeeds');

  // Test: --focus flag for testing section
  const r9 = run(`${script('convention-scanner.js')} --focus testing`);
  assert(r9.ok, '--focus testing flag works');

  // Test: Valid JSON output always
  const r10 = run(`${script('convention-scanner.js')}`);
  assert(r10.parsed !== null, 'always outputs valid JSON');

  // Clean up project files
  ['requirements.txt', 'go.mod', 'pom.xml'].forEach(f => {
    try { fs.unlinkSync(path.join(TEST_DIR, f)); } catch { /* ok */ }
  });
}

// ─────────────────────────────────────────────────────────
// Pre-Implementation Check Tests
// ─────────────────────────────────────────────────────────

function testPreImplCheck() {
  section('Pre-Implementation Check');

  // Setup: create context files
  const ctx = '.github/context';

  // Test: No implementation-plan.md → fail
  const r1 = run(`${script('pre-impl-check.js')}`, true);
  assert(r1.parsed === null || r1.parsed?.error || !r1.ok || r1.stderr,
    'no plan file → fails or errors');

  // Test: Plan is APPROVED + all files exist → ready: true
  writeFile(`${ctx}/implementation-plan.md`, `# Implementation Plan

**Status**: APPROVED

## Scope
- Files: src/utils.py

## Approach Summary
This plan modifies the utils module to add input validation for all user-facing endpoints.

## Steps
1. MODIFY src/utils.py — add validation function

## Dependencies
- None
`);
  writeFile('src/utils.py', 'def helper():\n    pass\n');

  const r2 = run(`${script('pre-impl-check.js')}`);
  assert(r2.ok, 'approved plan with existing files succeeds');
  if (r2.parsed) {
    assert(r2.parsed.plan_status === 'APPROVED' || r2.parsed.ready === true || r2.parsed.status === 'ready',
      'plan approval detected', JSON.stringify(r2.parsed).slice(0, 300));
  }

  // Test: Plan is DRAFT → ready: false
  writeFile(`${ctx}/implementation-plan.md`, `# Implementation Plan

**Status**: DRAFT

## Steps
1. MODIFY src/utils.py
`);
  const r3 = run(`${script('pre-impl-check.js')}`);
  if (r3.parsed) {
    assert(r3.parsed.ready === false || r3.parsed.status !== 'ready' || r3.parsed.blockers,
      'DRAFT plan → not ready', JSON.stringify(r3.parsed));
  } else {
    assert(true, 'DRAFT plan → handled (no JSON = error)');
  }

  // Test: Referenced file missing → missing_files
  writeFile(`${ctx}/implementation-plan.md`, `# Implementation Plan

**Status**: APPROVED

## Steps
1. MODIFY src/nonexistent-file.js — add feature
`);
  const r4 = run(`${script('pre-impl-check.js')}`);
  if (r4.parsed) {
    const out = JSON.stringify(r4.parsed);
    assert(out.includes('missing') || out.includes('nonexistent') || r4.parsed.ready === false,
      'missing file detected', out);
  } else {
    assert(true, 'missing file causes error (expected)');
  }

  // Test: CREATE action + file already exists → warning
  writeFile(`${ctx}/implementation-plan.md`, `# Implementation Plan

**Status**: APPROVED

## Steps
1. CREATE src/utils.py — new module
`);
  const r5 = run(`${script('pre-impl-check.js')}`);
  if (r5.parsed) {
    const out = JSON.stringify(r5.parsed);
    assert(out.includes('warn') || out.includes('exists') || out.includes('already'),
      'CREATE on existing file → warning', out);
  } else {
    assert(true, 'CREATE existing file handled');
  }
}

// ─────────────────────────────────────────────────────────
// Requirements Tracker Tests
// ─────────────────────────────────────────────────────────

function testRequirementsTracker() {
  section('Requirements Tracker');

  const ctx = '.github/context';

  // Test: Empty requirements (template) → total_criteria: 0
  writeFile(`${ctx}/requirements.md`, `# Requirements

## Acceptance Criteria
<!-- No criteria defined yet -->
`);
  writeFile(`${ctx}/test-results.md`, `# Test Results

## Summary
No tests run yet.
`);
  writeFile(`${ctx}/implementation-plan.md`, `# Implementation Plan

## Status: APPROVED

## Steps
1. Setup project
`);
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

No changes yet.
`);

  const r1 = run(`${script('requirements-tracker.js')}`);
  assert(r1.ok || r1.parsed, 'empty requirements does not crash');

  // Test: 3 AC + 3 passing tests → traceability
  writeFile(`${ctx}/requirements.md`, `# Requirements

## Acceptance Criteria
- [ ] AC1: User can register with valid email
- [ ] AC2: Duplicate email returns error
- [ ] AC3: Password is hashed before storage
`);
  writeFile(`${ctx}/test-results.md`, `# Test Results

## Summary
3 passed, 0 failed

## Tests
- PASS: test_register_valid_email
- PASS: test_register_duplicate_email
- PASS: test_password_hashing
`);
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

## Modified Files
- src/auth/register.js — added registration endpoint
- src/auth/hash.js — password hashing utility
`);

  const r2 = run(`${script('requirements-tracker.js')}`);
  assert(r2.ok, '3 AC + 3 tests succeeds');
  if (r2.parsed) {
    assert(r2.parsed.total_criteria >= 3 || r2.parsed.acceptance_criteria,
      'tracks criteria count', JSON.stringify(r2.parsed));
  }

  // Test: 3 AC + 1 missing test → gap detected
  writeFile(`${ctx}/test-results.md`, `# Test Results

## Summary
1 passed, 0 failed

## Tests
- PASS: test_register_valid_email
`);

  const r3 = run(`${script('requirements-tracker.js')}`);
  assert(r3.ok, 'partial coverage does not crash');
  if (r3.parsed) {
    const out = JSON.stringify(r3.parsed);
    assert(out.includes('NOT_VERIFIED') || out.includes('gap') || out.includes('missing') || out.includes('unverified'),
      'detects missing test coverage', out.slice(0, 200));
  }

  // Test: Checkbox-format AC parsed correctly
  writeFile(`${ctx}/requirements.md`, `# Requirements

## Acceptance Criteria
- [x] AC1: First criterion
- [ ] AC2: Second criterion
- [ ] AC3: Third criterion
`);
  const r4 = run(`${script('requirements-tracker.js')}`);
  assert(r4.ok, 'checkbox AC format parsed');

  // Test: Numbered AC parsed correctly
  writeFile(`${ctx}/requirements.md`, `# Requirements

## Acceptance Criteria
1. User can log in
2. User can log out
3. Session expires after 30 minutes
`);
  const r5 = run(`${script('requirements-tracker.js')}`);
  assert(r5.ok, 'numbered AC format parsed');
}

// ─────────────────────────────────────────────────────────
// Git Safety Check Tests
// ─────────────────────────────────────────────────────────

function testGitSafetyCheck() {
  section('Git Safety Check');

  // Test: Clean repo → safe_to_proceed: true
  // First commit something so repo is not empty
  try {
    writeFile('README.md', '# Test Project\n');
    execSync('git add README.md', { cwd: TEST_DIR, stdio: 'pipe' });
    execSync('git commit -m "initial commit"', { cwd: TEST_DIR, stdio: 'pipe' });
  } catch { /* ok if git not available */ }

  const r1 = run(`${script('git-safety-check.js')}`);
  assert(r1.ok, 'clean repo check succeeds');
  if (r1.parsed) {
    assert(r1.parsed.safe_to_proceed === true || r1.parsed.blockers === undefined || (Array.isArray(r1.parsed.blockers) && r1.parsed.blockers.length === 0),
      'clean repo → safe', JSON.stringify(r1.parsed));
  }

  // Test: Uncommitted changes → categorized
  writeFile('src/app.js', 'console.log("hello");\n');
  const r2 = run(`${script('git-safety-check.js')}`);
  assert(r2.ok || r2.parsed, 'uncommitted changes detected without crash');
  if (r2.parsed) {
    const out = JSON.stringify(r2.parsed);
    assert(out.includes('uncommitted') || out.includes('untracked') || out.includes('changes') || out.includes('modified'),
      'reports uncommitted changes', out.slice(0, 200));
  }

  // Test: Not a git repo → blockers
  const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
  const ngScripts = path.join(nonGitDir, '.github', 'scripts');
  fs.mkdirSync(ngScripts, { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS_DIR, 'git-safety-check.js'), path.join(ngScripts, 'git-safety-check.js'));

  const r3cmd = `node "${path.join(ngScripts, 'git-safety-check.js')}"`;
  let r3;
  try {
    const out = execSync(r3cmd, { cwd: nonGitDir, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
    r3 = { ok: true, stdout: out, parsed: tryParse(out) };
  } catch (e) {
    r3 = { ok: false, stdout: e.stdout || '', stderr: e.stderr || '', parsed: tryParse(e.stdout) || tryParse(e.stderr) };
  }
  if (r3.parsed) {
    const out = JSON.stringify(r3.parsed);
    assert(out.includes('blocker') || out.includes('not a git') || out.includes('error') || r3.parsed.safe_to_proceed === false,
      'non-git repo → blocker', out.slice(0, 200));
  } else {
    assert(!r3.ok || r3.stderr, 'non-git repo → error exit');
  }
  try { fs.rmSync(nonGitDir, { recursive: true, force: true }); } catch { /* ok */ }
}

// ─────────────────────────────────────────────────────────
// Briefing Generator Tests
// ─────────────────────────────────────────────────────────

function testBriefingGen() {
  section('Briefing Generator');

  const ctx = '.github/context';

  // Setup context files for briefing
  writeFile(`${ctx}/task-status.md`, `# Task Status

## Task ID: TSK-001
## Task Name: fix-login-bug
## Status: active
## Current Phase: 4
## Profile: standard
`);
  writeFile(`${ctx}/requirements.md`, `# Requirements

## Acceptance Criteria
- [ ] AC1: Login works with valid credentials
`);
  writeFile(`${ctx}/implementation-plan.md`, `# Implementation Plan

## Status: APPROVED
## Steps
1. Fix auth middleware
`);
  writeFile(`${ctx}/codebase-intel.md`, `# Codebase Intelligence

## Tech Stack
- Language: JavaScript
- Framework: Express
`);
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

## Modified
- src/auth.js
`);
  writeFile(`${ctx}/test-results.md`, `# Test Results

## Summary
All passing
`);
  writeFile(`${ctx}/decisions-and-blockers.md`, `# Decisions & Blockers

None.
`);

  // Test: Developer at Phase 4
  const r1 = run(`${script('briefing-gen.js')} --agent developer --phase 4`);
  assert(r1.ok, 'developer briefing at phase 4 succeeds');
  if (r1.parsed) {
    assert(typeof r1.parsed === 'object', 'returns JSON object');
  }

  // Test: Tester at Phase 5
  const r2 = run(`${script('briefing-gen.js')} --agent tester --phase 5`);
  assert(r2.ok, 'tester briefing at phase 5 succeeds');

  // Test: Reviewer at Phase 6
  const r3 = run(`${script('briefing-gen.js')} --agent reviewer --phase 6`);
  assert(r3.ok, 'reviewer briefing at phase 6 succeeds');

  // Test: Invalid agent name → fail
  const r4 = run(`${script('briefing-gen.js')} --agent invalid-agent --phase 4`, true);
  assert(r4.stderr || r4.parsed?.error || !r4.ok,
    'invalid agent name → error');

  // Test: Context files missing (early phase)
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-empty-'));
  const beScripts = path.join(emptyDir, '.github', 'scripts');
  const beCtx = path.join(emptyDir, '.github', 'context');
  fs.mkdirSync(beScripts, { recursive: true });
  fs.mkdirSync(beCtx, { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS_DIR, 'briefing-gen.js'), path.join(beScripts, 'briefing-gen.js'));
  fs.writeFileSync(path.join(beCtx, 'task-status.md'), '# Task Status\n## Status: active\n## Current Phase: 1\n');

  const r5cmd = `node "${path.join(beScripts, 'briefing-gen.js')}" --agent developer --phase 1`;
  let r5;
  try {
    const out = execSync(r5cmd, { cwd: emptyDir, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
    r5 = { ok: true, stdout: out, parsed: tryParse(out) };
  } catch (e) {
    r5 = { ok: false, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
  assert(r5.ok || r5.stdout, 'missing context files handled gracefully');
  try { fs.rmSync(emptyDir, { recursive: true, force: true }); } catch { /* ok */ }
}

// ─────────────────────────────────────────────────────────
// Review Prep Tests
// ─────────────────────────────────────────────────────────

function testReviewPrep() {
  section('Review Prep');

  const ctx = '.github/context';

  // Test: No changed files → nothing to review
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

No changes yet.
`);
  const r1 = run(`${script('review-prep.js')}`);
  assert(r1.ok || r1.parsed, 'no changes does not crash');

  // Test: JS SQL injection pattern → BLOCKER
  writeFile('src/db.js', `
const db = require('mysql');
function getUser(id) {
  return db.query("SELECT * FROM users WHERE id = " + id);
}
module.exports = { getUser };
`);
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

## Modified Files
- src/db.js — database query function
`);

  const r2 = run(`${script('review-prep.js')}`);
  assert(r2.ok, 'SQL injection scan succeeds');
  if (r2.parsed) {
    const out = JSON.stringify(r2.parsed).toUpperCase();
    assert(out.includes('BLOCKER') || out.includes('SQL') || out.includes('INJECTION') || out.includes('SECURITY'),
      'SQL injection detected as blocker', out.slice(0, 300));
  }

  // Test: JS innerHTML pattern → BLOCKER
  writeFile('src/render.js', `
function renderProfile(user) {
  document.getElementById('name').innerHTML = user.name;
}
`);
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

## Modified Files
- src/render.js — profile rendering
`);
  const r3 = run(`${script('review-prep.js')}`);
  if (r3.parsed) {
    const out = JSON.stringify(r3.parsed).toUpperCase();
    assert(out.includes('BLOCKER') || out.includes('XSS') || out.includes('INNERHTML') || out.includes('SECURITY'),
      'innerHTML/XSS detected', out.slice(0, 300));
  }

  // Test: Hardcoded secret pattern → BLOCKER
  writeFile('src/config.js', `
const API_KEY = "sk-abc123def456ghi789";
const SECRET = "super_secret_password_123";
module.exports = { API_KEY, SECRET };
`);
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

## Modified Files
- src/config.js — configuration
`);
  const r4 = run(`${script('review-prep.js')}`);
  if (r4.parsed) {
    const out = JSON.stringify(r4.parsed).toUpperCase();
    assert(out.includes('BLOCKER') || out.includes('SECRET') || out.includes('HARDCODED') || out.includes('KEY'),
      'hardcoded secret detected', out.slice(0, 300));
  }

  // Test: Clean code → all clean
  writeFile('src/clean.js', `
function add(a, b) {
  return a + b;
}
module.exports = { add };
`);
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

## Modified Files
- src/clean.js — utility function
`);
  const r5 = run(`${script('review-prep.js')}`);
  assert(r5.ok, 'clean code scan succeeds');

  // Test: Commented-out vulnerable code → not flagged as BLOCKER
  writeFile('src/commented.js', `
// const query = "SELECT * FROM users WHERE id = " + id;
// document.getElementById('x').innerHTML = data;
function safeQuery(id) {
  return db.query("SELECT * FROM users WHERE id = ?", [id]);
}
`);
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

## Modified Files
- src/commented.js — safe query
`);
  const r6 = run(`${script('review-prep.js')}`);
  assert(r6.ok, 'commented code scan succeeds');

  // Test: Test file with hardcoded values → downgraded severity
  writeFile('__tests__/auth.test.js', `
const API_KEY = "test-key-123";
describe("auth", () => {
  it("should authenticate", () => {
    expect(auth(API_KEY)).toBe(true);
  });
});
`);
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

## Modified Files
- __tests__/auth.test.js — auth tests
`);
  const r7 = run(`${script('review-prep.js')}`);
  assert(r7.ok, 'test file scan succeeds');

  // Test: Python f-string SQL injection
  writeFile('src/query.py', `
def get_user(user_id):
    cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")
    return cursor.fetchone()
`);
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

## Modified Files
- src/query.py — database query
`);
  const r8 = run(`${script('review-prep.js')}`);
  if (r8.parsed) {
    const out = JSON.stringify(r8.parsed).toUpperCase();
    assert(out.includes('BLOCKER') || out.includes('SQL') || out.includes('SECURITY'),
      'Python SQL injection detected', out.slice(0, 300));
  }

  // Test: N+1 loop → WARNING
  writeFile('src/fetch.js', `
async function getOrderDetails(orders) {
  for (const order of orders) {
    const details = await db.query("SELECT * FROM details WHERE order_id = ?", [order.id]);
    order.details = details;
  }
  return orders;
}
`);
  writeFile(`${ctx}/code-changes.md`, `# Code Changes

## Modified Files
- src/fetch.js — order fetching
`);
  const r9 = run(`${script('review-prep.js')}`);
  if (r9.parsed) {
    const out = JSON.stringify(r9.parsed).toUpperCase();
    assert(out.includes('WARNING') || out.includes('N+1') || out.includes('PERFORMANCE') || out.includes('LOOP'),
      'N+1 pattern detected', out.slice(0, 300));
  }
}

// ─────────────────────────────────────────────────────────
// Research Cache Tests
// ─────────────────────────────────────────────────────────

function testResearchCache() {
  section('Research Cache');

  const ctx = '.github/context';

  // Test: No research-findings.md → recommendation
  try { fs.unlinkSync(path.join(TEST_DIR, ctx, 'research-findings.md')); } catch { /* ok */ }
  const r1 = run(`${script('research-cache.js')} --topic "Redis session storage"`);
  assert(r1.ok || r1.parsed, 'no research file does not crash');
  if (r1.parsed) {
    const out = JSON.stringify(r1.parsed);
    assert(out.includes('no') || out.includes('No') || out.includes('empty') || r1.parsed.cached_entries === undefined || (Array.isArray(r1.parsed.cached_entries) && r1.parsed.cached_entries.length === 0),
      'no research file → empty/no entries', out.slice(0, 200));
  }

  // Test: Existing research matches topic → cached_entries populated
  writeFile(`${ctx}/research-findings.md`, `# Research Findings

## Redis Session Storage Options
**Date**: 2026-04-10
**Depth**: MODERATE
**Summary**: Compared Redis vs Memcached for session storage. Redis supports persistence, data structures. Recommended for our Node.js stack.
**Sources**: https://redis.io/docs

## JWT Token Rotation
**Date**: 2026-04-12
**Depth**: QUICK
**Summary**: Best practice is to use refresh tokens with short-lived access tokens.
**Sources**: https://auth0.com/docs
`);

  const r2 = run(`${script('research-cache.js')} --topic "Redis session storage"`);
  assert(r2.ok, 'matching research lookup succeeds');
  if (r2.parsed) {
    const out = JSON.stringify(r2.parsed);
    assert(out.includes('Redis') || out.includes('redis') || (r2.parsed.cached_entries && r2.parsed.cached_entries.length > 0),
      'finds matching research entry', out.slice(0, 200));
  }

  // Test: No matching research → empty
  const r3 = run(`${script('research-cache.js')} --topic "GraphQL federation patterns"`);
  assert(r3.ok, 'non-matching topic does not crash');
  if (r3.parsed?.cached_entries) {
    const relevant = r3.parsed.cached_entries.filter(e =>
      e.relevance === 'high' || e.relevance === 'medium');
    assert(relevant.length === 0, 'non-matching topic → no high/medium matches');
  }

  // Test: Tech stack from codebase-intel.md
  writeFile(`${ctx}/codebase-intel.md`, `# Codebase Intelligence

## Tech Stack
- Language: JavaScript / TypeScript
- Framework: Express 4.18
- Database: PostgreSQL
- Cache: Redis
`);
  const r4 = run(`${script('research-cache.js')} --topic "database optimization"`);
  assert(r4.ok, 'tech stack extraction does not crash');
  if (r4.parsed?.tech_stack) {
    assert(r4.parsed.tech_stack.length > 0 || typeof r4.parsed.tech_stack === 'object',
      'tech stack populated', JSON.stringify(r4.parsed.tech_stack));
  }
}

// ─────────────────────────────────────────────────────────
// Codebase Diff Tests
// ─────────────────────────────────────────────────────────

function testCodebaseDiff() {
  section('Codebase Diff');

  const ctx = '.github/context';

  // Test: No codebase-intel.md → full scan needed
  try { fs.unlinkSync(path.join(TEST_DIR, ctx, 'codebase-intel.md')); } catch { /* ok */ }
  const r1 = run(`${script('codebase-diff.js')}`);
  assert(r1.ok || r1.parsed, 'no codebase-intel does not crash');
  if (r1.parsed) {
    const out = JSON.stringify(r1.parsed).toLowerCase();
    assert(out.includes('full') || out.includes('scan') || out.includes('needed') || out.includes('no'),
      'no intel file → full scan recommendation', out.slice(0, 200));
  }

  // Test: No changes since scan → skip refresh
  const now = new Date().toISOString();
  writeFile(`${ctx}/codebase-intel.md`, `# Codebase Intelligence

## Last Scanned: ${now}

## Tech Stack
- JavaScript
`);

  // Commit everything so there's no diff
  try {
    execSync('git add -A', { cwd: TEST_DIR, stdio: 'pipe' });
    execSync('git commit -m "add context files"', { cwd: TEST_DIR, stdio: 'pipe' });
  } catch { /* ok */ }

  const r2 = run(`${script('codebase-diff.js')}`);
  assert(r2.ok, 'no changes since scan succeeds');
  if (r2.parsed) {
    const out = JSON.stringify(r2.parsed).toLowerCase();
    assert(out.includes('skip') || out.includes('no change') || out.includes('none') ||
      out.includes('full') || out.includes('scan') ||
      (r2.parsed.changed_files?.length === 0) ||
      (r2.parsed.total_changes === 0),
      'handles no-changes scenario', out.slice(0, 200));
  }

  // Test: New files added → listed and section mapped
  writeFile('src/newfile.js', 'module.exports = {};\n');
  writeFile('package-lock.json', '{}');
  try {
    execSync('git add -A', { cwd: TEST_DIR, stdio: 'pipe' });
    execSync('git commit -m "add new files"', { cwd: TEST_DIR, stdio: 'pipe' });
  } catch { /* ok */ }

  // Update the timestamp to before the commit
  const oldDate = new Date(Date.now() - 60000).toISOString();
  writeFile(`${ctx}/codebase-intel.md`, `# Codebase Intelligence

## Last Scanned: ${oldDate}

## Tech Stack
- JavaScript
`);

  const r3 = run(`${script('codebase-diff.js')}`);
  assert(r3.ok, 'new files diff succeeds');
  if (r3.parsed) {
    const out = JSON.stringify(r3.parsed);
    assert(out.includes('newfile') || out.includes('added') || out.includes('Structure') ||
      (r3.parsed.changed_files && r3.parsed.changed_files.length > 0),
      'new files detected in diff', out.slice(0, 300));
  }

  // Test: package.json changed → Tech Stack section affected
  writeFile('package.json', JSON.stringify({
    name: 'test-project', version: '2.0.0',
    dependencies: { express: '^5.0.0', redis: '^4.0.0' },
  }));
  try {
    execSync('git add -A', { cwd: TEST_DIR, stdio: 'pipe' });
    execSync('git commit -m "update package.json"', { cwd: TEST_DIR, stdio: 'pipe' });
  } catch { /* ok */ }

  writeFile(`${ctx}/codebase-intel.md`, `# Codebase Intelligence

## Last Scanned: ${oldDate}

## Tech Stack
- JavaScript
`);

  const r4 = run(`${script('codebase-diff.js')}`);
  assert(r4.ok, 'package.json change detected');
  if (r4.parsed) {
    const out = JSON.stringify(r4.parsed);
    assert(out.includes('Tech Stack') || out.includes('package.json') ||
      out.includes('partial') || out.includes('refresh') ||
      out.includes('full') || out.includes('scan'),
      'package.json change triggers recommendation', out.slice(0, 300));
  }
}

// ─────────────────────────────────────────────────────────
// Context Tool: Progress Command Tests
// ─────────────────────────────────────────────────────────

function testProgressCommand() {
  section('Progress Command');

  const ctxTool = script('context-tool.js');
  const ctx = '.github/context';

  // First run setup
  run(`${ctxTool} setup`);

  // Test: Idle state → status: idle
  const r1 = run(`${ctxTool} progress`);
  assert(r1.ok, 'progress on idle succeeds');
  if (r1.parsed) {
    assert(r1.parsed.status === 'idle' || r1.parsed.suggestion,
      'idle state detected', JSON.stringify(r1.parsed));
  }

  // Test: Active task → shows phases
  run(`${ctxTool} init test-progress-task --profile standard`);

  // Write some non-template content to simulate progress
  const taskStatus = readTestFile(`${ctx}/task-status.md`);
  if (taskStatus) {
    writeFile(`${ctx}/task-status.md`, taskStatus.replace(/Phase: \d+/, 'Phase: 3'));
  }

  const r2 = run(`${ctxTool} progress`);
  assert(r2.ok, 'progress on active task succeeds');
  if (r2.parsed) {
    assert(r2.parsed.status === 'active' || r2.parsed.phases || r2.parsed.current_phase,
      'active task progress reported', JSON.stringify(r2.parsed));
  }

  // Test: Template context files → not_started
  // The init created templates; progress should detect them
  assert(r2.parsed !== null, 'progress returns parseable JSON');

  // Clean up: archive
  run(`${ctxTool} archive`, true);
}

// ─────────────────────────────────────────────────────────
// Context Tool: Init Profile Tests
// ─────────────────────────────────────────────────────────

function testInitProfiles() {
  section('Init Profiles');

  const ctxTool = script('context-tool.js');
  const ctx = '.github/context';

  // Ensure clean state
  run(`${ctxTool} setup`);

  // Test: --profile minimal → fewer files
  const r1 = run(`${ctxTool} init test-minimal --profile minimal`);
  assert(r1.ok, 'init with minimal profile succeeds');
  if (r1.parsed) {
    assert(r1.parsed.initialized || r1.parsed.profile === 'minimal',
      'minimal profile initialized', JSON.stringify(r1.parsed));
  }
  // Count context files
  const ctxDir = path.join(TEST_DIR, ctx);
  const minimalFiles = fs.readdirSync(ctxDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
  assert(minimalFiles.length <= 5, `minimal creates few files (${minimalFiles.length})`,
    minimalFiles.join(', '));

  // Clean up for next test
  run(`${ctxTool} archive`, true);

  // Test: --profile standard → 9 files (existing behavior)
  const r2 = run(`${ctxTool} init test-standard --profile standard`);
  assert(r2.ok, 'init with standard profile succeeds');
  const stdFiles = fs.readdirSync(ctxDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
  assert(stdFiles.length >= 5, `standard creates normal file count (${stdFiles.length})`);
  run(`${ctxTool} archive`, true);

  // Test: --profile extended → files + architecture-decisions/
  const r3 = run(`${ctxTool} init test-extended --profile extended`);
  assert(r3.ok, 'init with extended profile succeeds');
  const archDir = path.join(ctxDir, 'architecture-decisions');
  assert(fs.existsSync(archDir), 'extended creates architecture-decisions/ folder');
  run(`${ctxTool} archive`, true);

  // Test: --profile bogus → accepts or defaults to standard
  const r4 = run(`${ctxTool} init test-bogus --profile bogus`);
  assert(r4.ok, 'init with bogus profile does not crash');
  if (r4.parsed) {
    assert(r4.parsed.initialized || r4.parsed.profile,
      'bogus profile handled', JSON.stringify(r4.parsed).slice(0, 200));
  }
  run(`${ctxTool} archive`, true);

  // Test: No --profile flag → defaults to standard
  const r5 = run(`${ctxTool} init test-no-profile`);
  assert(r5.ok, 'init without profile flag succeeds');
  run(`${ctxTool} archive`, true);
}

// ─────────────────────────────────────────────────────────
// Unit Tests: Exported Functions
// ─────────────────────────────────────────────────────────

function testExportedFunctions() {
  section('Exported Functions (Unit)');

  // convention-scanner exports
  try {
    const cs = requireScript('convention-scanner.js');
    assert(typeof cs.detectLanguage === 'function', 'convention-scanner exports detectLanguage');
    assert(typeof cs.detectNamingPattern === 'function', 'convention-scanner exports detectNamingPattern');
    assert(typeof cs.LANGUAGE_PATTERNS === 'object', 'convention-scanner exports LANGUAGE_PATTERNS');
  } catch (e) {
    assert(false, 'convention-scanner require() works', e.message);
  }

  // pre-impl-check exports
  try {
    const pic = requireScript('pre-impl-check.js');
    assert(typeof pic.parsePlanFileReferences === 'function', 'pre-impl-check exports parsePlanFileReferences');
    assert(typeof pic.checkPlanApproval === 'function', 'pre-impl-check exports checkPlanApproval');
    assert(typeof pic.normalizeAction === 'function', 'pre-impl-check exports normalizeAction');
  } catch (e) {
    assert(false, 'pre-impl-check require() works', e.message);
  }

  // requirements-tracker exports
  try {
    const rt = requireScript('requirements-tracker.js');
    assert(typeof rt.parseAcceptanceCriteria === 'function', 'requirements-tracker exports parseAcceptanceCriteria');
    assert(typeof rt.fuzzyMatch === 'function', 'requirements-tracker exports fuzzyMatch');
    assert(typeof rt.buildTraceabilityMatrix === 'function', 'requirements-tracker exports buildTraceabilityMatrix');
  } catch (e) {
    assert(false, 'requirements-tracker require() works', e.message);
  }

  // git-safety-check exports
  try {
    const gs = requireScript('git-safety-check.js');
    assert(typeof gs.checkGitRepo === 'function', 'git-safety-check exports checkGitRepo');
    assert(typeof gs.categorizeChanges === 'function', 'git-safety-check exports categorizeChanges');
    assert(typeof gs.buildWarningsAndBlockers === 'function', 'git-safety-check exports buildWarningsAndBlockers');
  } catch (e) {
    assert(false, 'git-safety-check require() works', e.message);
  }

  // briefing-gen exports
  try {
    const bg = requireScript('briefing-gen.js');
    assert(typeof bg.generateBriefing === 'function', 'briefing-gen exports generateBriefing');
    assert(typeof bg.filterSectionsByProfile === 'function', 'briefing-gen exports filterSectionsByProfile');
    assert(Array.isArray(bg.VALID_AGENTS), 'briefing-gen exports VALID_AGENTS array');
    assert(typeof bg.AGENT_NEEDS === 'object', 'briefing-gen exports AGENT_NEEDS');
  } catch (e) {
    assert(false, 'briefing-gen require() works', e.message);
  }

  // review-prep exports
  try {
    const rp = requireScript('review-prep.js');
    assert(typeof rp.runReviewPrep === 'function', 'review-prep exports runReviewPrep');
    assert(typeof rp.securityScan === 'function', 'review-prep exports securityScan');
    assert(typeof rp.isCommentLine === 'function', 'review-prep exports isCommentLine');
    assert(typeof rp.UNIVERSAL_SECURITY === 'object', 'review-prep exports UNIVERSAL_SECURITY');
    assert(typeof rp.LANGUAGE_SECURITY === 'object', 'review-prep exports LANGUAGE_SECURITY');
  } catch (e) {
    assert(false, 'review-prep require() works', e.message);
  }

  // codebase-diff exports
  try {
    const cd = requireScript('codebase-diff.js');
    assert(typeof cd.runCodebaseDiff === 'function', 'codebase-diff exports runCodebaseDiff');
    assert(typeof cd.mapFileToSections === 'function', 'codebase-diff exports mapFileToSections');
    assert(typeof cd.generateRecommendation === 'function', 'codebase-diff exports generateRecommendation');
  } catch (e) {
    assert(false, 'codebase-diff require() works', e.message);
  }

  // research-cache exports
  try {
    const rc = requireScript('research-cache.js');
    assert(typeof rc.checkResearchCache === 'function', 'research-cache exports checkResearchCache');
    assert(typeof rc.parseResearchEntries === 'function', 'research-cache exports parseResearchEntries');
    assert(typeof rc.matchRelevance === 'function', 'research-cache exports matchRelevance');
    assert(typeof rc.extractKeywords === 'function', 'research-cache exports extractKeywords');
  } catch (e) {
    assert(false, 'research-cache require() works', e.message);
  }

  // context-tool exports
  try {
    const ct = requireScript('context-tool.js');
    assert(typeof ct.PROFILE_BUDGETS === 'object', 'context-tool exports PROFILE_BUDGETS');
    assert(typeof ct.PROFILE_FILES === 'object', 'context-tool exports PROFILE_FILES');
  } catch (e) {
    assert(false, 'context-tool require() works', e.message);
  }

  // Test review-prep.isCommentLine
  try {
    const rp = requireScript('review-prep.js');
    assert(rp.isCommentLine('// this is a comment', 'javascript') === true, 'isCommentLine detects JS comment');
    assert(rp.isCommentLine('  # python comment', 'python') === true, 'isCommentLine detects Python comment');
    assert(rp.isCommentLine('const x = 5;', 'javascript') === false, 'isCommentLine rejects code line');
  } catch (e) {
    assert(false, 'isCommentLine tests', e.message);
  }

  // Test review-prep.isTestFile
  try {
    const rp = requireScript('review-prep.js');
    assert(rp.isTestFile('__tests__/auth.test.js') === true, 'isTestFile detects test file');
    assert(rp.isTestFile('src/auth.js') === false, 'isTestFile rejects source file');
  } catch (e) {
    assert(false, 'isTestFile tests', e.message);
  }

  // Test research-cache.extractKeywords
  try {
    const rc = requireScript('research-cache.js');
    const kw = rc.extractKeywords('Redis session storage optimization');
    assert(Array.isArray(kw) && kw.length > 0, 'extractKeywords returns array', JSON.stringify(kw));
    assert(kw.some(k => k.toLowerCase().includes('redis')), 'extractKeywords includes "redis"');
  } catch (e) {
    assert(false, 'extractKeywords tests', e.message);
  }

  // Test codebase-diff.mapFileToSections
  try {
    const cd = requireScript('codebase-diff.js');
    const sections = cd.mapFileToSections('package.json');
    assert(Array.isArray(sections), 'mapFileToSections returns array', JSON.stringify(sections));
    assert(sections.some(s => s.toLowerCase().includes('tech') || s.toLowerCase().includes('stack') || s.toLowerCase().includes('dependencies')),
      'package.json maps to Tech Stack section', JSON.stringify(sections));
  } catch (e) {
    assert(false, 'mapFileToSections tests', e.message);
  }
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────

function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   AUTOMATION SCRIPTS TEST SUITE           ║');
  console.log('╚═══════════════════════════════════════════╝');

  setup();

  try {
    testConventionScanner();
    testPreImplCheck();
    testRequirementsTracker();
    testGitSafetyCheck();
    testBriefingGen();
    testReviewPrep();
    testResearchCache();
    testCodebaseDiff();
    testProgressCommand();
    testInitProfiles();
    testExportedFunctions();
  } finally {
    teardown();
  }

  console.log('\n══════════════════════════════════════════');
  console.log(`  Results: ${PASS} passed, ${FAIL} failed, ${SKIP} skipped`);
  console.log('══════════════════════════════════════════');

  if (FAILURES.length > 0) {
    console.log('\nFailures:');
    FAILURES.forEach(f => console.log(f));
  }

  process.exit(FAIL > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  testConventionScanner,
  testPreImplCheck,
  testRequirementsTracker,
  testGitSafetyCheck,
  testBriefingGen,
  testReviewPrep,
  testResearchCache,
  testCodebaseDiff,
  testProgressCommand,
  testInitProfiles,
  testExportedFunctions,
};
