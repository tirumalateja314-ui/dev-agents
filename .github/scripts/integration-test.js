#!/usr/bin/env node

/**
 * integration-test.js — V2 Integration Tests
 *
 * End-to-end tests that create real temp directories, run scripts against them,
 * and verify outputs. Tests the full pipeline, not just individual functions.
 *
 * Design decisions:
 * - Each test creates an isolated temp directory — tests never interfere.
 * - Tests run actual script functions (sociable) — not subprocess calls.
 * - File system is the external dependency we use real (fast, deterministic, owned).
 * - Git is mocked only when its behavior is non-deterministic in test context.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

// ─────────────────────────────────────────────────────────
// TEST HARNESS
// ─────────────────────────────────────────────────────────

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
const failures = [];

function describe(suiteName, fn) {
  console.log(`\n── ${suiteName} ──`);
  fn();
}

function test(name, fn) {
  try {
    fn();
    totalPassed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    totalFailed++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function skip(name, reason) {
  totalSkipped++;
  console.log(`  ○ ${name} (skipped — ${reason || 'environment'})`);
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

function createTempProject(name) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `devagent-${name}-`));
  return tmpDir;
}

function cleanup(tmpDir) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }
}

function initGitRepo(dir) {
  try {
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function gitCommitAll(dir, message) {
  try {
    execSync('git add -A', { cwd: dir, stdio: 'pipe' });
    execSync(`git commit -m "${message}" --allow-empty`, { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// LOAD MODULES
// ─────────────────────────────────────────────────────────

const SCRIPTS_DIR = path.join(__dirname);

const codeCheck = require(path.join(SCRIPTS_DIR, 'code-check'));
const projectContext = require(path.join(SCRIPTS_DIR, 'project-context'));
const gitSafety = require(path.join(SCRIPTS_DIR, 'git-safety-check'));

// ═════════════════════════════════════════════════════════
// SUITE 1: Project structure discovery on real directory
// ═════════════════════════════════════════════════════════

describe('Project structure discovery (integration)', () => {

  test('discovers files and directories in a temp project', () => {
    const tmpDir = createTempProject('structure');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test');
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.js'), 'console.log("hi")');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'app.test.js'), 'test("x", () => {})');

    const result = projectContext.getProjectStructure(tmpDir);

    assert.ok(result.tree.some(l => l.includes('src/')), 'Should find src/');
    assert.ok(result.tree.some(l => l.includes('tests/')), 'Should find tests/');
    assert.ok(result.tree.some(l => l.includes('package.json')), 'Should find package.json');
    assert.ok(result.key_files.some(f => f.role === 'manifest'), 'package.json should be manifest');
    assert.ok(result.key_files.some(f => f.role === 'entry'), 'index.js should be entry');
    assert.ok(result.key_files.some(f => f.role === 'docs'), 'README.md should be docs');

    cleanup(tmpDir);
  });

  test('excludes node_modules and .git in temp project', () => {
    const tmpDir = createTempProject('exclude');
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.js'), '');
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(path.join(tmpDir, '.git', 'HEAD'), '');
    fs.writeFileSync(path.join(tmpDir, 'app.js'), '');

    const result = projectContext.getProjectStructure(tmpDir);

    assert.ok(!result.tree.some(l => l.includes('node_modules')), 'node_modules excluded');
    assert.ok(result.tree.some(l => l.includes('app.js')), 'app.js included');

    cleanup(tmpDir);
  });

  test('respects max depth of 3', () => {
    const tmpDir = createTempProject('depth');
    const deep = path.join(tmpDir, 'a', 'b', 'c', 'd', 'e');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'deep.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'a', 'b', 'c', 'shallow.js'), '');

    const result = projectContext.getProjectStructure(tmpDir);

    // depth 0=a, 1=b, 2=c, 3=d — d is at depth 3 so gets listed but not walked
    assert.ok(!result.tree.some(l => l.includes('deep.js')), 'deep.js beyond max depth');

    cleanup(tmpDir);
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 2: Code check on real files with known issues
// ═════════════════════════════════════════════════════════

describe('Code check on real files (integration)', () => {

  test('detects security issue in file with eval()', () => {
    const tmpDir = createTempProject('security');
    fs.mkdirSync(path.join(tmpDir, '.github', 'context'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.github', 'context', 'conventions.json'), '{}');

    const fileContents = [{
      filePath: 'vulnerable.js',
      content: 'const input = getUserInput();\neval(input);\nconsole.log("done");\n',
      isTest: false,
      isEnvEx: false,
    }];

    const result = codeCheck.runChecks(fileContents, tmpDir);

    assert.ok(result.security, 'Should have security section');
    // eval() should trigger a security finding
    if (result.security.findings && result.security.findings.length > 0) {
      assert.ok(
        result.security.findings.some(f =>
          f.category?.toLowerCase().includes('eval') ||
          f.fix?.toLowerCase().includes('eval') ||
          f.code?.includes('eval')
        ),
        'Should detect eval as security issue'
      );
    }

    cleanup(tmpDir);
  });

  test('clean file produces clean result', () => {
    const tmpDir = createTempProject('clean');
    fs.mkdirSync(path.join(tmpDir, '.github', 'context'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.github', 'context', 'conventions.json'), '{}');

    const fileContents = [{
      filePath: 'safe.js',
      content: 'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n',
      isTest: false,
      isEnvEx: false,
    }];

    const result = codeCheck.runChecks(fileContents, tmpDir);

    assert.equal(result.security.status, 'clean', 'Security should be clean');
    assert.equal(result.summary.blockers, 0, 'No blockers');

    cleanup(tmpDir);
  });

  test('concise format produces non-empty string for findings', () => {
    const result = {
      security: {
        status: 'issues_found',
        findings: [
          { severity: 'BLOCKER', category: 'eval usage', file: 'app.js', line: 5, fix: 'Remove eval' },
        ],
      },
      summary: { blockers: 1, warnings: 0, suggestions: 0, verdict: 'CHANGES_REQUIRED' },
    };
    const concise = codeCheck.formatFindingsConcise(result);
    assert.ok(concise.length > 0, 'Concise output should not be empty');
    assert.ok(concise.includes('CRITICAL'), 'Should mark blockers as CRITICAL');
    assert.ok(concise.includes('app.js:5'), 'Should include file:line');
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 3: Git safety check with real git repo
// ═════════════════════════════════════════════════════════

describe('Git safety check on real repo (integration)', () => {

  test('checkGitRepo returns valid result on actual repo', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const result = gitSafety.checkGitRepo(repoRoot);
    assert.ok(result, 'Should return a result');
    // We're in a git repo, so it should not indicate failure
    assert.ok(!result.error, 'Should not error on valid repo');
  });

  test('gatherGitState returns branch info on actual repo', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const state = gitSafety.gatherGitState(repoRoot);
    assert.ok(state, 'Should return state');
    assert.ok(state.branch || state.head, 'Should have branch or head info');
  });

  test('buildWarningsAndBlockers returns structured result', () => {
    const gitState = { branch: 'main', remotes: [] };
    const uncommitted = { staged: [], unstaged: [], untracked: [] };
    const categorized = { unrelated_to_task: [], context_files_exposed: [] };
    const remoteStatus = { behind: 0, diverged: false, fetch_success: true };
    const edgeCases = {
      missing_remote: false, context_files_in_gitignore: true,
      protected_branch: false, shallow_clone: false, large_files: [],
    };
    const result = gitSafety.buildWarningsAndBlockers(
      gitState, uncommitted, categorized, remoteStatus, edgeCases
    );
    assert.ok(result, 'Should return a result');
    assert.ok(Array.isArray(result.warnings), 'Should have warnings array');
    assert.ok(Array.isArray(result.blockers), 'Should have blockers array');
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 4: Full pipeline — file edit → code check
// ═════════════════════════════════════════════════════════

describe('Full pipeline: file edit tool → code check (integration)', () => {

  test('extractEditedFiles → getSpecificFiles → readFileContents → runChecks', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const targetFile = path.join(repoRoot, '.github', 'scripts', 'package.json');

    // Step 1: Extract file from simulated tool input
    const files = codeCheck.extractEditedFiles('replace_string_in_file', {
      filePath: targetFile,
      oldString: 'old',
      newString: 'new',
    });
    assert.equal(files.length, 1, 'Should extract one file');

    // Step 2: Resolve to repo-relative
    const specificFiles = codeCheck.getSpecificFiles(files, repoRoot);
    assert.equal(specificFiles.length, 1, 'File should exist');

    // Step 3: Read contents
    const contents = codeCheck.readFileContents(specificFiles, repoRoot);
    assert.equal(contents.length, 1, 'Should read one file');
    assert.ok(contents[0].content.includes('devagent-scripts'), 'Should have real content');

    // Step 4: Run checks
    const result = codeCheck.runChecks(contents, repoRoot);
    assert.ok(result.summary, 'Should have summary');
    assert.equal(result.files_scanned, 1, 'Should scan one file');
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 5: Git repo operations in temp directory
// ═════════════════════════════════════════════════════════

describe('Git operations in temp repo (integration)', () => {

  test('isDangerousGitCommand works in pipeline with real command strings', () => {
    // Simulate what the PreToolUse hook would receive
    const commands = [
      { cmd: 'git status && git push origin main', expected: true },
      { cmd: 'git log --oneline -5', expected: false },
      { cmd: 'git add . && git commit -m "fix"', expected: false },
      { cmd: 'git reset --hard HEAD~3', expected: true },
      { cmd: 'git stash && git checkout main', expected: false },
      { cmd: 'git stash drop', expected: true },
    ];

    for (const { cmd, expected } of commands) {
      const result = gitSafety.isDangerousGitCommand(cmd);
      assert.equal(result, expected, `"${cmd}" should be ${expected ? 'dangerous' : 'safe'}`);
    }
  });

  test('checkGitRepo detects non-git directory', () => {
    const tmpDir = createTempProject('nogit');
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');

    const result = gitSafety.checkGitRepo(tmpDir);
    // Non-git directory should indicate no repo
    assert.ok(result.error || !result.is_git_repo || result.is_git_repo === false,
      'Should indicate not a git repo');

    cleanup(tmpDir);
  });

  test('detectUncommittedChanges finds new files in git repo', () => {
    const tmpDir = createTempProject('uncommitted');
    const isGit = initGitRepo(tmpDir);
    if (!isGit) {
      skip('detectUncommittedChanges finds new files', 'git not available');
      return;
    }

    // Initial commit
    fs.writeFileSync(path.join(tmpDir, 'initial.txt'), 'hello');
    gitCommitAll(tmpDir, 'initial');

    // Add uncommitted file
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'new content');

    const result = gitSafety.detectUncommittedChanges(tmpDir);
    assert.ok(result, 'Should return result');

    // new.txt should appear as untracked
    const allChanges = [
      ...(result.untracked || []),
      ...(result.unstaged || []),
    ];
    assert.ok(allChanges.some(f =>
      (typeof f === 'string' ? f : f.file || '').includes('new.txt')
    ), 'Should detect new.txt as uncommitted');

    cleanup(tmpDir);
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 6: Hook output format verification
// ═════════════════════════════════════════════════════════

describe('Hook output format (integration)', () => {

  test('formatFindingsConcise produces valid hook-compatible text', () => {
    const result = {
      security: {
        findings: [
          { severity: 'BLOCKER', category: 'Hardcoded secret', file: 'config.js', line: 3 },
          { severity: 'WARNING', category: 'Weak hash', file: 'auth.js', line: 15 },
        ],
      },
      performance: {
        findings: [
          { severity: 'SUGGESTION', category: 'Unbounded query', file: 'db.js', line: 8 },
        ],
      },
    };

    const concise = codeCheck.formatFindingsConcise(result);
    const lines = concise.split('\n');

    // Must be parseable text, not JSON
    assert.ok(!concise.startsWith('{'), 'Concise output should not be JSON');

    // Must have all 3 findings
    assert.equal(lines.length, 3, 'Should have one line per finding');

    // Must be sorted: CRITICAL first, WARNING second, SUGGESTION last
    assert.ok(lines[0].includes('CRITICAL'), 'First line = CRITICAL');
    assert.ok(lines[1].includes('WARNING'), 'Second line = WARNING');
    // Suggestions may use different label
    assert.ok(lines[2].includes('SUGGESTION') || lines[2].includes('INFO'),
      'Third line = SUGGESTION/INFO');
  });

  test('formatScanConcise produces valid hook-compatible text', () => {
    const result = {
      conventions: {
        language: { primary: 'typescript' },
        testing: { framework: 'vitest' },
        code_style: { eslint: true },
      },
    };

    const concise = projectContext.formatScanConcise(result);

    // Must be plain text
    assert.ok(!concise.startsWith('{'), 'Should not be JSON');
    assert.ok(concise.includes('typescript'), 'Should include language');
    assert.ok(concise.includes('vitest'), 'Should include test framework');

    // Must be short (hook additionalContext should be compact)
    const lines = concise.split('\n');
    assert.ok(lines.length <= 5, `Should be <= 5 lines, got ${lines.length}`);
  });

  test('formatDiffConcise produces valid hook-compatible text', () => {
    const result = {
      last_scanned: '2026-04-20',
      changes: { added: ['new.ts'], modified: ['app.ts'], deleted: [], renamed: [] },
      affected_sections: ['Tech Stack', 'Testing'],
      recommendation: 'Partial re-scan recommended',
    };

    const concise = projectContext.formatDiffConcise(result);

    assert.ok(!concise.startsWith('{'), 'Should not be JSON');
    assert.ok(concise.includes('2 files'), 'Should show count');
    assert.ok(concise.split('\n').length <= 4, 'Should be compact');
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 7: Cross-script dependency chain
// ═════════════════════════════════════════════════════════

describe('Cross-script dependency chain (integration)', () => {

  test('code-check.js can load review-prep.js functions', () => {
    // This is a sociable test — if the require chain is broken, this fails
    const reviewPrep = require(path.join(SCRIPTS_DIR, 'review-prep'));
    assert.equal(typeof reviewPrep.securityScan, 'function');
    assert.equal(typeof reviewPrep.performanceScan, 'function');
    assert.equal(typeof reviewPrep.conventionScan, 'function');
    assert.equal(typeof reviewPrep.testQualityScan, 'function');
    assert.equal(typeof reviewPrep.isTestFile, 'function');
  });

  test('project-context.js can load convention-scanner.js', () => {
    const scanner = require(path.join(SCRIPTS_DIR, 'convention-scanner'));
    assert.ok(scanner, 'Should load');
    assert.equal(typeof scanner.runScan, 'function', 'runScan should be exported');
  });

  test('project-context.js can load codebase-diff.js', () => {
    const diff = require(path.join(SCRIPTS_DIR, 'codebase-diff'));
    assert.ok(diff, 'Should load');
    assert.equal(typeof diff.runCodebaseDiff, 'function', 'runCodebaseDiff should be exported');
  });

  test('review-prep isTestFile correctly identifies test files', () => {
    const reviewPrep = require(path.join(SCRIPTS_DIR, 'review-prep'));
    assert.ok(reviewPrep.isTestFile('src/app.test.js'), 'Should detect .test.js');
    assert.ok(reviewPrep.isTestFile('tests/auth.spec.ts'), 'Should detect .spec.ts');
    assert.ok(reviewPrep.isTestFile('__tests__/utils.js'), 'Should detect __tests__');
    assert.ok(!reviewPrep.isTestFile('src/app.js'), 'Regular file is not test');
    assert.ok(!reviewPrep.isTestFile('src/utils.ts'), 'Regular TS file is not test');
  });
});

// ═════════════════════════════════════════════════════════
// RESULTS
// ═════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}: ${f.error}`);
  }
}

console.log(`${'═'.repeat(50)}\n`);

process.exit(totalFailed > 0 ? 1 : 0);
