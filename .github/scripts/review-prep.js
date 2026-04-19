#!/usr/bin/env node

/**
 * review-prep.js — DevAgent Pre-Review Static Analysis
 *
 * Pre-scans changed files for security vulnerabilities, performance issues,
 * convention violations, plan compliance, and test quality before the
 * Reviewer agent does its full review.
 *
 * Usage: node .github/scripts/review-prep.js [--context-dir <path>]
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

// ─────────────────────────────────────────────────────────
// SECURITY PATTERNS
// ─────────────────────────────────────────────────────────

const UNIVERSAL_SECURITY = [
  {
    id: 'HARDCODED_SECRETS',
    patterns: [
      /(?:password|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
      /(?:AWS_SECRET|GITHUB_TOKEN|GITLAB_TOKEN|DATABASE_URL)\s*[:=]\s*['"][^'"]+['"]/gi,
    ],
    severity: 'BLOCKER',
    fix: 'Use environment variables',
  },
  {
    id: 'AUTH_BYPASS',
    patterns: [
      /(?:isAuth|isAdmin|authorized|authenticated)\s*[:=]\s*true/gi,
      /if\s*\(\s*true\s*\)/g,
      /\/\/\s*TODO:?\s*(?:add|implement)\s*auth/gi,
      /#\s*TODO:?\s*(?:add|implement)\s*auth/gi,
    ],
    severity: 'BLOCKER',
    fix: 'Implement proper authentication check',
  },
  {
    id: 'INSECURE_DEFAULTS',
    patterns: [
      /(?:secure|httpOnly|sameSite)\s*[:=]\s*false/gi,
      /http:\/\/(?!localhost|127\.0\.0\.1)/gi,
    ],
    severity: 'WARNING',
    fix: 'Enable security flags, use HTTPS',
  },
  {
    id: 'INFO_LEAKAGE',
    patterns: [
      /(?:console\.log|print|System\.out|fmt\.Print|log\.).*(?:password|token|secret|key)/gi,
    ],
    severity: 'WARNING',
    fix: 'Remove sensitive data from logs',
  },
];

const LANGUAGE_SECURITY = {
  javascript: [
    {
      id: 'SQL_INJECTION',
      patterns: [
        /(?:query|execute|raw)\s*\(\s*[`'"]\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER).*\$\{/gi,
        /(?:query|execute|raw)\s*\(\s*['"].*\+\s*\w+/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Use parameterized queries: db.query("SELECT * FROM t WHERE id = $1", [id])',
    },
    {
      id: 'XSS',
      patterns: [
        /\.innerHTML\s*=\s*(?!['"]<)/g,
        /dangerouslySetInnerHTML/g,
        /document\.write\s*\(/g,
      ],
      severity: 'BLOCKER',
      fix: 'Use textContent, React JSX, or sanitize input',
    },
    {
      id: 'PATH_TRAVERSAL',
      patterns: [
        /(?:readFile|createReadStream|open|access)(?:Sync)?\s*\(.*(?:req\.|params\.|query\.|body\.)/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Validate and sanitize file paths',
    },
    {
      id: 'SSRF',
      patterns: [
        /(?:fetch|axios|http\.get|request)\s*\(.*(?:req\.|params\.|query\.|body\.)/gi,
      ],
      severity: 'WARNING',
      fix: 'Validate URLs against allowlist',
    },
    {
      id: 'INSECURE_CORS',
      patterns: [
        /(?:Access-Control-Allow-Origin|cors).*['"]\*['"]/gi,
        /origin:\s*true/gi,
      ],
      severity: 'WARNING',
      fix: 'Restrict CORS to specific origins',
    },
  ],

  python: [
    {
      id: 'SQL_INJECTION',
      patterns: [
        /(?:execute|executemany|raw)\s*\(\s*f['"].*(?:SELECT|INSERT|UPDATE|DELETE)/gi,
        /(?:execute|executemany)\s*\(\s*['"].*%s/gi,
        /(?:execute|executemany)\s*\(\s*['"].*\.format\(/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Use parameterized queries: cursor.execute("SELECT * FROM t WHERE id = %s", (id,))',
    },
    {
      id: 'XSS',
      patterns: [/mark_safe\s*\(/g, /\|\s*safe\b/g, /SafeString\s*\(/g],
      severity: 'BLOCKER',
      fix: 'Avoid mark_safe() with user input. Use Django auto-escaping.',
    },
    {
      id: 'COMMAND_INJECTION',
      patterns: [
        /os\.system\s*\(.*(?:request|input|argv)/gi,
        /subprocess\.(?:call|run|Popen)\s*\(.*shell\s*=\s*True/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Use subprocess with shell=False and argument list',
    },
    {
      id: 'PATH_TRAVERSAL',
      patterns: [
        /open\s*\(.*(?:request|input|argv)/gi,
        /os\.path\.join\s*\(.*(?:request|input)/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Validate paths with os.path.realpath() and check prefix',
    },
    {
      id: 'DESERIALIZATION',
      patterns: [/pickle\.loads?\s*\(/g, /yaml\.load\s*\((?!.*Loader)/g],
      severity: 'BLOCKER',
      fix: 'Use yaml.safe_load(), avoid pickle with untrusted data',
    },
  ],

  java: [
    {
      id: 'SQL_INJECTION',
      patterns: [
        /(?:executeQuery|executeUpdate|execute)\s*\(\s*['"].*\+/gi,
        /Statement.*(?:executeQuery|execute)\s*\(/gi,
        /createQuery\s*\(\s*['"].*\+/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Use PreparedStatement with ? placeholders',
    },
    {
      id: 'XSS',
      patterns: [
        /<%=.*request\.getParameter/gi,
        /getWriter\(\)\.(?:print|write)\s*\(.*request/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Use JSTL <c:out> or encode output with ESAPI',
    },
    {
      id: 'DESERIALIZATION',
      patterns: [/ObjectInputStream.*readObject/gi, /XMLDecoder/gi],
      severity: 'BLOCKER',
      fix: 'Validate object types before deserialization, use allowlists',
    },
    {
      id: 'PATH_TRAVERSAL',
      patterns: [/new\s+File\s*\(.*(?:getParameter|request)/gi],
      severity: 'BLOCKER',
      fix: 'Canonicalize paths and validate against allowed directory',
    },
  ],

  go: [
    {
      id: 'SQL_INJECTION',
      patterns: [
        /(?:Query|Exec|QueryRow)\s*\(\s*(?:fmt\.Sprintf|['"].*\+)/gi,
        /db\.(?:Query|Exec)\s*\(.*\+/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Use parameterized queries: db.Query("SELECT * FROM t WHERE id = $1", id)',
    },
    {
      id: 'XSS',
      patterns: [
        /template\.HTML\s*\(/g,
        /w\.Write\s*\(\[\]byte\s*\(.*(?:request|r\.)/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Use html/template (not text/template) for HTML output',
    },
    {
      id: 'COMMAND_INJECTION',
      patterns: [/exec\.Command\s*\(.*(?:request|r\.)/gi],
      severity: 'BLOCKER',
      fix: 'Validate command arguments, avoid shell execution',
    },
  ],

  ruby: [
    {
      id: 'SQL_INJECTION',
      patterns: [
        /where\s*\(\s*['"].*#\{/gi,
        /find_by_sql\s*\(\s*['"].*#\{/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Use parameterized queries: where("name = ?", name)',
    },
    {
      id: 'XSS',
      patterns: [/\.html_safe/g, /raw\s*\(/g],
      severity: 'BLOCKER',
      fix: 'Avoid .html_safe with user input, use ERB auto-escaping',
    },
    {
      id: 'COMMAND_INJECTION',
      patterns: [/system\s*\(|`.*#\{|exec\s*\(.*#\{/g],
      severity: 'BLOCKER',
      fix: 'Use array form of system() or Open3',
    },
  ],

  csharp: [
    {
      id: 'SQL_INJECTION',
      patterns: [
        /SqlCommand\s*\(\s*['"].*\+/gi,
        /ExecuteSqlRaw\s*\(\s*\$['"/]/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Use SqlParameter or parameterized queries',
    },
    {
      id: 'XSS',
      patterns: [/Html\.Raw\s*\(/g, /\[AllowHtml\]/g],
      severity: 'BLOCKER',
      fix: 'Avoid Html.Raw() with user input, use Razor auto-encoding',
    },
    {
      id: 'PATH_TRAVERSAL',
      patterns: [/File\.(?:Read|Open|Write).*(?:Request|Query|Form)/gi],
      severity: 'BLOCKER',
      fix: 'Validate paths with Path.GetFullPath() and check prefix',
    },
  ],

  php: [
    {
      id: 'SQL_INJECTION',
      patterns: [
        /(?:mysql_query|mysqli_query|pg_query)\s*\(.*\$/gi,
        /query\s*\(\s*['"].*\$/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Use PDO prepared statements: $pdo->prepare("SELECT * WHERE id = ?")',
    },
    {
      id: 'XSS',
      patterns: [
        /echo\s+\$(?:_GET|_POST|_REQUEST)/gi,
        /print\s+\$(?:_GET|_POST)/gi,
      ],
      severity: 'BLOCKER',
      fix: 'Use htmlspecialchars() on all output',
    },
    {
      id: 'COMMAND_INJECTION',
      patterns: [/(?:exec|system|passthru|shell_exec)\s*\(.*\$/gi],
      severity: 'BLOCKER',
      fix: 'Use escapeshellarg() and escapeshellcmd()',
    },
    {
      id: 'FILE_INCLUSION',
      patterns: [/(?:include|require)(?:_once)?\s*\(.*\$/gi],
      severity: 'BLOCKER',
      fix: 'Never use user input in include/require paths',
    },
  ],
};

// typescript inherits javascript
LANGUAGE_SECURITY.typescript = LANGUAGE_SECURITY.javascript;

// ─────────────────────────────────────────────────────────
// PERFORMANCE PATTERNS
// ─────────────────────────────────────────────────────────

const PERFORMANCE_CHECKS = [
  {
    id: 'N_PLUS_1',
    pattern: /for\s*\(.*\)\s*\{[^}]*await\s+/gs,
    severity: 'WARNING',
    fix: 'Use batch query instead of query-per-iteration',
  },
  {
    id: 'UNBOUNDED_QUERY',
    pattern: /SELECT\s+\*?\s+FROM\s+\w+(?!.*LIMIT)/gi,
    severity: 'WARNING',
    fix: 'Add LIMIT to prevent loading entire table',
  },
  {
    id: 'SYNC_IN_ASYNC',
    pattern: /(?:readFileSync|writeFileSync|execSync).*(?:async|await|Promise)/gs,
    severity: 'SUGGESTION',
    fix: 'Use async fs methods or worker threads',
  },
];

// ─────────────────────────────────────────────────────────
// TEST QUALITY PATTERNS
// ─────────────────────────────────────────────────────────

const TEST_QUALITY_CHECKS = [
  {
    id: 'SKIP_LEFT_IN',
    pattern: /(?:\.skip|\.only)\s*\(/g,
    severity: 'WARNING',
    fix: 'Remove .skip/.only before committing',
  },
  {
    id: 'EMPTY_TEST',
    pattern: /(?:it|test)\s*\([^)]+,\s*(?:async\s*)?\(\)\s*=>\s*\{\s*\}\)/gs,
    severity: 'WARNING',
    fix: 'Add assertions to test body',
  },
  {
    id: 'NO_ASSERTION',
    pattern: /(?:it|test)\s*\([^)]+,\s*(?:async\s*)?\(\)\s*=>\s*\{[^}]*\}\)/gs,
    severity: 'SUGGESTION',
    fix: 'Add expect/assert calls to verify behavior',
    // Only flag if no expect/assert inside the match
    validator: (match) => !/(?:expect|assert|should)/.test(match),
  },
];

// ─────────────────────────────────────────────────────────
// STEP 1: Get changed files from code-changes.md
// ─────────────────────────────────────────────────────────

function getChangedFiles(contextDir) {
  const content = readFileSafe(path.join(contextDir, 'code-changes.md'));
  if (!content) return [];

  const files = [];
  const rowPattern = /\|\s*`?([^|`]+\.\w{1,5})`?\s*\|\s*(CREATE|MODIFY|DELETE|READ)\s*\|/gi;
  let match;
  while ((match = rowPattern.exec(content)) !== null) {
    const file = match[1].trim();
    const action = match[2].toUpperCase();
    if (file.toLowerCase() !== 'file' && !file.includes('---')) {
      files.push({ file, action });
    }
  }
  return files;
}

// ─────────────────────────────────────────────────────────
// STEP 1.5: Detect language
// ─────────────────────────────────────────────────────────

function detectLanguage(contextDir, changedFiles) {
  // Try conventions.json first
  const conventionsPath = path.join(contextDir, 'conventions.json');
  const conventionsContent = readFileSafe(conventionsPath);
  if (conventionsContent) {
    try {
      const conventions = JSON.parse(conventionsContent);
      if (conventions.language?.primary) {
        return conventions.language.primary.toLowerCase();
      }
    } catch { /* ignore parse errors */ }
  }

  // Fallback: detect from file extensions
  const extMap = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rb': 'ruby',
    '.cs': 'csharp',
    '.php': 'php',
    '.rs': 'rust',
  };

  const counts = {};
  for (const { file } of changedFiles) {
    const ext = path.extname(file).toLowerCase();
    const lang = extMap[ext];
    if (lang) {
      counts[lang] = (counts[lang] || 0) + 1;
    }
  }

  let maxLang = null;
  let maxCount = 0;
  for (const [lang, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      maxLang = lang;
    }
  }
  return maxLang;
}

// ─────────────────────────────────────────────────────────
// HELPERS: Line analysis
// ─────────────────────────────────────────────────────────

function isCommentLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('<!--') ||
    trimmed.startsWith('"""') ||
    trimmed.startsWith("'''")
  );
}

function isTestFile(filePath) {
  const lower = filePath.toLowerCase();
  return (
    lower.includes('test') ||
    lower.includes('spec') ||
    lower.includes('__tests__') ||
    lower.includes('_test.') ||
    lower.endsWith('.test.js') ||
    lower.endsWith('.test.ts') ||
    lower.endsWith('.spec.js') ||
    lower.endsWith('.spec.ts')
  );
}

function isMinified(content) {
  const lines = content.split('\n');
  if (lines.length === 0) return false;
  const totalLength = content.length;
  const avgLineLen = totalLength / lines.length;
  return avgLineLen > 200;
}

function isBinary(content) {
  // Check for null bytes (common in binary)
  return content.includes('\0');
}

function isEnvExample(filePath) {
  const base = path.basename(filePath).toLowerCase();
  return base === '.env.example' || base === '.env.sample' || base === '.env.template';
}

// ─────────────────────────────────────────────────────────
// STEP 2: Security scan
// ─────────────────────────────────────────────────────────

function scanPatternInFile(pattern, content, check, filePath, isTest) {
  pattern.lastIndex = 0;
  const match = pattern.exec(content);
  if (!match) return null;

  const beforeMatch = content.slice(0, match.index);
  const lineNum = (beforeMatch.match(/\n/g) || []).length + 1;
  const codeLine = content.split('\n')[lineNum - 1] || '';

  if (isCommentLine(codeLine)) return null;

  const severity = (isTest && check.severity === 'BLOCKER') ? 'WARNING' : check.severity;

  return {
    severity,
    category: check.id,
    file: filePath,
    line: lineNum,
    code: codeLine.trim().slice(0, 120),
    fix: check.fix,
  };
}

function scanFileForCheck(check, filePath, content, isTest) {
  const results = [];
  for (const pattern of check.patterns) {
    const finding = scanPatternInFile(pattern, content, check, filePath, isTest);
    if (finding) results.push(finding);
  }
  return results;
}

function securityScan(fileContents, language) {
  const findings = [];

  const checks = [...UNIVERSAL_SECURITY];
  if (language && LANGUAGE_SECURITY[language]) {
    checks.push(...LANGUAGE_SECURITY[language]);
  }

  for (const { filePath, content, isTest, isEnvEx } of fileContents) {
    for (const check of checks) {
      if (check.id === 'HARDCODED_SECRETS' && isEnvEx) continue;
      findings.push(...scanFileForCheck(check, filePath, content, isTest));
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────
// STEP 3: Performance scan
// ─────────────────────────────────────────────────────────

function performanceScan(fileContents) {
  const findings = [];

  for (const { filePath, content } of fileContents) {
    for (const check of PERFORMANCE_CHECKS) {
      const pattern = new RegExp(check.pattern.source, check.pattern.flags);
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const beforeMatch = content.slice(0, match.index);
        const lineNum = (beforeMatch.match(/\n/g) || []).length + 1;
        const lines = content.split('\n');
        const codeLine = lines[lineNum - 1] || '';

        if (isCommentLine(codeLine)) continue;

        findings.push({
          severity: check.severity,
          category: check.id,
          file: filePath,
          line: lineNum,
          code: codeLine.trim().slice(0, 120),
          fix: check.fix,
        });
        break; // one per pattern per file
      }
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────
// STEP 4: Convention comparison
// ─────────────────────────────────────────────────────────

const NAMING_PATTERNS = {
  'kebab-case': /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  'camelCase': /^[a-z][a-zA-Z0-9]*$/,
  'PascalCase': /^[A-Z][a-zA-Z0-9]*$/,
  'snake_case': /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/,
};

function checkFileNaming(fileContents, fileNaming) {
  const violations = [];
  const pattern = NAMING_PATTERNS[fileNaming];
  if (!pattern) return violations;

  for (const { filePath } of fileContents) {
    const base = path.basename(filePath, path.extname(filePath));
    if (!pattern.test(base)) {
      violations.push({
        severity: 'WARNING',
        category: 'FILE_NAMING',
        file: filePath,
        expected: fileNaming,
        actual: base,
      });
    }
  }
  return violations;
}

function conventionScan(fileContents, contextDir) {
  const violations = [];
  const conventionsPath = path.join(contextDir, 'conventions.json');
  const conventionsContent = readFileSafe(conventionsPath);
  if (!conventionsContent) {
    return { violations, note: 'Convention scanner not run — no conventions.json found' };
  }

  let conventions;
  try {
    conventions = JSON.parse(conventionsContent);
  } catch {
    return { violations, note: 'Convention scanner not run — conventions.json parse error' };
  }

  const fileNaming = conventions.naming?.files;
  if (fileNaming) {
    violations.push(...checkFileNaming(fileContents, fileNaming));
  }

  return { violations };
}

// ─────────────────────────────────────────────────────────
// STEP 5: Plan compliance
// ─────────────────────────────────────────────────────────

function extractFileList(content) {
  const files = [];
  const pattern = /\|\s*`?([^|`]+\.\w{1,5})`?\s*\|\s*(CREATE|MODIFY|DELETE)\s*\|/gi;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const file = match[1].trim();
    if (file.toLowerCase() !== 'file' && !file.includes('---')) {
      files.push(file.toLowerCase());
    }
  }
  return files;
}

function planComplianceScan(contextDir) {
  const planContent = readFileSafe(path.join(contextDir, 'implementation-plan.md'));
  const changesContent = readFileSafe(path.join(contextDir, 'code-changes.md'));

  if (!planContent || !changesContent) {
    return { steps_matched: 'N/A', gaps: [], note: 'Plan or code-changes not available' };
  }

  const plannedFiles = extractFileList(planContent);
  const actualFiles = extractFileList(changesContent);

  const gaps = [];
  const actualSet = new Set(actualFiles);
  for (const pf of plannedFiles) {
    if (!actualSet.has(pf)) {
      gaps.push({ file: pf, issue: 'Planned file not found in code-changes' });
    }
  }

  const plannedSet = new Set(plannedFiles);
  for (const af of actualFiles) {
    if (!plannedSet.has(af)) {
      gaps.push({ file: af, issue: 'Unplanned file change' });
    }
  }

  const matched = plannedFiles.filter(f => actualSet.has(f)).length;
  return {
    steps_matched: `${matched}/${plannedFiles.length}`,
    gaps,
  };
}

// ─────────────────────────────────────────────────────────
// STEP 6: Test quality checks
// ─────────────────────────────────────────────────────────

function testQualityScan(fileContents) {
  const issues = [];
  let filesChecked = 0;

  for (const { filePath, content, isTest } of fileContents) {
    if (!isTest) continue;
    filesChecked++;

    for (const check of TEST_QUALITY_CHECKS) {
      const pattern = new RegExp(check.pattern.source, check.pattern.flags);
      let match;
      while ((match = pattern.exec(content)) !== null) {
        // For NO_ASSERTION, validate the match
        if (check.validator && !check.validator(match[0])) continue;

        const beforeMatch = content.slice(0, match.index);
        const lineNum = (beforeMatch.match(/\n/g) || []).length + 1;
        const lines = content.split('\n');
        const codeLine = lines[lineNum - 1] || '';

        issues.push({
          severity: check.severity,
          category: check.id,
          file: filePath,
          line: lineNum,
          code: codeLine.trim().slice(0, 120),
          fix: check.fix,
        });
        break; // one per check per file
      }
    }
  }

  return { files_checked: filesChecked, issues };
}

// ─────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────

function readFileContents(changedFiles, repoRoot) {
  const MAX_FILE_LINES = 5000;
  const fileContents = [];

  for (const { file, action } of changedFiles) {
    if (action === 'DELETE' || action === 'READ') continue;

    const fullPath = path.join(repoRoot, file);
    const content = readFileSafe(fullPath);
    if (content === null || isBinary(content) || isMinified(content)) continue;

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
      isTest: isTestFile(file),
      isEnvEx: isEnvExample(file),
    });
  }
  return fileContents;
}

function buildReviewSummary(securityFindings, performanceFindings, conventionResult, testResult) {
  const allFindings = [
    ...securityFindings,
    ...performanceFindings,
    ...conventionResult.violations,
    ...testResult.issues,
  ];

  const blockerCount = allFindings.filter(f => f.severity === 'BLOCKER').length;
  const warningCount = allFindings.filter(f => f.severity === 'WARNING').length;
  const suggestionCount = allFindings.filter(f => f.severity === 'SUGGESTION').length;

  let verdictHint = 'APPROVED';
  if (blockerCount > 0) verdictHint = 'CHANGES_REQUIRED';
  else if (warningCount > 3) verdictHint = 'CHANGES_REQUIRED';
  else if (warningCount > 0) verdictHint = 'APPROVED_WITH_WARNINGS';

  return { blockers: blockerCount, warnings: warningCount, suggestions: suggestionCount, verdict_hint: verdictHint };
}

function deriveSecurityStatus(findings) {
  if (findings.length === 0) return 'clean';
  return findings.some(f => f.severity === 'BLOCKER') ? 'issues_found' : 'warnings';
}

function runReviewPrep(contextDir, repoRoot) {
  const changedFiles = getChangedFiles(contextDir);

  if (changedFiles.length === 0) {
    return {
      task_id: null,
      files_scanned: 0,
      security: { status: 'clean', findings: [] },
      conventions: { status: 'clean', violations: [] },
      performance: { status: 'clean', findings: [] },
      plan_compliance: { steps_matched: 'N/A', gaps: [] },
      test_quality: { files_checked: 0, issues: [] },
      summary: { blockers: 0, warnings: 0, suggestions: 0, verdict_hint: 'NOTHING_TO_REVIEW' },
    };
  }

  const taskStatusContent = readFileSafe(path.join(contextDir, 'task-status.md'));
  const taskHeaders = parseHeaders(taskStatusContent);
  const taskId = taskHeaders.task_id || taskHeaders['task id'] || null;
  const language = detectLanguage(contextDir, changedFiles);
  const fileContents = readFileContents(changedFiles, repoRoot);

  const securityFindings = securityScan(fileContents, language);
  const performanceFindings = performanceScan(fileContents);
  const conventionResult = conventionScan(fileContents, contextDir);
  const planResult = planComplianceScan(contextDir);
  const testResult = testQualityScan(fileContents);

  return {
    task_id: taskId,
    files_scanned: fileContents.length,
    language_detected: language || 'unknown',
    security: {
      status: deriveSecurityStatus(securityFindings),
      findings: securityFindings.length > 0 ? securityFindings : undefined,
    },
    conventions: {
      status: conventionResult.violations.length === 0 ? 'clean' : 'violations_found',
      violations: conventionResult.violations.length > 0 ? conventionResult.violations : undefined,
      note: conventionResult.note || undefined,
    },
    performance: {
      status: performanceFindings.length === 0 ? 'clean' : 'warnings',
      findings: performanceFindings.length > 0 ? performanceFindings : undefined,
    },
    plan_compliance: planResult,
    test_quality: testResult,
    summary: buildReviewSummary(securityFindings, performanceFindings, conventionResult, testResult),
  };
}

function main() {
  const repoRoot = findRepoRoot(process.cwd());
  const contextDirFlag = getFlag('--context-dir');
  const contextDir = contextDirFlag
    ? path.resolve(contextDirFlag)
    : path.join(repoRoot, '.github', 'context');

  const result = runReviewPrep(contextDir, repoRoot);
  output(result);
}

if (require.main === module) {
  main();
}

module.exports = {
  runReviewPrep,
  getChangedFiles,
  detectLanguage,
  securityScan,
  performanceScan,
  conventionScan,
  planComplianceScan,
  testQualityScan,
  isCommentLine,
  isTestFile,
  UNIVERSAL_SECURITY,
  LANGUAGE_SECURITY,
  PERFORMANCE_CHECKS,
};
