#!/usr/bin/env node

/**
 * pre-impl-check.js — DevAgent Pre-Implementation Verification CLI
 *
 * Verifies that all files, functions, and dependencies referenced in the
 * implementation plan actually exist before the Developer starts coding.
 * Prevents the most expensive failure mode: building on wrong assumptions.
 *
 * Usage: node .github/scripts/pre-impl-check.js [--context-dir <path>]
 *
 * Built with zero dependencies — only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────
// UTILITIES (same patterns as context-tool.js)
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

function parseJsonSafe(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

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

// ─────────────────────────────────────────────────────────
// STEP 1: Read and validate context files
// ─────────────────────────────────────────────────────────

function readContextFiles(contextDir) {
  const files = {};
  const missing = [];

  // implementation-plan.md is REQUIRED
  const planPath = path.join(contextDir, 'implementation-plan.md');
  const planContent = readFileSafe(planPath);
  if (!planContent) {
    fail('implementation-plan.md not found or empty. Cannot verify plan without it.');
  }
  files.plan = { content: planContent, headers: parseContextHeaders(planContent) };

  // task-status.md — needed for task ID and scope
  const statusPath = path.join(contextDir, 'task-status.md');
  const statusContent = readFileSafe(statusPath);
  if (statusContent) {
    files.status = { content: statusContent, headers: parseContextHeaders(statusContent) };
  } else {
    missing.push('task-status.md');
  }

  // codebase-intel.md — needed for tech stack
  const intelPath = path.join(contextDir, 'codebase-intel.md');
  const intelContent = readFileSafe(intelPath);
  if (intelContent) {
    files.intel = { content: intelContent, headers: parseContextHeaders(intelContent) };
  }

  // requirements.md — needed for AC cross-reference
  const reqPath = path.join(contextDir, 'requirements.md');
  const reqContent = readFileSafe(reqPath);
  if (reqContent) {
    files.requirements = { content: reqContent, headers: parseContextHeaders(reqContent) };
  }

  return { files, missing };
}

// ─────────────────────────────────────────────────────────
// STEP 2: Parse implementation plan for file references
// ─────────────────────────────────────────────────────────

function parsePlanFileReferences(planContent) {
  const references = [];
  const seen = new Set();

  // Pattern 1: Table rows — | ACTION | `path/to/file.ext` | ...
  const tablePattern = /\|\s*(CREATE|MODIFY|DELETE|ADD|EDIT|UPDATE|READ)\s*\|\s*`?([^|`\n]+\.\w+)`?\s*\|/gi;
  let match;
  while ((match = tablePattern.exec(planContent)) !== null) {
    const action = normalizeAction(match[1]);
    const filePath = match[2].trim();
    const key = `${action}:${filePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      references.push({ action, path: filePath, source: 'table' });
    }
  }

  // Pattern 2: Inline — CREATE/MODIFY/etc followed by backtick path
  const inlinePattern = /(?:CREATE|MODIFY|DELETE|EDIT|ADD|UPDATE|READ)\s+.*?`([^`]+\.\w+)`/gi;
  while ((match = inlinePattern.exec(planContent)) !== null) {
    const actionMatch = match[0].match(/^(CREATE|MODIFY|DELETE|EDIT|ADD|UPDATE|READ)/i);
    if (!actionMatch) continue;
    const action = normalizeAction(actionMatch[1]);
    const filePath = match[1].trim();
    const key = `${action}:${filePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      references.push({ action, path: filePath, source: 'inline' });
    }
  }

  // Pattern 3: File-by-File section — lines starting with ### or #### followed by path
  const sectionPattern = /^#{2,4}\s+(?:(?:Step\s+\d+[:.]\s*)?(?:CREATE|MODIFY|DELETE|EDIT|ADD|UPDATE|READ)\s+)?`?([^\s`]+\.\w+)`?/gim;
  while ((match = sectionPattern.exec(planContent)) !== null) {
    const filePath = match[1].trim();
    if (filePath.includes('/') || filePath.includes('\\')) {
      // Determine action from surrounding text
      const lineStart = planContent.lastIndexOf('\n', match.index) + 1;
      const lineEnd = planContent.indexOf('\n', match.index);
      const line = planContent.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      const action = detectActionFromLine(line);
      const key = `${action}:${filePath}`;
      if (!seen.has(key)) {
        seen.add(key);
        references.push({ action, path: filePath, source: 'section-heading' });
      }
    }
  }

  // Pattern 4: Backtick paths in the File-by-File Plan section
  const fileByFileSectionMatch = planContent.match(/## File-by-File Plan\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (fileByFileSectionMatch) {
    const sectionContent = fileByFileSectionMatch[1];
    const backtickPaths = /`([^`\s]+\.\w{1,10})`/g;
    while ((match = backtickPaths.exec(sectionContent)) !== null) {
      const filePath = match[1].trim();
      // Skip things that look like code, not paths
      if (filePath.includes('(') || filePath.includes(')') || filePath.includes('{')) continue;
      if (!filePath.includes('/') && !filePath.includes('\\')) continue;

      // Try to detect action from nearby text
      const contextStart = Math.max(0, match.index - 100);
      const context = sectionContent.slice(contextStart, match.index + match[0].length);
      const action = detectActionFromLine(context);
      const key = `${action}:${filePath}`;
      if (!seen.has(key)) {
        seen.add(key);
        references.push({ action, path: filePath, source: 'file-by-file' });
      }
    }
  }

  return references;
}

function normalizeAction(raw) {
  const upper = raw.toUpperCase().trim();
  switch (upper) {
    case 'CREATE': case 'ADD': return 'CREATE';
    case 'MODIFY': case 'EDIT': case 'UPDATE': return 'MODIFY';
    case 'DELETE': return 'DELETE';
    case 'READ': return 'READ';
    default: return 'MODIFY'; // default assumption
  }
}

function detectActionFromLine(line) {
  const upper = line.toUpperCase();
  if (upper.includes('CREATE') || upper.includes('NEW FILE') || upper.includes('ADD NEW')) return 'CREATE';
  if (upper.includes('DELETE') || upper.includes('REMOVE')) return 'DELETE';
  if (upper.includes('READ') || upper.includes('REFERENCE')) return 'READ';
  return 'MODIFY'; // default
}

// ─────────────────────────────────────────────────────────
// STEP 3: Verify files exist
// ─────────────────────────────────────────────────────────

function verifyFiles(repoRoot, references) {
  const result = {
    status: 'pass',
    checked: references.length,
    found: 0,
    missing: [],
    new_files: [],
    overwrite_warnings: [],
    wildcard_skipped: [],
  };

  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    const filePath = ref.path;

    // Skip wildcard paths
    if (filePath.includes('*')) {
      result.wildcard_skipped.push({ path: filePath, plan_step: i + 1 });
      continue;
    }

    // Skip node_modules, .git, etc
    if (filePath.startsWith('node_modules/') || filePath.startsWith('.git/')) {
      continue;
    }

    // Resolve path relative to repo root
    const resolved = path.resolve(repoRoot, filePath.replace(/^\.\//, ''));
    const exists = fs.existsSync(resolved);

    switch (ref.action) {
      case 'CREATE':
        if (exists) {
          result.overwrite_warnings.push({
            path: filePath,
            plan_step: i + 1,
            message: 'File already exists — will be overwritten',
          });
        } else {
          result.new_files.push({ path: filePath, plan_step: i + 1, action: 'CREATE' });
        }
        break;

      case 'MODIFY':
      case 'READ':
        if (exists) {
          result.found++;
        } else {
          result.missing.push({
            path: filePath,
            plan_step: i + 1,
            action: ref.action,
          });
        }
        break;

      case 'DELETE':
        if (exists) {
          result.found++;
        } else {
          result.missing.push({
            path: filePath,
            plan_step: i + 1,
            action: 'DELETE',
            message: 'File to delete does not exist',
          });
        }
        break;
    }
  }

  if (result.missing.length > 0) {
    result.status = 'fail';
  }

  return result;
}

// ─────────────────────────────────────────────────────────
// STEP 4: Parse and check scope restrictions
// ─────────────────────────────────────────────────────────

function checkScopeCompliance(statusContent, references) {
  const result = {
    status: 'pass',
    violations: [],
    escalations_needed: [],
    has_scope_restrictions: false,
  };

  if (!statusContent) return result;

  // Find scope restrictions section
  const scopeMatch = statusContent.match(/## Scope Restrictions\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (!scopeMatch) return result;

  result.has_scope_restrictions = true;
  const scopeContent = scopeMatch[1];

  // Parse table rows: | Path | Access Level |
  const scopeRules = [];
  const rowPattern = /\|\s*`?([^|`]+)`?\s*\|\s*(READ-ONLY|READ-WRITE|NO-ACCESS|FULL)\s*\|/gi;
  let match;
  while ((match = rowPattern.exec(scopeContent)) !== null) {
    scopeRules.push({
      path: match[1].trim(),
      access: match[2].toUpperCase().trim(),
    });
  }

  if (scopeRules.length === 0) return result;

  // Check each planned file against scope rules
  for (const ref of references) {
    const accessNeeded = ref.action === 'READ' ? 'READ' : 'WRITE';
    const matchedRule = findBestScopeMatch(ref.path, scopeRules);

    if (!matchedRule) {
      // Unlisted path — per RULE 11, treat as NO-ACCESS and escalate
      result.escalations_needed.push({
        path: ref.path,
        action: ref.action,
        reason: 'Path not in scope restrictions — needs explicit approval (RULE 11)',
      });
      continue;
    }

    const allowed = isAccessAllowed(matchedRule.access, accessNeeded);
    if (!allowed) {
      result.violations.push({
        path: ref.path,
        action: ref.action,
        scope_rule: matchedRule.path,
        access_level: matchedRule.access,
        reason: `${ref.action} requires ${accessNeeded} access but scope is ${matchedRule.access}`,
      });
    }
  }

  if (result.violations.length > 0) {
    result.status = 'fail';
  }

  return result;
}

function findBestScopeMatch(filePath, scopeRules) {
  // Longest prefix match
  let bestMatch = null;
  let bestLength = 0;

  for (const rule of scopeRules) {
    const rulePath = rule.path.replace(/\/$/, '');
    if (filePath.startsWith(rulePath) || filePath === rulePath) {
      if (rulePath.length > bestLength) {
        bestLength = rulePath.length;
        bestMatch = rule;
      }
    }
  }

  return bestMatch;
}

function isAccessAllowed(scopeAccess, needed) {
  switch (scopeAccess) {
    case 'FULL':
    case 'READ-WRITE':
      return true;
    case 'READ-ONLY':
      return needed === 'READ';
    case 'NO-ACCESS':
      return false;
    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────────
// STEP 5: Check dependencies
// ─────────────────────────────────────────────────────────

function checkDependencies(repoRoot, planContent) {
  const result = {
    status: 'pass',
    missing: [],
    version_mismatches: [],
  };

  // Extract dependency mentions from plan (in code blocks or inline)
  const depMentions = extractDependencyMentions(planContent);
  if (depMentions.length === 0) return result;

  // Detect package manager and installed deps
  const installed = getInstalledDependencies(repoRoot);
  if (!installed) return result; // Can't check — no package manifest found

  for (const dep of depMentions) {
    const installedVersion = installed.deps[dep.name];
    if (!installedVersion) {
      result.missing.push({
        name: dep.name,
        mentioned_in: dep.context,
      });
    } else if (dep.version && installedVersion) {
      // Basic version mismatch check (major version only)
      const installedMajor = installedVersion.replace(/[\^~>=<]/, '').split('.')[0];
      const mentionedMajor = dep.version.replace(/[\^~>=<v]/, '').split('.')[0];
      if (installedMajor !== mentionedMajor && mentionedMajor !== '') {
        result.version_mismatches.push({
          name: dep.name,
          installed: installedVersion,
          mentioned: dep.version,
        });
      }
    }
  }

  if (result.missing.length > 0 || result.version_mismatches.length > 0) {
    result.status = 'warn';
  }

  return result;
}

function extractDependencyMentions(planContent) {
  const mentions = [];
  const seen = new Set();

  // Pattern: "install <package>" or "npm install <package>" or "pip install <package>"
  const installPattern = /(?:npm|yarn|pnpm|pip|cargo add|go get)\s+(?:install\s+)?(?:--save(?:-dev)?\s+)?([a-z@][a-z0-9@/_.-]+)(?:@(\S+))?/gi;
  let match;
  while ((match = installPattern.exec(planContent)) !== null) {
    const name = match[1].trim();
    if (!seen.has(name)) {
      seen.add(name);
      mentions.push({ name, version: match[2] || null, context: 'install command' });
    }
  }

  // Pattern: "import ... from '<package>'" or "require('<package>')"
  const importPattern = /(?:from\s+['"]|require\s*\(\s*['"])([a-z@][a-z0-9@/_.-]*)['"]/gi;
  while ((match = importPattern.exec(planContent)) !== null) {
    const name = match[1].split('/')[0]; // Get package name (handle scoped: @scope/name)
    const fullName = match[1].startsWith('@') ? match[1].split('/').slice(0, 2).join('/') : name;
    if (!seen.has(fullName) && !isBuiltinModule(fullName)) {
      seen.add(fullName);
      mentions.push({ name: fullName, version: null, context: 'import statement' });
    }
  }

  return mentions;
}

function isBuiltinModule(name) {
  const builtins = new Set([
    'fs', 'path', 'os', 'http', 'https', 'url', 'util', 'events', 'stream',
    'crypto', 'child_process', 'net', 'readline', 'zlib', 'buffer', 'assert',
    'querystring', 'string_decoder', 'cluster', 'dns', 'tls', 'dgram',
    'worker_threads', 'perf_hooks', 'async_hooks', 'v8', 'vm', 'timers',
  ]);
  return builtins.has(name);
}

function getInstalledDependencies(repoRoot) {
  // Node.js
  const pkgPath = path.join(repoRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const content = readFileSafe(pkgPath);
    const pkg = parseJsonSafe(content);
    if (pkg) {
      const deps = {};
      for (const [name, version] of Object.entries(pkg.dependencies || {})) {
        deps[name] = version;
      }
      for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
        deps[name] = version;
      }
      return { type: 'npm', deps };
    }
  }

  // Python
  const reqPath = path.join(repoRoot, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    const content = readFileSafe(reqPath);
    if (content) {
      const deps = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split(/[=<>!~]+/);
        if (parts[0]) deps[parts[0].trim()] = parts[1] || '*';
      }
      return { type: 'pip', deps };
    }
  }

  // Go
  const goModPath = path.join(repoRoot, 'go.mod');
  if (fs.existsSync(goModPath)) {
    const content = readFileSafe(goModPath);
    if (content) {
      const deps = {};
      const requirePattern = /^\s+([\w./]+)\s+v([\d.]+)/gm;
      let match;
      while ((match = requirePattern.exec(content)) !== null) {
        deps[match[1]] = match[2];
      }
      return { type: 'go', deps };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────
// STEP 6: Check conventions.json
// ─────────────────────────────────────────────────────────

function checkConventions(contextDir) {
  const conventionsPath = path.join(contextDir, 'conventions.json');
  return fs.existsSync(conventionsPath);
}

// ─────────────────────────────────────────────────────────
// Check plan approval status
// ─────────────────────────────────────────────────────────

function checkPlanApproval(planContent, planHeaders) {
  // Check header for status
  const status = planHeaders.status || planHeaders.plan_status || null;

  if (status) {
    const upper = status.toUpperCase();
    if (upper === 'APPROVED') return { status: 'pass', value: 'APPROVED' };
    if (upper === 'DRAFT') return { status: 'fail', value: 'DRAFT' };
    return { status: 'fail', value: status };
  }

  // Check if plan is still a template (pending values)
  const templateMarkers = [
    '(To be filled by Architect Planner)',
    '(pending)',
    '**Task ID**: (pending)',
  ];

  for (const marker of templateMarkers) {
    if (planContent.includes(marker)) {
      return { status: 'fail', value: 'TEMPLATE (unfilled)' };
    }
  }

  // Check for ## Approach Summary having real content
  const approachMatch = planContent.match(/## Approach Summary\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (approachMatch) {
    const content = approachMatch[1].trim();
    if (content && content.length > 20 && !content.startsWith('(To be filled')) {
      // Plan has real content — assume approved if no explicit status
      return { status: 'pass', value: 'APPROVED (implicit — plan has content)' };
    }
  }

  return { status: 'fail', value: 'UNKNOWN — no approval status found' };
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

  // Step 1: Read context files
  const { files, missing: missingContext } = readContextFiles(contextDir);

  // Extract task ID
  const taskId = files.status
    ? (files.status.headers.task_id || null)
    : null;

  // Check plan approval
  const planApproval = checkPlanApproval(files.plan.content, files.plan.headers);

  // Step 2: Parse file references from plan
  const references = parsePlanFileReferences(files.plan.content);

  // Step 3: Verify files exist
  const filesCheck = verifyFiles(repoRoot, references);

  // Step 4: Scope compliance
  const scopeCheck = checkScopeCompliance(
    files.status ? files.status.content : null,
    references
  );

  // Step 5: Dependencies
  const depsCheck = checkDependencies(repoRoot, files.plan.content);

  // Step 6: Conventions loaded
  const conventionsLoaded = checkConventions(contextDir);

  // Build warnings and blockers
  const warnings = [];
  const blockers = [];

  // Plan not approved → blocker
  if (planApproval.status !== 'pass') {
    blockers.push(`Plan not APPROVED: status is "${planApproval.value}"`);
  }

  // Missing files → blocker
  for (const m of filesCheck.missing) {
    blockers.push(`${m.action} target missing: ${m.path} (plan step ${m.plan_step})`);
  }

  // Scope violations → blocker
  for (const v of scopeCheck.violations) {
    blockers.push(`Scope violation: ${v.path} — ${v.reason}`);
  }

  // Scope escalations → warning
  for (const e of scopeCheck.escalations_needed) {
    warnings.push(`Unlisted scope path: ${e.path} — ${e.reason}`);
  }

  // Overwrite warnings
  for (const o of filesCheck.overwrite_warnings) {
    warnings.push(`CREATE target already exists: ${o.path} — ${o.message}`);
  }

  // Wildcard paths
  for (const w of filesCheck.wildcard_skipped) {
    warnings.push(`Wildcard path cannot be verified: ${w.path}`);
  }

  // Missing dependencies → warning
  for (const d of depsCheck.missing) {
    warnings.push(`Dependency not installed: ${d.name} (${d.mentioned_in})`);
  }

  // Version mismatches → warning
  for (const v of depsCheck.version_mismatches) {
    warnings.push(`Dependency version mismatch: ${v.name} — installed ${v.installed}, plan mentions ${v.mentioned}`);
  }

  // Missing context files → warning
  for (const m of missingContext) {
    warnings.push(`Context file missing: ${m}`);
  }

  // Conventions not loaded → warning
  if (!conventionsLoaded) {
    warnings.push('conventions.json not found — run convention-scanner first for best results');
  }

  // No file references in plan → blocker
  if (references.length === 0) {
    blockers.push('No file references found in implementation plan');
  }

  // No scope restrictions and plan has files → warning
  if (!scopeCheck.has_scope_restrictions && references.length > 0) {
    warnings.push('No scope restrictions defined in task-status.md');
  }

  const ready = blockers.length === 0;

  output({
    ready,
    plan_status: planApproval.value,
    task_id: taskId === '(none)' ? null : taskId,
    checks: {
      plan_approved: planApproval,
      files_exist: {
        status: filesCheck.status,
        checked: filesCheck.checked,
        found: filesCheck.found,
        missing: filesCheck.missing.length > 0 ? filesCheck.missing : undefined,
        new_files: filesCheck.new_files.length > 0 ? filesCheck.new_files : undefined,
      },
      scope_compliance: {
        status: scopeCheck.status,
        violations: scopeCheck.violations.length > 0 ? scopeCheck.violations : undefined,
        escalations_needed: scopeCheck.escalations_needed.length > 0 ? scopeCheck.escalations_needed : undefined,
      },
      dependencies: {
        status: depsCheck.status,
        missing: depsCheck.missing.length > 0 ? depsCheck.missing : undefined,
        version_mismatches: depsCheck.version_mismatches.length > 0 ? depsCheck.version_mismatches : undefined,
      },
      conventions_loaded: conventionsLoaded,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
    blockers: blockers.length > 0 ? blockers : undefined,
  });
}

// Only run CLI when executed directly
if (require.main === module) {
  main();
}

module.exports = {
  parsePlanFileReferences,
  verifyFiles,
  checkScopeCompliance,
  checkDependencies,
  checkPlanApproval,
  normalizeAction,
  detectActionFromLine,
};
