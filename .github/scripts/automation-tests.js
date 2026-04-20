#!/usr/bin/env node

/**
 * automation-tests.js — V2 Unit Tests
 *
 * Tests exported functions from V2 scripts.
 * Zero npm dependencies — uses Node.js built-in assert.
 *
 * Design decisions:
 * - Sociable tests (real collaborators) where the collaborator is fast/deterministic.
 * - Solitary tests (mock stdin/git) where the collaborator is external.
 * - Each test name reads as a specification — what scenario, what outcome.
 * - Tests verify behavior (output), not implementation (internal calls).
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

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
    failures.push({ suite: '', name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function skip(name) {
  totalSkipped++;
  console.log(`  ○ ${name} (skipped — requires git/filesystem)`);
}

// ─────────────────────────────────────────────────────────
// LOAD MODULES
// ─────────────────────────────────────────────────────────

const SCRIPTS_DIR = path.join(__dirname);

const gitSafety = require(path.join(SCRIPTS_DIR, 'git-safety-check'));
const codeCheck = require(path.join(SCRIPTS_DIR, 'code-check'));
const projectContext = require(path.join(SCRIPTS_DIR, 'project-context'));

// ═════════════════════════════════════════════════════════
// SUITE 1: git-safety-check.js — isDangerousGitCommand
// ═════════════════════════════════════════════════════════

describe('isDangerousGitCommand', () => {

  // ── Dangerous commands: must be caught ──

  test('git push is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git push'), true);
  });

  test('git push origin main is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git push origin main'), true);
  });

  test('git push --force is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git push --force'), true);
  });

  test('git push -f is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git push -f origin main'), true);
  });

  test('git reset --hard is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git reset --hard HEAD~1'), true);
  });

  test('git clean -fd is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git clean -fd'), true);
  });

  test('git checkout -- . is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git checkout -- .'), true);
  });

  test('git branch -D feature is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git branch -D feature/old'), true);
  });

  test('git branch -d feature is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git branch -d feature/old'), true);
  });

  test('git rebase main is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git rebase main'), true);
  });

  test('git merge feature is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git merge feature/auth'), true);
  });

  test('git stash drop is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git stash drop'), true);
  });

  test('git tag -d v1 is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git tag -d v1.0'), true);
  });

  test('git remote add origin is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git remote add origin https://example.com'), true);
  });

  test('git remote remove origin is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git remote remove origin'), true);
  });

  test('git remote set-url origin is dangerous', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git remote set-url origin https://new.com'), true);
  });

  // ── Safe commands: must NOT be caught ──

  test('git status is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git status'), false);
  });

  test('git log is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git log --oneline -5'), false);
  });

  test('git diff is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git diff HEAD'), false);
  });

  test('git add is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git add .'), false);
  });

  test('git commit is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git commit -m "fix"'), false);
  });

  test('git checkout branch is safe (no -- .)', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git checkout feature/new'), false);
  });

  test('git fetch is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git fetch origin'), false);
  });

  test('git pull is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git pull origin main'), false);
  });

  test('git stash (without drop) is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git stash'), false);
  });

  test('git stash list is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git stash list'), false);
  });

  test('git stash pop is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('git stash pop'), false);
  });

  // ── Edge cases ──

  test('null input returns false', () => {
    assert.equal(gitSafety.isDangerousGitCommand(null), false);
  });

  test('undefined input returns false', () => {
    assert.equal(gitSafety.isDangerousGitCommand(undefined), false);
  });

  test('empty string returns false', () => {
    assert.equal(gitSafety.isDangerousGitCommand(''), false);
  });

  test('number input returns false', () => {
    assert.equal(gitSafety.isDangerousGitCommand(42), false);
  });

  test('non-git command is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('npm install'), false);
  });

  test('command with git in name but not a git command is safe', () => {
    assert.equal(gitSafety.isDangerousGitCommand('cat .gitignore'), false);
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 2: git-safety-check.js — DANGEROUS_GIT_PATTERNS
// ═════════════════════════════════════════════════════════

describe('DANGEROUS_GIT_PATTERNS', () => {

  test('is an array of RegExp', () => {
    assert.ok(Array.isArray(gitSafety.DANGEROUS_GIT_PATTERNS));
    for (const p of gitSafety.DANGEROUS_GIT_PATTERNS) {
      assert.ok(p instanceof RegExp, `Expected RegExp, got ${typeof p}`);
    }
  });

  test('has at least 10 patterns', () => {
    assert.ok(gitSafety.DANGEROUS_GIT_PATTERNS.length >= 10,
      `Expected >=10 patterns, got ${gitSafety.DANGEROUS_GIT_PATTERNS.length}`);
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 3: code-check.js — extractEditedFiles
// ═════════════════════════════════════════════════════════

describe('extractEditedFiles', () => {

  test('create_file extracts filePath', () => {
    const files = codeCheck.extractEditedFiles('create_file', {
      filePath: '/project/src/app.js',
      content: 'console.log("hello")',
    });
    assert.deepEqual(files, ['/project/src/app.js']);
  });

  test('replace_string_in_file extracts filePath', () => {
    const files = codeCheck.extractEditedFiles('replace_string_in_file', {
      filePath: '/project/src/utils.ts',
      oldString: 'foo',
      newString: 'bar',
    });
    assert.deepEqual(files, ['/project/src/utils.ts']);
  });

  test('edit_notebook_file extracts filePath', () => {
    const files = codeCheck.extractEditedFiles('edit_notebook_file', {
      filePath: '/project/notebook.ipynb',
    });
    assert.deepEqual(files, ['/project/notebook.ipynb']);
  });

  test('multi_replace_string_in_file extracts all filePaths from replacements', () => {
    const files = codeCheck.extractEditedFiles('multi_replace_string_in_file', {
      replacements: [
        { filePath: '/project/a.js', oldString: 'x', newString: 'y' },
        { filePath: '/project/b.js', oldString: 'x', newString: 'y' },
        { filePath: '/project/c.js', oldString: 'x', newString: 'y' },
      ],
    });
    assert.deepEqual(files, ['/project/a.js', '/project/b.js', '/project/c.js']);
  });

  test('multi_replace with missing filePath in one replacement filters it out', () => {
    const files = codeCheck.extractEditedFiles('multi_replace_string_in_file', {
      replacements: [
        { filePath: '/project/a.js', oldString: 'x', newString: 'y' },
        { oldString: 'x', newString: 'y' },
      ],
    });
    assert.deepEqual(files, ['/project/a.js']);
  });

  test('unknown tool returns empty array', () => {
    const files = codeCheck.extractEditedFiles('run_in_terminal', {
      command: 'ls',
    });
    assert.deepEqual(files, []);
  });

  test('null toolInput returns empty array', () => {
    const files = codeCheck.extractEditedFiles('create_file', null);
    assert.deepEqual(files, []);
  });

  test('undefined toolInput returns empty array', () => {
    const files = codeCheck.extractEditedFiles('create_file', undefined);
    assert.deepEqual(files, []);
  });

  test('create_file with missing filePath returns empty array', () => {
    const files = codeCheck.extractEditedFiles('create_file', { content: 'hello' });
    assert.deepEqual(files, []);
  });

  test('multi_replace with empty replacements returns empty array', () => {
    const files = codeCheck.extractEditedFiles('multi_replace_string_in_file', {
      replacements: [],
    });
    assert.deepEqual(files, []);
  });

  test('multi_replace with missing replacements returns empty array', () => {
    const files = codeCheck.extractEditedFiles('multi_replace_string_in_file', {});
    assert.deepEqual(files, []);
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 4: code-check.js — FILE_EDIT_TOOLS
// ═════════════════════════════════════════════════════════

describe('FILE_EDIT_TOOLS', () => {

  test('is a Set', () => {
    assert.ok(codeCheck.FILE_EDIT_TOOLS instanceof Set);
  });

  test('contains create_file', () => {
    assert.ok(codeCheck.FILE_EDIT_TOOLS.has('create_file'));
  });

  test('contains replace_string_in_file', () => {
    assert.ok(codeCheck.FILE_EDIT_TOOLS.has('replace_string_in_file'));
  });

  test('contains multi_replace_string_in_file', () => {
    assert.ok(codeCheck.FILE_EDIT_TOOLS.has('multi_replace_string_in_file'));
  });

  test('contains edit_notebook_file', () => {
    assert.ok(codeCheck.FILE_EDIT_TOOLS.has('edit_notebook_file'));
  });

  test('does not contain read_file', () => {
    assert.ok(!codeCheck.FILE_EDIT_TOOLS.has('read_file'));
  });

  test('does not contain run_in_terminal', () => {
    assert.ok(!codeCheck.FILE_EDIT_TOOLS.has('run_in_terminal'));
  });

  test('does not contain grep_search', () => {
    assert.ok(!codeCheck.FILE_EDIT_TOOLS.has('grep_search'));
  });

  test('has exactly 4 entries', () => {
    assert.equal(codeCheck.FILE_EDIT_TOOLS.size, 4);
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 5: code-check.js — formatFindingsConcise
// ═════════════════════════════════════════════════════════

describe('formatFindingsConcise', () => {

  test('empty findings return empty string', () => {
    const result = { security: { status: 'clean' }, performance: { status: 'clean' } };
    assert.equal(codeCheck.formatFindingsConcise(result), '');
  });

  test('security findings formatted with CRITICAL prefix for blockers', () => {
    const result = {
      security: {
        status: 'issues_found',
        findings: [{ severity: 'BLOCKER', category: 'SQL Injection', file: 'db.js', line: 42 }],
      },
    };
    const output = codeCheck.formatFindingsConcise(result);
    assert.ok(output.includes('CRITICAL'), 'Expected CRITICAL in output');
    assert.ok(output.includes('SQL Injection'), 'Expected category in output');
    assert.ok(output.includes('db.js:42'), 'Expected file:line in output');
  });

  test('warnings formatted with WARNING prefix', () => {
    const result = {
      performance: {
        status: 'warnings',
        findings: [{ severity: 'WARNING', category: 'N+1 query', file: 'service.js', line: 10 }],
      },
    };
    const output = codeCheck.formatFindingsConcise(result);
    assert.ok(output.includes('WARNING'), 'Expected WARNING in output');
  });

  test('multiple findings sorted CRITICAL first then WARNING', () => {
    const result = {
      security: {
        findings: [{ severity: 'WARNING', category: 'Weak hash', file: 'auth.js', line: 5 }],
      },
      performance: {
        findings: [{ severity: 'BLOCKER', category: 'SQL Injection', file: 'db.js', line: 1 }],
      },
      conventions: {
        violations: [{ severity: 'SUGGESTION', category: 'Naming', file: 'utils.js', line: 3 }],
      },
    };
    const output = codeCheck.formatFindingsConcise(result);
    const lines = output.split('\n');
    assert.equal(lines.length, 3, 'Should have 3 lines');
    assert.ok(lines[0].includes('CRITICAL'), 'First line should be CRITICAL');
    assert.ok(lines[1].includes('WARNING'), 'Second line should be WARNING');
  });

  test('completely clean result returns empty string', () => {
    const result = {};
    assert.equal(codeCheck.formatFindingsConcise(result), '');
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 6: code-check.js — runChecks
// ═════════════════════════════════════════════════════════

describe('runChecks', () => {

  test('returns clean result for empty file list', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const result = codeCheck.runChecks([], repoRoot);
    assert.equal(result.files_scanned, 0);
    assert.equal(result.summary.verdict, 'CLEAN');
    assert.equal(result.summary.blockers, 0);
  });

  test('scans a safe JS file and returns clean', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const fileContents = [{
      filePath: 'test-sample.js',
      content: 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n',
      isTest: false,
      isEnvEx: false,
    }];
    const result = codeCheck.runChecks(fileContents, repoRoot);
    assert.equal(result.files_scanned, 1);
    assert.ok(result.security, 'Should have security section');
    assert.ok(result.summary, 'Should have summary');
  });

  test('securityOnly skips convention and performance scans', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const fileContents = [{
      filePath: 'safe.js',
      content: 'const x = 1;\n',
      isTest: false,
      isEnvEx: false,
    }];
    const result = codeCheck.runChecks(fileContents, repoRoot, { securityOnly: true });
    assert.ok(result.security, 'Should have security section');
    assert.equal(result.conventions, undefined, 'Should not have conventions');
    assert.equal(result.performance, undefined, 'Should not have performance');
    assert.equal(result.test_quality, undefined, 'Should not have test_quality');
  });

  test('conventionsOnly skips security and performance scans', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const fileContents = [{
      filePath: 'safe.js',
      content: 'const x = 1;\n',
      isTest: false,
      isEnvEx: false,
    }];
    const result = codeCheck.runChecks(fileContents, repoRoot, { conventionsOnly: true });
    assert.ok(result.conventions, 'Should have conventions section');
    assert.equal(result.security, undefined, 'Should not have security');
    assert.equal(result.performance, undefined, 'Should not have performance');
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 7: project-context.js — formatScanConcise
// ═════════════════════════════════════════════════════════

describe('formatScanConcise', () => {

  test('formats full scan result into concise lines', () => {
    const result = {
      conventions: {
        language: { primary: 'javascript', secondary: ['typescript'] },
        testing: { framework: 'jest' },
        code_style: { eslint: true, prettier: true, quotes: 'single', indent: 2 },
        naming: { functions: { dominant: 'camelCase' } },
        imports: { style: 'ESM' },
        project: { package_manager: 'npm', build_command: 'npm run build', test_command: 'npm test' },
      },
    };
    const output = projectContext.formatScanConcise(result);
    assert.ok(output.includes('javascript'), 'Should include language');
    assert.ok(output.includes('jest'), 'Should include test framework');
    assert.ok(output.includes('ESLint'), 'Should include ESLint');
    assert.ok(output.includes('Prettier'), 'Should include Prettier');
    assert.ok(output.includes('single quotes'), 'Should include quote style');
    assert.ok(output.includes('camelCase'), 'Should include naming convention');
    assert.ok(output.includes('npm'), 'Should include package manager');
  });

  test('handles missing conventions gracefully', () => {
    const result = { conventions: {} };
    const output = projectContext.formatScanConcise(result);
    assert.ok(output.includes('unknown'), 'Should show unknown for missing lang');
  });

  test('handles null conventions gracefully', () => {
    const result = {};
    const output = projectContext.formatScanConcise(result);
    assert.ok(typeof output === 'string', 'Should return a string');
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 8: project-context.js — formatDiffConcise
// ═════════════════════════════════════════════════════════

describe('formatDiffConcise', () => {

  test('no previous scan shows initialization message', () => {
    const result = { last_scanned: null };
    const output = projectContext.formatDiffConcise(result);
    assert.ok(output.includes('No previous scan'), 'Should indicate no scan');
  });

  test('zero changes shows no-changes message', () => {
    const result = {
      last_scanned: '2026-04-20',
      changes: { added: [], modified: [], deleted: [], renamed: [] },
    };
    const output = projectContext.formatDiffConcise(result);
    assert.ok(output.includes('No changes'), 'Should indicate no changes');
  });

  test('few changes lists them individually', () => {
    const result = {
      last_scanned: '2026-04-20',
      changes: {
        added: ['src/new.js'],
        modified: ['src/app.js'],
        deleted: [],
        renamed: [],
      },
      affected_sections: ['Tech Stack'],
      recommendation: 'Partial re-scan recommended',
    };
    const output = projectContext.formatDiffConcise(result);
    assert.ok(output.includes('2 files'), 'Should show file count');
    assert.ok(output.includes('src/new.js'), 'Should list files');
    assert.ok(output.includes('Tech Stack'), 'Should show affected sections');
    assert.ok(output.includes('Partial'), 'Should show recommendation');
  });

  test('many changes truncates with +N more', () => {
    const result = {
      last_scanned: '2026-04-20',
      changes: {
        added: ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js', 'g.js'],
        modified: [],
        deleted: [],
        renamed: [],
      },
    };
    const output = projectContext.formatDiffConcise(result);
    assert.ok(output.includes('+'), 'Should truncate with +N more');
  });

  test('renamed files handled as objects with to field', () => {
    const result = {
      last_scanned: '2026-04-20',
      changes: {
        added: [],
        modified: [],
        deleted: [],
        renamed: [{ from: 'old.js', to: 'new.js' }],
      },
    };
    const output = projectContext.formatDiffConcise(result);
    assert.ok(output.includes('1 files'), 'Should count renamed');
    assert.ok(output.includes('new.js'), 'Should use the to path');
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 9: project-context.js — getProjectStructure
// ═════════════════════════════════════════════════════════

describe('getProjectStructure', () => {

  test('returns object with tree array and key_files array', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const result = projectContext.getProjectStructure(repoRoot);
    assert.ok(Array.isArray(result.tree), 'Should have tree array');
    assert.ok(Array.isArray(result.key_files), 'Should have key_files array');
  });

  test('tree includes .github directory', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const result = projectContext.getProjectStructure(repoRoot);
    assert.ok(result.tree.some(line => line.includes('.github')), 'Should find .github');
  });

  test('tree excludes node_modules', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const result = projectContext.getProjectStructure(repoRoot);
    assert.ok(!result.tree.some(line => line.includes('node_modules')), 'Should exclude node_modules');
  });

  test('tree excludes _archive', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const result = projectContext.getProjectStructure(repoRoot);
    assert.ok(!result.tree.some(line => line.includes('_archive')), 'Should exclude _archive');
  });

  test('works on temp directory with known structure', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pctx-'));
    fs.writeFileSync(path.join(tmpDir, 'index.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), '');

    const result = projectContext.getProjectStructure(tmpDir);
    assert.ok(result.tree.some(line => line.includes('src/')), 'Should find src/');
    assert.ok(result.tree.some(line => line.includes('index.js')), 'Should find index.js');
    assert.ok(result.key_files.some(f => f.role === 'docs'), 'README.md should be tagged as docs');
    assert.ok(result.key_files.some(f => f.role === 'entry'), 'index.js should be tagged as entry');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 10: code-check.js — getSpecificFiles
// ═════════════════════════════════════════════════════════

describe('getSpecificFiles', () => {

  test('converts absolute paths to repo-relative', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const absPath = path.join(repoRoot, '.github', 'scripts', 'code-check.js');
    const result = codeCheck.getSpecificFiles([absPath], repoRoot);
    assert.equal(result.length, 1);
    assert.ok(result[0].file.includes('code-check.js'), 'Should contain filename');
    assert.ok(!result[0].file.startsWith('/'), 'Should be relative');
    assert.ok(!result[0].file.includes(':\\'), 'Should not be absolute on Windows');
  });

  test('filters out non-existent files', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const result = codeCheck.getSpecificFiles(['/totally/fake/file.js'], repoRoot);
    assert.equal(result.length, 0);
  });

  test('handles empty array', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const result = codeCheck.getSpecificFiles([], repoRoot);
    assert.deepEqual(result, []);
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 11: git-safety-check.js — exported V1 functions
// ═════════════════════════════════════════════════════════

describe('git-safety-check V1 exports still accessible', () => {

  test('checkGitRepo is exported and is a function', () => {
    assert.equal(typeof gitSafety.checkGitRepo, 'function');
  });

  test('gatherGitState is exported and is a function', () => {
    assert.equal(typeof gitSafety.gatherGitState, 'function');
  });

  test('detectUncommittedChanges is exported and is a function', () => {
    assert.equal(typeof gitSafety.detectUncommittedChanges, 'function');
  });

  test('categorizeChanges is exported and is a function', () => {
    assert.equal(typeof gitSafety.categorizeChanges, 'function');
  });

  test('checkRemoteStatus is exported and is a function', () => {
    assert.equal(typeof gitSafety.checkRemoteStatus, 'function');
  });

  test('detectEdgeCases is exported and is a function', () => {
    assert.equal(typeof gitSafety.detectEdgeCases, 'function');
  });

  test('buildWarningsAndBlockers is exported and is a function', () => {
    assert.equal(typeof gitSafety.buildWarningsAndBlockers, 'function');
  });
});

// ═════════════════════════════════════════════════════════
// SUITE 12: code-check.js — readFileContents
// ═════════════════════════════════════════════════════════

describe('readFileContents', () => {

  test('reads existing file and returns content', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const relPath = '.github/scripts/package.json';
    const result = codeCheck.readFileContents(
      [{ file: relPath, action: 'MODIFY' }],
      repoRoot,
    );
    assert.equal(result.length, 1);
    assert.ok(result[0].content.includes('devagent-scripts'), 'Should contain package name');
    assert.equal(result[0].filePath, relPath);
  });

  test('skips non-existent files', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const result = codeCheck.readFileContents(
      [{ file: 'nonexistent/fake.js', action: 'MODIFY' }],
      repoRoot,
    );
    assert.equal(result.length, 0);
  });

  test('returns empty array for empty input', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const result = codeCheck.readFileContents([], repoRoot);
    assert.deepEqual(result, []);
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
