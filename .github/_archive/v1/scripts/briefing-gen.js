#!/usr/bin/env node

/**
 * briefing-gen.js — DevAgent Delegation Briefing Generator
 *
 * Generates pre-formatted delegation briefings for the Coordinator.
 * Reads all relevant context files and assembles a concise summary
 * tailored to the target agent and current phase.
 *
 * Usage: node .github/scripts/briefing-gen.js --agent <agent-name> --phase <N> [--context-dir <path>]
 *
 * Agent names: story-analyst, codebase-explorer, architect, developer,
 *              tester, reviewer, git-manager, researcher
 *
 * Zero dependencies — only Node.js built-in modules.
 */

const fs = require('node:fs');
const path = require('node:path');

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

function isTemplate(content) {
  if (!content) return true;
  const lower = content.toLowerCase();
  return lower.includes('(pending)') ||
    lower.includes('(to be filled)') ||
    lower.includes('(not yet written)') ||
    lower.includes('(template)');
}

function countLines(text) {
  if (!text) return 0;
  return text.split('\n').length;
}

// ─────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────

const PHASE_NAMES = {
  1: 'REQUIREMENTS',
  2: 'CODEBASE ANALYSIS',
  3: 'ARCHITECTURE & PLANNING',
  4: 'DEVELOPMENT',
  5: 'TESTING',
  6: 'CODE REVIEW',
  7: 'GIT OPERATIONS',
  8: 'RESEARCH',
};

const VALID_AGENTS = [
  'story-analyst',
  'codebase-explorer',
  'architect',
  'developer',
  'tester',
  'reviewer',
  'git-manager',
  'researcher',
];

const AGENT_DISPLAY_NAMES = {
  'story-analyst': 'Story Analyst',
  'codebase-explorer': 'Codebase Explorer',
  'architect': 'Architect',
  'developer': 'Developer',
  'tester': 'Tester',
  'reviewer': 'Reviewer',
  'git-manager': 'Git Manager',
  'researcher': 'Researcher',
};

const AGENT_NEEDS = {
  'story-analyst': {
    primary: ['requirements.md'],
    secondary: ['task-status.md', 'decisions-and-blockers.md'],
    focus: 'requirements, user story, AC',
  },
  'codebase-explorer': {
    primary: ['codebase-intel.md', 'task-status.md'],
    secondary: ['requirements.md'],
    focus: 'what areas to scan, what changed since last scan',
  },
  'architect': {
    primary: ['requirements.md', 'codebase-intel.md'],
    secondary: ['decisions-and-blockers.md', 'task-status.md'],
    focus: 'what to build, existing patterns, constraints',
  },
  'developer': {
    primary: ['implementation-plan.md', 'codebase-intel.md', 'requirements.md'],
    secondary: ['decisions-and-blockers.md', 'task-status.md'],
    focus: 'what to code, conventions, plan steps, scope',
  },
  'tester': {
    primary: ['requirements.md', 'code-changes.md', 'codebase-intel.md', 'implementation-plan.md'],
    secondary: ['task-status.md'],
    focus: 'what to test, AC, code changes, test conventions',
  },
  'reviewer': {
    primary: ['requirements.md', 'implementation-plan.md', 'code-changes.md', 'test-results.md', 'codebase-intel.md'],
    secondary: ['decisions-and-blockers.md', 'task-status.md'],
    focus: 'what was supposed to be built, what was built, test results',
  },
  'git-manager': {
    primary: ['code-changes.md', 'implementation-plan.md', 'codebase-intel.md', 'review-report.md', 'test-results.md'],
    secondary: ['task-status.md'],
    focus: 'files to commit, conventions, review verdict, test results',
  },
  'researcher': {
    primary: ['research-findings.md', 'codebase-intel.md'],
    secondary: ['task-status.md'],
    focus: 'what to research, existing tech stack context',
  },
};

// ─────────────────────────────────────────────────────────
// STEP 1: Read all context files
// ─────────────────────────────────────────────────────────

function readAllContext(contextDir) {
  const fileNames = [
    'task-status.md',
    'requirements.md',
    'implementation-plan.md',
    'code-changes.md',
    'test-results.md',
    'review-report.md',
    'git-status.md',
    'research-findings.md',
    'decisions-and-blockers.md',
    'codebase-intel.md',
  ];

  const ctx = {};
  const missing = [];
  const templates = [];

  for (const name of fileNames) {
    const content = readFileSafe(path.join(contextDir, name));
    const key = name.replace('.md', '').replaceAll('-', '_');
    if (content === null) {
      missing.push(name);
      ctx[key] = null;
    } else if (isTemplate(content)) {
      templates.push(name);
      ctx[key] = null; // treat template as not available
    } else {
      ctx[key] = content;
    }
  }

  return { ctx, missing, templates };
}

// ─────────────────────────────────────────────────────────
// STEP 2: Extract data from context files
// ─────────────────────────────────────────────────────────

function extractFromTaskStatus(ctx, info) {
  if (!ctx.task_status) return;
  const headers = parseHeaders(ctx.task_status);
  info.task_id = headers.task_id || headers['task id'] || null;
  info.scope = headers.scope || headers.scope_restrictions || null;
  info.profile = headers.context_profile || headers['context profile'] || 'standard';
}

function extractFromRequirements(ctx, info) {
  if (!ctx.requirements) return;
  const acPattern = /^\s*[-*\d.]+\s*\[?\s*[xX ]?\]?/gm;
  const matches = ctx.requirements.match(acPattern);
  info.ac_count = matches ? matches.length : 0;
  const acSection = ctx.requirements.match(/acceptance\s+criteria[:\s]*([\s\S]*?)(?=\n##|\n---|$)/i);
  if (acSection) {
    const items = acSection[1].match(/^\s*[-*\d]+[.)]\s/gm);
    if (items) info.ac_count = items.length;
  }
}

function extractFromPlan(ctx, info) {
  if (!ctx.implementation_plan) return;
  const stepMatches = ctx.implementation_plan.match(/^#+\s*(step|phase)\s*\d/gim);
  info.plan_steps = stepMatches ? stepMatches.length : 0;

  const filePattern = /\|\s*`?([^|`]+\.\w{1,5})`?\s*\|\s*(CREATE|MODIFY|DELETE|READ)/gi;
  let match;
  while ((match = filePattern.exec(ctx.implementation_plan)) !== null) {
    const file = match[1].trim();
    const action = match[2].toUpperCase();
    if (file !== 'File' && !file.includes('---')) {
      info.plan_files.push(`${file} (${action})`);
    }
  }
}

function extractFromTestResults(ctx, info) {
  if (!ctx.test_results) return;
  const passMatch = ctx.test_results.match(/pass(?:ed|ing)?[:\s]*(\d+)/i);
  const failMatch = ctx.test_results.match(/fail(?:ed|ing|ure)?[:\s]*(\d+)/i);
  if (passMatch) info.test_pass = Number.parseInt(passMatch[1], 10);
  if (failMatch) info.test_fail = Number.parseInt(failMatch[1], 10);
}

function extractFromReview(ctx, info) {
  if (!ctx.review_report) return;
  const verdictMatch = ctx.review_report.match(/verdict[:\s]*(APPROVED|REJECTED|CHANGES\s*REQUESTED)/i);
  if (verdictMatch) info.review_verdict = verdictMatch[1].toUpperCase();
}

function extractListItems(text) {
  const items = text.match(/^\s*[-*\d]+[.)]\s+.+$/gm);
  if (!items) return [];
  return items.map(i => i.replace(/^\s*[-*\d]+[.)]\s+/, '').trim());
}

function extractFromDecisions(ctx, info) {
  if (!ctx.decisions_and_blockers) return;
  const decisionSection = ctx.decisions_and_blockers.match(/decisions?[:\s]*([\s\S]*?)(?=\n##\s|$)/i);
  if (decisionSection) {
    info.active_decisions = extractListItems(decisionSection[1]);
  }
  const blockerSection = ctx.decisions_and_blockers.match(/blockers?[:\s]*([\s\S]*?)(?=\n##\s|$)/i);
  if (blockerSection) {
    info.open_blockers = extractListItems(blockerSection[1]);
  }
}

function extractFromCodebaseIntel(ctx, info) {
  if (!ctx.codebase_intel) return;
  const techSection = ctx.codebase_intel.match(/tech(?:nology)?\s*stack[:\s]*([\s\S]*?)(?=\n##|\n---|$)/i);
  if (techSection) {
    const lines = techSection[1].split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3);
    info.tech_stack = lines.join('; ').trim();
  }
}

function extractFromGitStatus(ctx, info) {
  if (!ctx.git_status) return;
  const branchMatch = ctx.git_status.match(/branch[:\s]*`?(\S+)`?/i);
  if (branchMatch) info.branch = branchMatch[1];
}

function extractTaskInfo(ctx) {
  const info = {
    task_id: null,
    phase: null,
    iteration: 1,
    scope: null,
    profile: 'standard',
    tech_stack: null,
    ac_count: 0,
    plan_steps: 0,
    plan_files: [],
    test_pass: 0,
    test_fail: 0,
    review_verdict: null,
    active_decisions: [],
    open_blockers: [],
    branch: null,
  };

  extractFromTaskStatus(ctx, info);
  extractFromRequirements(ctx, info);
  extractFromPlan(ctx, info);
  extractFromTestResults(ctx, info);
  extractFromReview(ctx, info);
  extractFromDecisions(ctx, info);
  extractFromCodebaseIntel(ctx, info);
  extractFromGitStatus(ctx, info);

  return info;
}

// ─────────────────────────────────────────────────────────
// STEP 3: Extract iteration count
// ─────────────────────────────────────────────────────────

function extractIteration(ctx, phase, agent) {
  if (!ctx.task_status) return 1;

  // Look for phase history table
  const historySection = ctx.task_status.match(/phase\s*history[:\s]*([\s\S]*?)(?=\n##\s|$)/i);
  if (!historySection) return 1;

  // Count how many rows mention this phase
  const rows = historySection[1].split('\n').filter(l => l.startsWith('|') && !l.includes('---'));
  let count = 0;
  for (const row of rows) {
    if (row.includes(String(phase)) || row.toLowerCase().includes(PHASE_NAMES[phase]?.toLowerCase() || '')) {
      count++;
    }
  }

  return Math.max(1, count);
}

// ─────────────────────────────────────────────────────────
// STEP 4: Build briefing sections
// ─────────────────────────────────────────────────────────

function buildWhatSection(agent, phase, taskInfo) {
  const phaseAction = {
    'story-analyst': 'Parse and validate the requirements, producing structured acceptance criteria.',
    'codebase-explorer': 'Scan the codebase to understand structure, conventions, and patterns.',
    'architect': 'Design the implementation plan based on requirements and codebase analysis.',
    'developer': 'Implement the approved plan, following conventions and scope constraints.',
    'tester': 'Write and run tests covering all acceptance criteria and edge cases.',
    'reviewer': 'Review the implementation for correctness, quality, security, and adherence to plan.',
    'git-manager': 'Prepare and execute git operations (branch, commit, push).',
    'researcher': 'Research technical questions and provide findings with source citations.',
  };
  return phaseAction[agent] || `Execute phase ${phase} tasks.`;
}

function buildWhySection(agent, phase, taskInfo, ctx) {
  const parts = [];

  if (taskInfo.task_id) {
    parts.push(`Task: ${taskInfo.task_id}.`);
  }

  if (taskInfo.ac_count > 0) {
    parts.push(`${taskInfo.ac_count} acceptance criteria defined.`);
  }

  if (phase >= 4 && taskInfo.plan_steps > 0) {
    parts.push(`Plan approved with ${taskInfo.plan_steps} steps.`);
  }

  if (phase >= 5 && taskInfo.test_pass + taskInfo.test_fail > 0) {
    parts.push(`Tests: ${taskInfo.test_pass} passed, ${taskInfo.test_fail} failed.`);
  }

  if (phase >= 6 && taskInfo.review_verdict) {
    parts.push(`Review verdict: ${taskInfo.review_verdict}.`);
  }

  return parts.length > 0 ? parts.join(' ') : `Phase ${phase} (${PHASE_NAMES[phase] || 'UNKNOWN'}) requires ${AGENT_DISPLAY_NAMES[agent]} execution.`;
}

function buildContextSection(agent, taskInfo, ctx) {
  const parts = [];

  if (taskInfo.tech_stack) {
    parts.push(`Tech stack: ${taskInfo.tech_stack}.`);
  }

  if (taskInfo.ac_count > 0) {
    parts.push(`${taskInfo.ac_count} acceptance criteria.`);
  }

  if (taskInfo.plan_steps > 0) {
    parts.push(`Plan has ${taskInfo.plan_steps} steps targeting ${taskInfo.plan_files.length} files.`);
  }

  if (taskInfo.branch) {
    parts.push(`Branch: ${taskInfo.branch}.`);
  }

  return parts.length > 0 ? parts.join(' ') : 'No additional context available.';
}

function buildConstraintsSection(taskInfo) {
  if (taskInfo.scope) {
    return taskInfo.scope;
  }
  return 'No scope restrictions defined — treat all paths as NO-ACCESS per RULE 11';
}

function buildScopeTable(ctx) {
  if (!ctx.task_status) return null;

  // Look for scope table in task-status.md
  const lines = ctx.task_status.split('\n');
  const tableLines = [];
  let inTable = false;

  for (const line of lines) {
    if (line.includes('| Path') || line.includes('| Directory') || line.includes('| Scope')) {
      inTable = true;
    }
    if (inTable && line.startsWith('|')) {
      tableLines.push(line);
    } else if (inTable && !line.startsWith('|') && line.trim() !== '') {
      break;
    }
  }

  return tableLines.length > 0 ? tableLines.join('\n') : null;
}

function buildDecisionsSection(taskInfo, profileConfig) {
  if (taskInfo.active_decisions.length === 0) return 'None.';

  let decisions = taskInfo.active_decisions;
  if (typeof profileConfig.include_decisions === 'number') {
    decisions = decisions.slice(-profileConfig.include_decisions);
  }
  // 'all' means keep all

  return decisions.map((d, i) => `Decision #${i + 1}: ${d}`).join('\n');
}

function buildBlockersSection(taskInfo) {
  if (taskInfo.open_blockers.length === 0) return 'None.';
  return taskInfo.open_blockers.join('\n');
}

// ─────────────────────────────────────────────────────────
// STEP 5: Filter by profile relevance
// ─────────────────────────────────────────────────────────

function getProfileConfig(profileName) {
  // Try to import PROFILE_BUDGETS from context-tool.js
  try {
    const contextTool = require('./context-tool');
    if (contextTool.PROFILE_BUDGETS?.[profileName]) {
      return contextTool.PROFILE_BUDGETS[profileName];
    }
  } catch {
    // Fallback if context-tool.js not available
  }

  // Fallback defaults
  const defaults = {
    minimal: {
      include_sections: ['what', 'why', 'constraints', 'blockers'],
      detail_level: 'summary',
      include_decisions: 3,
      include_research: false,
      include_history: false,
    },
    standard: {
      include_sections: ['what', 'why', 'context', 'constraints', 'decisions', 'blockers'],
      detail_level: 'normal',
      include_decisions: 10,
      include_research: true,
      include_history: true,
    },
    full: {
      include_sections: ['what', 'why', 'context', 'constraints', 'decisions', 'blockers', 'research'],
      detail_level: 'full',
      include_decisions: 'all',
      include_research: true,
      include_history: true,
    },
    extended: {
      include_sections: ['what', 'why', 'context', 'constraints', 'decisions', 'blockers', 'research', 'history'],
      detail_level: 'full',
      include_decisions: 'all',
      include_research: true,
      include_history: true,
    },
  };

  return defaults[profileName] || defaults.standard;
}

function filterSectionsByProfile(sections, profileConfig) {
  const allowed = new Set(profileConfig.include_sections);
  const filtered = {};

  for (const [key, value] of Object.entries(sections)) {
    if (allowed.has(key)) {
      filtered[key] = value;
    }
  }

  return filtered;
}

// ─────────────────────────────────────────────────────────
// MAIN: Assemble briefing
// ─────────────────────────────────────────────────────────

function generateBriefing(agent, phase, contextDir) {
  // Validate agent
  if (!VALID_AGENTS.includes(agent)) {
    return { error: true, message: `Invalid agent name: "${agent}". Valid agents: ${VALID_AGENTS.join(', ')}` };
  }

  // Validate phase
  const phaseNum = Number.parseInt(phase, 10);
  if (Number.isNaN(phaseNum) || phaseNum < 1 || phaseNum > 8) {
    return { error: true, message: `Invalid phase: "${phase}". Must be 1-8.` };
  }

  // Step 1: Read all context files
  const { ctx, missing, templates } = readAllContext(contextDir);

  // Step 2: Extract task info
  const taskInfo = extractTaskInfo(ctx);

  // Step 3: Get iteration
  const iteration = extractIteration(ctx, phaseNum, agent);

  // Get profile config
  const profileConfig = getProfileConfig(taskInfo.profile);

  // Step 4: Build all sections
  const allSections = {
    what: buildWhatSection(agent, phaseNum, taskInfo),
    why: buildWhySection(agent, phaseNum, taskInfo, ctx),
    context: buildContextSection(agent, taskInfo, ctx),
    constraints: buildConstraintsSection(taskInfo),
    decisions: buildDecisionsSection(taskInfo, profileConfig),
    blockers: buildBlockersSection(taskInfo),
  };

  // Add research section if profile includes it
  if (profileConfig.include_research && ctx.research_findings) {
    allSections.research = ctx.research_findings.split('\n').slice(0, 20).join('\n');
  }

  // Add history section if profile includes it
  if (profileConfig.include_history && ctx.task_status) {
    const historySection = ctx.task_status.match(/phase\s*history[:\s]*([\s\S]*?)(?=\n##\s|$)/i);
    if (historySection) {
      allSections.history = historySection[1].trim();
    }
  }

  // Step 5: Filter by profile
  const filteredSections = filterSectionsByProfile(allSections, profileConfig);

  // Build scope table
  const scopeTable = buildScopeTable(ctx);

  // Key files (top 5)
  const keyFiles = taskInfo.plan_files.slice(0, 5);

  // Note missing/template files relevant to this agent
  const agentNeeds = AGENT_NEEDS[agent];
  const missingForAgent = [];
  for (const file of [...agentNeeds.primary, ...agentNeeds.secondary]) {
    if (missing.includes(file)) {
      missingForAgent.push(`${file} not yet written`);
    } else if (templates.includes(file)) {
      missingForAgent.push(`${file} is still a template`);
    }
  }

  // Calculate line count of the output
  const briefingText = Object.values(filteredSections).join('\n');
  const lineCount = countLines(briefingText);

  return {
    briefing: {
      to: AGENT_DISPLAY_NAMES[agent],
      phase: phaseNum,
      phase_name: PHASE_NAMES[phaseNum] || 'UNKNOWN',
      task_id: taskInfo.task_id,
      iteration,
      sections: filteredSections,
      scope_table: scopeTable || undefined,
      key_files: keyFiles.length > 0 ? keyFiles : undefined,
      missing_context: missingForAgent.length > 0 ? missingForAgent : undefined,
      profile: taskInfo.profile,
      line_count: lineCount,
    },
  };
}

function main() {
  const agent = getFlag('--agent');
  const phase = getFlag('--phase');

  if (!agent) fail('Missing required flag: --agent <agent-name>');
  if (!phase) fail('Missing required flag: --phase <N>');

  const repoRoot = findRepoRoot(process.cwd());
  const contextDirFlag = getFlag('--context-dir');
  const contextDir = contextDirFlag
    ? path.resolve(contextDirFlag)
    : path.join(repoRoot, '.github', 'context');

  const result = generateBriefing(agent, phase, contextDir);

  if (result.error) {
    fail(result.message);
  }

  output(result);
}

// Only run CLI when executed directly
if (require.main === module) {
  main();
}

module.exports = {
  generateBriefing,
  readAllContext,
  extractTaskInfo,
  extractIteration,
  buildWhatSection,
  buildWhySection,
  buildContextSection,
  filterSectionsByProfile,
  getProfileConfig,
  AGENT_NEEDS,
  VALID_AGENTS,
};
