#!/usr/bin/env node

/**
 * requirements-tracker.js — DevAgent Requirements Traceability CLI
 *
 * Cross-references acceptance criteria ↔ tests ↔ code changes ↔ plan steps.
 * Generates a traceability matrix that Tester uses to ensure coverage
 * and Reviewer uses to verify completeness.
 *
 * Usage: node .github/scripts/requirements-tracker.js [--context-dir <path>]
 *
 * Built with zero dependencies — only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');

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

function parseContextHeaders(content) {
  const headers = {};
  if (!content) return headers;
  for (const line of content.split('\n')) {
    const match = line.match(/^\*\*(.+?)\*\*:\s*(.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
      headers[key] = match[2].trim();
    }
  }
  return headers;
}

// ─────────────────────────────────────────────────────────
// STOP WORDS for keyword extraction
// ─────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'was', 'are', 'were',
  'been', 'have', 'has', 'had', 'not', 'but', 'all', 'can', 'will', 'would',
  'should', 'could', 'does', 'did', 'its', 'than', 'into', 'about', 'after',
  'before', 'between', 'each', 'also', 'just', 'more', 'some', 'such', 'only',
  'very', 'when', 'which', 'must', 'shall', 'may', 'able', 'user', 'system',
  'then', 'given', 'correctly', 'properly', 'successfully', 'appropriate',
]);

// ─────────────────────────────────────────────────────────
// STEP 1: Parse acceptance criteria from requirements.md
// ─────────────────────────────────────────────────────────

function parseAcceptanceCriteria(content) {
  if (!content) return [];

  // Find the Acceptance Criteria section
  const sectionMatch = content.match(/## Acceptance Criteria\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (!sectionMatch) return [];

  const sectionContent = sectionMatch[1];
  const criteria = [];

  // Pattern 1: Numbered items — "1. Some criteria text"
  const numberedPattern = /^(\d+)\.\s+(.+)$/gm;
  let match;
  while ((match = numberedPattern.exec(sectionContent)) !== null) {
    const text = match[2].trim();
    if (text && !text.startsWith('(To be filled')) {
      criteria.push({ id: parseInt(match[1], 10), text });
    }
  }

  if (criteria.length > 0) return criteria;

  // Pattern 2: Checkbox items — "- [x] Some criteria text" or "- [ ] Some criteria text"
  const checkboxPattern = /^-\s+\[[ xX]\]\s+(.+)$/gm;
  let idx = 1;
  while ((match = checkboxPattern.exec(sectionContent)) !== null) {
    const text = match[1].trim();
    if (text && !text.startsWith('(To be filled')) {
      criteria.push({ id: idx++, text });
    }
  }

  if (criteria.length > 0) return criteria;

  // Pattern 3: Bullet items — "- Some criteria text" or "* Some criteria text"
  const bulletPattern = /^[-*]\s+(.+)$/gm;
  idx = 1;
  while ((match = bulletPattern.exec(sectionContent)) !== null) {
    const text = match[1].trim();
    if (text && !text.startsWith('(To be filled')) {
      criteria.push({ id: idx++, text });
    }
  }

  return criteria;
}

// ─────────────────────────────────────────────────────────
// STEP 2: Parse tests from test-results.md
// ─────────────────────────────────────────────────────────

function parseTestResults(content) {
  const result = {
    tests: [],
    acMapping: [],        // Direct AC → test mapping table
    hasAcMappingTable: false,
    total: 0,
    passing: 0,
    failing: 0,
  };

  if (!content) return result;

  // Parse Pass/Fail Count section
  const countMatch = content.match(/## Pass\/Fail Count\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (countMatch) {
    const countContent = countMatch[1];
    const totalMatch = countContent.match(/\*\*Total\*\*:\s*(\d+)/);
    const passMatch = countContent.match(/\*\*Passing\*\*:\s*(\d+)/);
    const failMatch = countContent.match(/\*\*Failing\*\*:\s*(\d+)/);
    if (totalMatch) result.total = parseInt(totalMatch[1], 10);
    if (passMatch) result.passing = parseInt(passMatch[1], 10);
    if (failMatch) result.failing = parseInt(failMatch[1], 10);
  }

  // Parse Acceptance Criteria Mapping table (PRIMARY source)
  const mappingMatch = content.match(/## Acceptance Criteria Mapping\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (mappingMatch) {
    const mappingContent = mappingMatch[1];
    // Table format: | Criteria # | Test | Status |
    const rowPattern = /\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g;
    let match;
    while ((match = rowPattern.exec(mappingContent)) !== null) {
      const criteriaId = parseInt(match[1], 10);
      const testName = match[2].trim();
      const status = match[3].trim().toLowerCase();

      // Skip header/separator rows
      if (isNaN(criteriaId) || testName === 'Test' || testName.includes('---')) continue;

      result.acMapping.push({ criteriaId, testName, status });
      result.hasAcMappingTable = true;
    }
  }

  // Parse Tests Written section
  const testsMatch = content.match(/## Tests Written\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (testsMatch) {
    const testsContent = testsMatch[1];

    // Try table format: | Test Name | File | Status |
    const tablePattern = /\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(pass|fail|✅|❌|passing|failing)[^|]*\|/gi;
    let match;
    while ((match = tablePattern.exec(testsContent)) !== null) {
      const name = match[1].trim();
      const file = match[2].trim();
      const rawStatus = match[3].trim().toLowerCase();
      if (name === 'Test Name' || name.includes('---')) continue;

      const status = (rawStatus === 'pass' || rawStatus === '✅' || rawStatus === 'passing') ? 'pass' : 'fail';
      result.tests.push({ name, file, status });
    }

    // Try list format: - ✅ test name or - ❌ test name
    if (result.tests.length === 0) {
      const listPattern = /^[-*]\s*(✅|❌|pass|fail)\s+(.+)$/gim;
      while ((match = listPattern.exec(testsContent)) !== null) {
        const rawStatus = match[1].trim().toLowerCase();
        const name = match[2].trim();
        const status = (rawStatus === '✅' || rawStatus === 'pass') ? 'pass' : 'fail';
        result.tests.push({ name, file: null, status });
      }
    }

    // Try code block format: it('test name', ...) or test('test name', ...)
    if (result.tests.length === 0) {
      const codePattern = /(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g;
      while ((match = codePattern.exec(testsContent)) !== null) {
        result.tests.push({ name: match[1].trim(), file: null, status: 'unknown' });
      }
    }
  }

  // Update total from parsed tests if count section was empty
  if (result.total === 0 && result.tests.length > 0) {
    result.total = result.tests.length;
    result.passing = result.tests.filter(t => t.status === 'pass').length;
    result.failing = result.tests.filter(t => t.status === 'fail').length;
  }

  return result;
}

// ─────────────────────────────────────────────────────────
// STEP 3: Parse code changes from code-changes.md
// ─────────────────────────────────────────────────────────

function parseCodeChanges(content) {
  const changes = [];
  const deviations = [];

  if (!content) return { changes, deviations };

  // Parse Files Changed table: | File | Action | What Changed | Why |
  const changesMatch = content.match(/## Files Changed\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (changesMatch) {
    const rowPattern = /\|\s*`?([^|`]+\.\w+)`?\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|/g;
    let match;
    while ((match = rowPattern.exec(changesMatch[1])) !== null) {
      const file = match[1].trim();
      const action = match[2].trim();
      const whatChanged = match[3].trim();
      const why = match[4].trim();
      if (file === 'File' || file.includes('---')) continue;
      changes.push({ file, action, what_changed: whatChanged, why });
    }
  }

  // Parse Deviations section
  const devMatch = content.match(/## Deviations from Plan\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (devMatch) {
    const devContent = devMatch[1].trim();
    if (devContent && devContent !== '(None yet)' && devContent !== 'None') {
      // Extract list items or paragraphs
      const itemPattern = /^[-*]\s+(.+)$/gm;
      let match;
      while ((match = itemPattern.exec(devContent)) !== null) {
        deviations.push(match[1].trim());
      }
      // If no list items, take the whole text
      if (deviations.length === 0 && devContent.length > 5) {
        deviations.push(devContent.split('\n')[0]);
      }
    }
  }

  return { changes, deviations };
}

// ─────────────────────────────────────────────────────────
// STEP 4: Parse plan steps from implementation-plan.md
// ─────────────────────────────────────────────────────────

function parsePlanSteps(content) {
  const steps = [];
  if (!content) return steps;

  // Find the relevant section
  const sectionNames = ['## File-by-File Plan', '## Implementation Steps', '## Steps'];
  let sectionContent = null;

  for (const name of sectionNames) {
    const regex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n([\\s\\S]*?)(?=\\n## |$)', 'i');
    const match = content.match(regex);
    if (match) {
      sectionContent = match[1];
      break;
    }
  }

  if (!sectionContent) return steps;

  // Pattern 1: Numbered steps with headings — "### Step 1: description" or "#### 1. description"
  const headingPattern = /^#{2,4}\s+(?:Step\s+)?(\d+)[.:]\s+(.+)$/gim;
  let match;
  while ((match = headingPattern.exec(sectionContent)) !== null) {
    const stepNum = parseInt(match[1], 10);
    const description = match[2].trim();
    // Try to extract file from the description
    const fileMatch = description.match(/`([^`]+\.\w+)`/);
    steps.push({
      step_num: stepNum,
      description,
      file: fileMatch ? fileMatch[1] : null,
    });
  }

  if (steps.length > 0) return steps;

  // Pattern 2: Table format — | Step | File | Action | Details |
  const tablePattern = /\|\s*(\d+)\s*\|\s*`?([^|`]+)`?\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|/g;
  while ((match = tablePattern.exec(sectionContent)) !== null) {
    const stepNum = parseInt(match[1], 10);
    if (isNaN(stepNum)) continue;
    steps.push({
      step_num: stepNum,
      description: match[4].trim() || match[3].trim(),
      file: match[2].trim(),
      action: match[3].trim(),
    });
  }

  if (steps.length > 0) return steps;

  // Pattern 3: Simple numbered list — "1. description"
  const listPattern = /^(\d+)\.\s+(.+)$/gm;
  while ((match = listPattern.exec(sectionContent)) !== null) {
    const stepNum = parseInt(match[1], 10);
    const description = match[2].trim();
    const fileMatch = description.match(/`([^`]+\.\w+)`/);
    steps.push({
      step_num: stepNum,
      description,
      file: fileMatch ? fileMatch[1] : null,
    });
  }

  return steps;
}

// ─────────────────────────────────────────────────────────
// STEP 5: Cross-reference and build matrix
// ─────────────────────────────────────────────────────────

function buildTraceabilityMatrix(criteria, testData, codeChanges, planSteps) {
  const acResults = [];
  const gaps = [];
  let usedFuzzy = false;

  for (const ac of criteria) {
    const entry = {
      id: ac.id,
      text: ac.text,
      tests: [],
      code_files: [],
      plan_steps: [],
      status: 'NOT_VERIFIED',
    };

    // --- Map tests to AC ---

    if (testData.hasAcMappingTable) {
      // PRIMARY: use the explicit AC mapping table from test-results.md
      const mappings = testData.acMapping.filter(m => m.criteriaId === ac.id);
      for (const mapping of mappings) {
        // Find the matching test in parsed tests for file info
        const matchedTest = testData.tests.find(t =>
          t.name === mapping.testName || t.name.includes(mapping.testName) || mapping.testName.includes(t.name)
        );
        entry.tests.push({
          name: mapping.testName,
          status: mapping.status.includes('pass') || mapping.status.includes('✅') ? 'pass' : mapping.status.includes('fail') || mapping.status.includes('❌') ? 'fail' : mapping.status,
          file: matchedTest ? matchedTest.file : null,
          confidence: 'high',
        });
      }
    } else {
      // FALLBACK: fuzzy keyword match (low confidence)
      usedFuzzy = true;
      for (const test of testData.tests) {
        const matchResult = fuzzyMatch(ac.text, test.name);
        if (matchResult.matched) {
          entry.tests.push({
            name: test.name,
            status: test.status,
            file: test.file,
            confidence: 'low',
            match_score: matchResult.score,
          });
        }
      }
    }

    // --- Map code files to AC ---
    for (const change of codeChanges.changes) {
      const changeText = `${change.what_changed} ${change.why} ${change.file}`.toLowerCase();
      const keywords = extractKeywords(ac.text);
      const matchCount = keywords.filter(k => changeText.includes(k)).length;
      if (matchCount >= 1 && keywords.length > 0) {
        entry.code_files.push(change.file);
      }
    }

    // --- Map plan steps to AC ---
    for (const step of planSteps) {
      const stepText = `${step.description} ${step.file || ''}`.toLowerCase();
      const keywords = extractKeywords(ac.text);
      const matchCount = keywords.filter(k => stepText.includes(k)).length;
      if (matchCount >= 1 && keywords.length > 0) {
        entry.plan_steps.push(step.step_num);
      }
    }

    // --- Determine status ---
    if (entry.tests.length === 0) {
      entry.status = 'NOT_VERIFIED';
      gaps.push({
        type: 'untested_criteria',
        criteria_id: ac.id,
        text: ac.text,
      });
    } else {
      const allPass = entry.tests.every(t => t.status === 'pass');
      const someFail = entry.tests.some(t => t.status === 'fail');
      if (allPass) {
        entry.status = 'VERIFIED';
      } else if (someFail) {
        entry.status = 'PARTIAL';
      } else {
        entry.status = 'PARTIAL'; // unknown status tests
      }
    }

    acResults.push(entry);
  }

  // If fuzzy matching was used, add a gap recommendation
  if (usedFuzzy) {
    gaps.push({
      type: 'no_ac_mapping_table',
      message: 'No explicit AC mapping table found in test-results.md. Recommend Tester adds mapping per T10.',
    });
  }

  // --- Find orphan tests (tests not mapped to any AC) ---
  const mappedTestNames = new Set();
  for (const ac of acResults) {
    for (const t of ac.tests) {
      mappedTestNames.add(t.name);
    }
  }
  for (const test of testData.tests) {
    if (!mappedTestNames.has(test.name)) {
      gaps.push({
        type: 'orphan_test',
        test_name: test.name,
        no_matching_criteria: true,
      });
    }
  }

  // --- Check plan compliance ---
  const planCompliance = checkPlanCompliance(planSteps, codeChanges);

  // Add plan deviations to gaps
  for (const dev of planCompliance.deviations) {
    gaps.push({
      type: 'plan_deviation',
      step: dev.step,
      expected: dev.planned,
      actual: dev.actual,
    });
  }

  return { acResults, gaps, planCompliance };
}

// ─────────────────────────────────────────────────────────
// STEP 6: Keyword matching (FALLBACK ONLY)
// ─────────────────────────────────────────────────────────

function extractKeywords(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

function fuzzyMatch(criteriaText, testName, threshold) {
  if (threshold === undefined) threshold = 0.3;

  const criteriaWords = extractKeywords(criteriaText);
  const testWords = extractKeywords(testName);

  if (criteriaWords.length === 0) return { matched: false, score: 0, confidence: 'low' };

  const overlap = criteriaWords.filter(w => testWords.some(tw => tw.includes(w) || w.includes(tw))).length;
  const score = overlap / criteriaWords.length;

  return { matched: score >= threshold, score, confidence: 'low' };
}

// ─────────────────────────────────────────────────────────
// Plan compliance check
// ─────────────────────────────────────────────────────────

function checkPlanCompliance(planSteps, codeChanges) {
  const deviations = [];
  const unplannedChanges = [];
  let stepsExecuted = 0;

  // Check each plan step against code changes
  const changedFiles = new Set(codeChanges.changes.map(c => c.file.toLowerCase()));

  for (const step of planSteps) {
    if (step.file) {
      const normalizedFile = step.file.toLowerCase().replace(/^\.\//, '');
      if (changedFiles.has(normalizedFile) || [...changedFiles].some(f => f.endsWith(normalizedFile) || normalizedFile.endsWith(f))) {
        stepsExecuted++;
      } else {
        deviations.push({
          step: step.step_num,
          planned: step.description,
          actual: 'not found in code-changes',
        });
      }
    } else {
      // Step without a specific file — can't verify mechanically
      stepsExecuted++; // Give benefit of the doubt
    }
  }

  // Check for unplanned changes (files changed but not in any plan step)
  const plannedFiles = new Set(
    planSteps
      .filter(s => s.file)
      .map(s => s.file.toLowerCase().replace(/^\.\//, ''))
  );

  for (const change of codeChanges.changes) {
    const normalizedFile = change.file.toLowerCase().replace(/^\.\//, '');
    const isPlanned = [...plannedFiles].some(f => f === normalizedFile || normalizedFile.endsWith(f) || f.endsWith(normalizedFile));
    if (!isPlanned) {
      unplannedChanges.push({
        file: change.file,
        action: change.action,
        reason: change.why || 'no reason given',
      });
    }
  }

  // Also include deviations noted explicitly in code-changes.md
  for (const dev of codeChanges.deviations) {
    deviations.push({
      step: null,
      planned: '(explicit deviation noted)',
      actual: dev,
    });
  }

  return {
    steps_executed: `${stepsExecuted}/${planSteps.length}`,
    steps_total: planSteps.length,
    steps_implemented: stepsExecuted,
    steps_skipped: planSteps.length - stepsExecuted,
    unplanned_changes: unplannedChanges,
    deviations,
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

  // Read context files
  const reqContent = readFileSafe(path.join(contextDir, 'requirements.md'));
  const testContent = readFileSafe(path.join(contextDir, 'test-results.md'));
  const codeContent = readFileSafe(path.join(contextDir, 'code-changes.md'));
  const planContent = readFileSafe(path.join(contextDir, 'implementation-plan.md'));

  // Extract task ID from any available file
  let taskId = null;
  for (const content of [reqContent, testContent, codeContent, planContent]) {
    if (content) {
      const headers = parseContextHeaders(content);
      if (headers.task_id && headers.task_id !== '(pending)' && headers.task_id !== '(none)') {
        taskId = headers.task_id;
        break;
      }
    }
  }

  // Step 1: Parse acceptance criteria
  const criteria = parseAcceptanceCriteria(reqContent);

  // Step 2: Parse test results
  const testData = parseTestResults(testContent);

  // Step 3: Parse code changes
  const codeChanges = parseCodeChanges(codeContent);

  // Step 4: Parse plan steps
  const planSteps = parsePlanSteps(planContent);

  // Handle template/empty states
  const gaps = [];

  if (criteria.length === 0) {
    if (!reqContent || reqContent.includes('(To be filled')) {
      gaps.push({ type: 'template', message: 'Requirements not written yet — still template state' });
    } else {
      gaps.push({ type: 'no_criteria', message: 'No acceptance criteria found in requirements.md' });
    }
  }

  if (testData.total === 0 && testData.tests.length === 0) {
    if (!testContent || testContent.includes('(To be filled')) {
      gaps.push({ type: 'template', message: 'No tests recorded in test-results.md — still template state' });
    }
  }

  // Step 5: Cross-reference and build matrix
  const { acResults, gaps: matrixGaps, planCompliance } = buildTraceabilityMatrix(
    criteria, testData, codeChanges, planSteps
  );

  // Merge all gaps
  const allGaps = [...gaps, ...matrixGaps];

  // Build summary
  const summary = {
    total_criteria: criteria.length,
    verified: acResults.filter(a => a.status === 'VERIFIED').length,
    not_verified: acResults.filter(a => a.status === 'NOT_VERIFIED').length,
    partial: acResults.filter(a => a.status === 'PARTIAL').length,
    total_tests: testData.total,
    passing: testData.passing,
    failing: testData.failing,
    orphan_tests: allGaps.filter(g => g.type === 'orphan_test').length,
    plan_steps_total: planCompliance.steps_total,
    plan_steps_implemented: planCompliance.steps_implemented,
    plan_steps_skipped: planCompliance.steps_skipped,
  };

  output({
    task_id: taskId,
    acceptance_criteria: acResults,
    summary,
    gaps: allGaps.length > 0 ? allGaps : undefined,
    plan_compliance: planCompliance,
  });
}

// Only run CLI when executed directly
if (require.main === module) {
  main();
}

module.exports = {
  parseAcceptanceCriteria,
  parseTestResults,
  parseCodeChanges,
  parsePlanSteps,
  buildTraceabilityMatrix,
  fuzzyMatch,
  extractKeywords,
  checkPlanCompliance,
};
