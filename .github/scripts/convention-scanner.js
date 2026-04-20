#!/usr/bin/env node

/**
 * convention-scanner.js — DevAgent Convention Detection CLI
 *
 * Auto-detects project conventions by scanning source files, test files,
 * config files, and git history. Outputs structured JSON that all agents
 * can consume instead of manually reading 15-25 files.
 *
 * Usage: node .github/scripts/convention-scanner.js [--focus <area>] [--output <path>]
 *
 * Areas: all (default), code, testing, git, imports, errors
 * Output: defaults to stdout JSON; --output writes to file
 *
 * Built with zero dependencies — only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

function parseJsonSafe(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function execGitSafe(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__',
  '.next', '.nuxt', 'vendor', '.venv', 'venv', 'env', '.tox',
  'target', 'bin', 'obj', '.gradle', '.idea', '.vscode',
  '.github', '.cache', 'tmp', '.tmp',
]);

const MAX_DEPTH = 5;
const MAX_FILES = 2000; // safety cap

const LANGUAGE_SIGNATURES = {
  javascript: { extensions: ['.js', '.mjs', '.cjs'], configs: ['package.json'], weight: 1 },
  typescript: { extensions: ['.ts', '.tsx'], configs: ['tsconfig.json'], weight: 1.2 },
  python:     { extensions: ['.py'], configs: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'], weight: 1 },
  java:       { extensions: ['.java'], configs: ['pom.xml', 'build.gradle', 'build.gradle.kts'], weight: 1 },
  go:         { extensions: ['.go'], configs: ['go.mod'], weight: 1 },
  rust:       { extensions: ['.rs'], configs: ['Cargo.toml'], weight: 1 },
  ruby:       { extensions: ['.rb'], configs: ['Gemfile', 'Rakefile'], weight: 1 },
  csharp:     { extensions: ['.cs'], configs: ['*.csproj', '*.sln'], weight: 1 },
  php:        { extensions: ['.php'], configs: ['composer.json'], weight: 1 },
};

const LANGUAGE_PATTERNS = {
  javascript: {
    functions: /(?:function|const|let|var)\s+([a-zA-Z_$][\w$]*)\s*(?:=\s*(?:async\s*)?\(|=\s*(?:async\s*)?function|\()/g,
    classes: /class\s+([A-Z][\w]*)/g,
    imports: /(?:import\s+.*from\s+['"](.+?)['"]|require\s*\(\s*['"](.+?)['"]\s*\))/g,
    exports: /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+([a-zA-Z_$][\w$]*)/g,
    errors: /try\s*\{|\.catch\s*\(|catch\s*\(/g,
    variables: /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=/g,
    comments: /\/\/|\/\*|\*\//g,
  },
  typescript: null, // inherits from javascript
  python: {
    functions: /def\s+([a-zA-Z_][\w]*)\s*\(/g,
    classes: /class\s+([A-Z][\w]*)\s*[:(]/g,
    imports: /(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g,
    exports: null,
    errors: /try:|except\s+/g,
    variables: /([a-zA-Z_][\w]*)\s*(?::\s*\w+\s*)?=/g,
    comments: /#|'''|"""/g,
    decorators: /@(\w+)/g,
  },
  java: {
    functions: /(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\(/g,
    classes: /(?:public|private|protected)?\s*(?:abstract\s+)?class\s+(\w+)/g,
    imports: /import\s+(?:static\s+)?([\w.]+)/g,
    exports: null,
    errors: /try\s*\{|catch\s*\(/g,
    variables: /(?:private|protected|public|final|static|\s)+[\w<>\[\]]+\s+(\w+)\s*[=;]/g,
    comments: /\/\/|\/\*|\*\/|\*\s+@/g,
    annotations: /@(\w+)/g,
  },
  go: {
    functions: /func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/g,
    classes: /type\s+(\w+)\s+struct/g,
    imports: /"([^"]+)"/g,
    exports: null,
    errors: /if\s+err\s*!=\s*nil/g,
    variables: /(?:var|:=)\s*(\w+)/g,
    comments: /\/\/|\/\*/g,
  },
  rust: {
    functions: /fn\s+(\w+)\s*[<(]/g,
    classes: /struct\s+(\w+)/g,
    imports: /use\s+([\w:]+)/g,
    exports: /pub\s+(?:fn|struct|enum|trait)\s+(\w+)/g,
    errors: /\.unwrap\(\)|\?;|Result<|match\s+/g,
    variables: /let\s+(?:mut\s+)?(\w+)/g,
    comments: /\/\/|\/\*|\*/g,
  },
  ruby: {
    functions: /def\s+(\w+[?!]?)/g,
    classes: /class\s+(\w+)/g,
    imports: /require\s+['"]([^'"]+)['"]/g,
    exports: null,
    errors: /begin|rescue\s+/g,
    variables: /(?:@{1,2}|\$)?(\w+)\s*=/g,
    comments: /#|=begin|=end/g,
  },
  csharp: {
    functions: /(?:public|private|protected|internal|static|async|virtual|override|\s)+[\w<>\[\]]+\s+(\w+)\s*\(/g,
    classes: /(?:public|private|internal)?\s*(?:abstract\s+|sealed\s+)?class\s+(\w+)/g,
    imports: /using\s+([\w.]+)/g,
    exports: null,
    errors: /try\s*\{|catch\s*\(/g,
    variables: /(?:var|int|string|bool|double|float|decimal|\w+)\s+(\w+)\s*[=;]/g,
    comments: /\/\/|\/\*|\*\/|\/\/\//g,
  },
  php: {
    functions: /function\s+(\w+)\s*\(/g,
    classes: /class\s+(\w+)/g,
    imports: /use\s+([\w\\]+)/g,
    exports: null,
    errors: /try\s*\{|catch\s*\(/g,
    variables: /\$(\w+)\s*=/g,
    comments: /\/\/|#|\/\*|\*\//g,
  },
};

// typescript inherits from javascript
LANGUAGE_PATTERNS.typescript = LANGUAGE_PATTERNS.javascript;

const TEST_FILE_PATTERNS = {
  javascript: { files: ['*.test.js', '*.spec.js'], dirs: ['__tests__', 'test', 'tests'] },
  typescript: { files: ['*.test.ts', '*.spec.ts'], dirs: ['__tests__', 'test', 'tests'] },
  python:     { files: ['test_*.py', '*_test.py'], dirs: ['tests', 'test'] },
  java:       { files: ['*Test.java', '*Tests.java', '*IT.java'], dirs: ['src/test'] },
  go:         { files: ['*_test.go'], dirs: [] },
  rust:       { files: [], dirs: ['tests'] },
  ruby:       { files: ['*_test.rb', '*_spec.rb'], dirs: ['test', 'spec'] },
  csharp:     { files: ['*Tests.cs', '*Test.cs'], dirs: [] },
  php:        { files: ['*Test.php'], dirs: ['tests'] },
};

const TEST_FRAMEWORK_DETECTION = {
  javascript: [
    { name: 'jest', markers: ['describe(', 'it(', 'expect(', 'jest.mock'] },
    { name: 'vitest', markers: ['vi.mock', 'vi.fn', "import { describe"] },
    { name: 'mocha', markers: ['describe(', 'it(', 'chai'] },
  ],
  typescript: null, // inherits from javascript
  python: [
    { name: 'pytest', markers: ['def test_', 'pytest.fixture', '@pytest.mark'] },
    { name: 'unittest', markers: ['unittest.TestCase', 'self.assert', 'setUp(self)'] },
  ],
  java: [
    { name: 'junit5', markers: ['@Test', 'org.junit.jupiter', 'assertThat', 'Assertions.'] },
    { name: 'junit4', markers: ['@Test', 'org.junit.Test', 'Assert.'] },
    { name: 'testng', markers: ['@Test', 'org.testng'] },
  ],
  go: [
    { name: 'go-test', markers: ['func Test', 'testing.T', 't.Run('] },
    { name: 'testify', markers: ['suite.Suite', 'assert.Equal', 'require.NoError'] },
  ],
  rust: [
    { name: 'rust-test', markers: ['#[test]', '#[cfg(test)]', 'assert_eq!'] },
  ],
  ruby: [
    { name: 'rspec', markers: ['describe', 'it ', 'expect(', 'RSpec'] },
    { name: 'minitest', markers: ['Minitest::Test', 'assert_equal', 'def test_'] },
  ],
  csharp: [
    { name: 'xunit', markers: ['[Fact]', '[Theory]', 'Assert.'] },
    { name: 'nunit', markers: ['[Test]', '[TestFixture]', 'Assert.That'] },
    { name: 'mstest', markers: ['[TestMethod]', '[TestClass]', 'Assert.'] },
  ],
  php: [
    { name: 'phpunit', markers: ['PHPUnit', 'TestCase', 'function test', '@test'] },
  ],
};

// typescript inherits from javascript
TEST_FRAMEWORK_DETECTION.typescript = TEST_FRAMEWORK_DETECTION.javascript;

const CONFIG_FILES = [
  'package.json', 'tsconfig.json', 'pyproject.toml', 'go.mod', 'Cargo.toml',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json',
  '.editorconfig', '.babelrc', '.babelrc.json', 'babel.config.json',
];

const ESLINT_GLOBS = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', 'eslint.config.js', 'eslint.config.mjs'];
const PRETTIER_GLOBS = ['.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.yml', '.prettierrc.yaml', 'prettier.config.js', 'prettier.config.cjs'];
const TEST_CONFIG_GLOBS = ['jest.config.js', 'jest.config.ts', 'jest.config.json', 'vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs', '.mocharc.yml', '.mocharc.json', 'pytest.ini', 'setup.cfg', 'conftest.py'];

// ─────────────────────────────────────────────────────────
// STEP 1: File Discovery
// ─────────────────────────────────────────────────────────

function discoverFiles(repoRoot) {
  const files = [];
  const extCounts = {};

  function walk(dir, depth) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;

      const name = entry.name;

      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(name) || name.startsWith('.')) continue;
        walk(path.join(dir, name), depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (!ext) continue; // skip extensionless files

        const relPath = path.relative(repoRoot, path.join(dir, name));
        files.push({ path: relPath, ext, name });
        extCounts[ext] = (extCounts[ext] || 0) + 1;
      }
    }
  }

  walk(repoRoot, 0);

  return { files, extCounts, totalFiles: files.length };
}

// ─────────────────────────────────────────────────────────
// STEP 2: Config File Detection
// ─────────────────────────────────────────────────────────

function detectConfigFiles(repoRoot) {
  const found = {};

  // Check known config files
  for (const configName of CONFIG_FILES) {
    const configPath = path.join(repoRoot, configName);
    if (fs.existsSync(configPath)) {
      found[configName] = { exists: true, path: configName };
    }
  }

  // Check glob-pattern configs (eslint, prettier, test configs)
  for (const glob of [...ESLINT_GLOBS, ...PRETTIER_GLOBS, ...TEST_CONFIG_GLOBS]) {
    const configPath = path.join(repoRoot, glob);
    if (fs.existsSync(configPath)) {
      found[glob] = { exists: true, path: glob };
    }
  }

  return found;
}

function parsePackageJson(repoRoot) {
  const content = readFileSafe(path.join(repoRoot, 'package.json'));
  if (!content) return null;

  const pkg = parseJsonSafe(content);
  if (!pkg) return null;

  return {
    name: pkg.name || null,
    scripts: pkg.scripts || {},
    dependencies: Object.keys(pkg.dependencies || {}),
    devDependencies: Object.keys(pkg.devDependencies || {}),
    type: pkg.type || 'commonjs',
  };
}

function parseTsConfig(repoRoot) {
  const content = readFileSafe(path.join(repoRoot, 'tsconfig.json'));
  if (!content) return null;

  // Strip comments (tsconfig allows them)
  const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const tsconfig = parseJsonSafe(stripped);
  if (!tsconfig) return null;

  const co = tsconfig.compilerOptions || {};
  return {
    strict: co.strict || false,
    target: co.target || null,
    module: co.module || null,
    paths: co.paths || null,
    baseUrl: co.baseUrl || null,
  };
}

function parseCodeStyleConfigs(repoRoot, configFiles) {
  const style = {
    quotes: null,
    semicolons: null,
    indentation: null,
    trailing_commas: null,
    formatter: null,
    linter: null,
    detected_from: [],
  };

  // Check .editorconfig
  if (configFiles['.editorconfig']) {
    const content = readFileSafe(path.join(repoRoot, '.editorconfig'));
    if (content) {
      const indentStyle = content.match(/indent_style\s*=\s*(\w+)/);
      const indentSize = content.match(/indent_size\s*=\s*(\d+)/);
      if (indentStyle && indentSize) {
        style.indentation = indentStyle[1] === 'tab' ? 'tabs' : `${indentSize[1]}-spaces`;
        style.detected_from.push('.editorconfig');
      }
    }
  }

  // Check eslint configs
  for (const glob of ESLINT_GLOBS) {
    if (configFiles[glob]) {
      style.linter = 'eslint';
      style.detected_from.push(glob);

      // Try to parse JSON-based eslint configs for rules
      if (glob.endsWith('.json') || glob === '.eslintrc') {
        const content = readFileSafe(path.join(repoRoot, glob));
        if (content) {
          const eslint = parseJsonSafe(content);
          if (eslint && eslint.rules) {
            if (eslint.rules.quotes) {
              const qVal = Array.isArray(eslint.rules.quotes) ? eslint.rules.quotes[1] : eslint.rules.quotes;
              if (typeof qVal === 'string') style.quotes = qVal;
            }
            if (eslint.rules.semi) {
              const sVal = Array.isArray(eslint.rules.semi) ? eslint.rules.semi[1] : eslint.rules.semi;
              style.semicolons = sVal === 'always';
            }
            if (eslint.rules.indent) {
              const iVal = Array.isArray(eslint.rules.indent) ? eslint.rules.indent[1] : eslint.rules.indent;
              if (typeof iVal === 'number') style.indentation = `${iVal}-spaces`;
              else if (iVal === 'tab') style.indentation = 'tabs';
            }
          }
        }
      }
      break; // only need first eslint config
    }
  }

  // Check prettier configs
  for (const glob of PRETTIER_GLOBS) {
    if (configFiles[glob]) {
      style.formatter = 'prettier';
      style.detected_from.push(glob);

      // Try to parse JSON-based prettier configs
      if (glob.endsWith('.json') || glob === '.prettierrc') {
        const content = readFileSafe(path.join(repoRoot, glob));
        if (content) {
          const prettier = parseJsonSafe(content);
          if (prettier) {
            if (prettier.singleQuote !== undefined) style.quotes = prettier.singleQuote ? 'single' : 'double';
            if (prettier.semi !== undefined) style.semicolons = prettier.semi;
            if (prettier.tabWidth) style.indentation = `${prettier.tabWidth}-spaces`;
            if (prettier.useTabs) style.indentation = 'tabs';
            if (prettier.trailingComma) style.trailing_commas = prettier.trailingComma;
          }
        }
      }
      break;
    }
  }

  return style;
}

// ─────────────────────────────────────────────────────────
// STEP 2.5: Language Detection
// ─────────────────────────────────────────────────────────

function detectLanguage(extCounts, configFiles, repoRoot) {
  const scores = {};

  for (const [lang, sig] of Object.entries(LANGUAGE_SIGNATURES)) {
    let score = 0;

    // Count files by extension
    for (const ext of sig.extensions) {
      score += (extCounts[ext] || 0) * sig.weight;
    }

    // Bonus for config file presence
    for (const configName of sig.configs) {
      if (configName.includes('*')) {
        // Glob pattern — check if any matching file exists in root
        const prefix = configName.replace('*', '');
        try {
          const rootEntries = fs.readdirSync(repoRoot);
          if (rootEntries.some(e => e.endsWith(prefix) || e.includes(prefix.replace('.', '')))) {
            score += 5;
          }
        } catch { /* ignore */ }
      } else if (configFiles[configName]) {
        score += 5;
      }
    }

    if (score > 0) scores[lang] = score;
  }

  // Sort by score descending
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0 || sorted[0][1] < 3) {
    return { primary: 'unknown', secondary: [], scores };
  }

  const primary = sorted[0][0];
  const secondary = sorted
    .slice(1)
    .filter(([, s]) => s >= 3)
    .map(([lang]) => lang);

  // Detect what we detected from
  const detectedFrom = [];
  const sig = LANGUAGE_SIGNATURES[primary];
  for (const ext of sig.extensions) {
    if (extCounts[ext]) detectedFrom.push(`${extCounts[ext]} ${ext} files`);
  }
  for (const config of sig.configs) {
    if (!config.includes('*') && configFiles[config]) detectedFrom.push(config);
  }

  return { primary, secondary, scores, detected_from: detectedFrom };
}

// ─────────────────────────────────────────────────────────
// STEP 3: Source File Convention Extraction
// ─────────────────────────────────────────────────────────

function pickSourceFiles(files, language, maxFiles) {
  // Filter to primary language files only
  const sig = LANGUAGE_SIGNATURES[language];
  if (!sig) return [];

  const langFiles = files.filter(f => sig.extensions.includes(f.ext));

  // Skip index/barrel files, config files, and very small files
  const skipPatterns = /^(index|barrel|main|app|config|setup|types|constants|interfaces)\./i;
  const candidates = langFiles.filter(f => !skipPatterns.test(f.name));

  // Prefer files with reasonable size (skip tiny files)
  const withSize = candidates.map(f => {
    try {
      const stat = fs.statSync(path.join(findRepoRoot(process.cwd()), f.path));
      return { ...f, size: stat.size };
    } catch {
      return { ...f, size: 0 };
    }
  });

  // Sort by size descending (prefer larger files — more conventions to detect)
  // but cap at 50KB to avoid generated files
  const sorted = withSize
    .filter(f => f.size > 200 && f.size < 50000)
    .sort((a, b) => b.size - a.size);

  // Take top N, spread across different directories
  const selected = [];
  const dirs = new Set();

  for (const f of sorted) {
    if (selected.length >= maxFiles) break;
    const dir = path.dirname(f.path);
    if (!dirs.has(dir) || selected.length < 2) {
      selected.push(f);
      dirs.add(dir);
    }
  }

  // If we don't have enough, fill from remaining
  if (selected.length < maxFiles) {
    for (const f of sorted) {
      if (selected.length >= maxFiles) break;
      if (!selected.includes(f)) selected.push(f);
    }
  }

  return selected;
}

function extractSourceConventions(repoRoot, files, language) {
  const patterns = LANGUAGE_PATTERNS[language] || LANGUAGE_PATTERNS.javascript;
  if (!patterns) return null;

  const allFunctions = [];
  const allClasses = [];
  const allVariables = [];
  const allImports = [];
  const errorPatterns = [];
  const importPaths = [];

  for (const file of files) {
    const content = readFileSafe(path.join(repoRoot, file.path));
    if (!content) continue;

    // Extract function names
    if (patterns.functions) {
      const regex = new RegExp(patterns.functions.source, patterns.functions.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        if (name && name.length > 1 && name.length < 50) {
          allFunctions.push(name);
        }
      }
    }

    // Extract class names
    if (patterns.classes) {
      const regex = new RegExp(patterns.classes.source, patterns.classes.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        if (match[1]) allClasses.push(match[1]);
      }
    }

    // Extract variable names
    if (patterns.variables) {
      const regex = new RegExp(patterns.variables.source, patterns.variables.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        if (name && name.length > 1 && name.length < 50) {
          allVariables.push(name);
        }
      }
    }

    // Extract import paths
    if (patterns.imports) {
      const regex = new RegExp(patterns.imports.source, patterns.imports.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        const importPath = match[1] || match[2];
        if (importPath) {
          allImports.push(importPath);
          importPaths.push(importPath);
        }
      }
    }

    // Count error handling occurrences
    if (patterns.errors) {
      const regex = new RegExp(patterns.errors.source, patterns.errors.flags);
      const matches = content.match(regex);
      if (matches) {
        errorPatterns.push(...matches);
      }
    }
  }

  // Detect naming patterns
  const naming = {
    functions: {
      pattern: detectNamingPattern(allFunctions),
      evidence: allFunctions.slice(0, 5),
    },
    classes: {
      pattern: detectNamingPattern(allClasses),
      evidence: allClasses.slice(0, 5),
    },
    variables: {
      pattern: detectNamingPattern(allVariables.filter(v => v !== v.toUpperCase())),
      constants_pattern: detectNamingPattern(allVariables.filter(v => v === v.toUpperCase() && v.includes('_'))),
      evidence: allVariables.slice(0, 5),
    },
    files: {
      pattern: detectFileNamingPattern(files.map(f => path.basename(f.path, f.ext))),
      evidence: files.slice(0, 5).map(f => f.name),
    },
  };

  // Detect import conventions
  const imports = detectImportConventions(allImports, language);

  // Detect error handling
  const errorHandling = detectErrorHandling(errorPatterns, language);

  return { naming, imports, error_handling: errorHandling };
}

// ─────────────────────────────────────────────────────────
// STEP 4: Test File Convention Extraction
// ─────────────────────────────────────────────────────────

function findTestFiles(allFiles, language) {
  const testPatterns = TEST_FILE_PATTERNS[language] || TEST_FILE_PATTERNS.javascript;
  const testFiles = [];

  for (const file of allFiles) {
    const name = file.name.toLowerCase();
    const dirParts = file.path.split(path.sep);

    // Check if in a test directory
    const inTestDir = dirParts.some(p => testPatterns.dirs.includes(p.toLowerCase()));

    // Check file name patterns
    let matchesFilePattern = false;
    for (const pattern of testPatterns.files) {
      if (pattern.startsWith('*')) {
        // Suffix match: *_test.go, *.test.js
        const suffix = pattern.slice(1).toLowerCase();
        if (name.endsWith(suffix)) matchesFilePattern = true;
      } else if (pattern.endsWith('*')) {
        // Prefix match: test_*.py
        const prefix = pattern.slice(0, -1).toLowerCase();
        if (name.startsWith(prefix)) matchesFilePattern = true;
      }
    }

    if (matchesFilePattern || inTestDir) {
      testFiles.push(file);
    }
  }

  return testFiles;
}

function extractTestConventions(repoRoot, testFiles, language) {
  if (testFiles.length === 0) {
    return {
      framework: 'unknown',
      assertion_style: null,
      structure: null,
      file_naming: null,
      file_location: null,
      mocking: null,
      setup_teardown: null,
      example_file: null,
      evidence: [],
    };
  }

  // Pick 1-2 test files to analyze
  const filesToAnalyze = testFiles.slice(0, 2);
  const frameworks = TEST_FRAMEWORK_DETECTION[language] || TEST_FRAMEWORK_DETECTION.javascript || [];

  const frameworkScores = {};
  let assertionStyle = null;
  let structure = null;
  let mocking = null;
  let setupTeardown = null;
  const evidence = [];

  for (const file of filesToAnalyze) {
    const content = readFileSafe(path.join(repoRoot, file.path));
    if (!content) continue;

    // Score each framework by marker matches
    for (const fw of frameworks) {
      let score = 0;
      for (const marker of fw.markers) {
        if (content.includes(marker)) score++;
      }
      if (score > 0) {
        frameworkScores[fw.name] = (frameworkScores[fw.name] || 0) + score;
      }
    }

    // Detect assertion style
    if (content.includes('expect(') && content.includes(').toBe')) assertionStyle = 'expect().toBe()';
    else if (content.includes('expect(') && content.includes(').to.')) assertionStyle = 'expect().to (chai)';
    else if (content.includes('assert.equal')) assertionStyle = 'assert.equal()';
    else if (content.includes('assert_eq!')) assertionStyle = 'assert_eq!()';
    else if (content.includes('self.assert')) assertionStyle = 'self.assert*()';
    else if (content.includes('Assert.')) assertionStyle = 'Assert.*()';
    else if (content.includes('assertThat')) assertionStyle = 'assertThat()';

    // Detect structure
    if (content.includes('describe(') && content.includes('it(')) structure = 'describe/it';
    else if (content.includes('describe(') && content.includes('test(')) structure = 'describe/test';
    else if (content.match(/def test_/)) structure = 'def test_*';
    else if (content.match(/func Test/)) structure = 'func Test*';
    else if (content.match(/@Test/)) structure = '@Test annotation';
    else if (content.match(/\[Fact\]/)) structure = '[Fact] attribute';
    else if (content.match(/\[Test\]/)) structure = '[Test] attribute';

    // Detect mocking
    if (content.includes('jest.mock')) mocking = 'jest.mock()';
    else if (content.includes('vi.mock')) mocking = 'vi.mock()';
    else if (content.includes('unittest.mock') || content.includes('@patch')) mocking = 'unittest.mock';
    else if (content.includes('Mockito')) mocking = 'Mockito';
    else if (content.includes('gomock') || content.includes('mock.Mock')) mocking = 'gomock';

    // Detect setup/teardown
    if (content.includes('beforeEach') || content.includes('afterEach')) setupTeardown = 'beforeEach/afterEach';
    else if (content.includes('beforeAll') || content.includes('afterAll')) setupTeardown = 'beforeAll/afterAll';
    else if (content.includes('setUp(self)') || content.includes('tearDown(self)')) setupTeardown = 'setUp/tearDown';
    else if (content.includes('@Before') || content.includes('@After')) setupTeardown = '@Before/@After';
    else if (content.includes('@pytest.fixture')) setupTeardown = 'pytest fixtures';

    // Collect evidence (first few meaningful lines)
    const lines = content.split('\n');
    for (const line of lines.slice(0, 50)) {
      const trimmed = line.trim();
      if (trimmed.length > 10 && trimmed.length < 120 && (
        trimmed.includes('describe(') || trimmed.includes('it(') ||
        trimmed.includes('test(') || trimmed.includes('expect(') ||
        trimmed.includes('def test_') || trimmed.includes('func Test') ||
        trimmed.includes('@Test')
      )) {
        evidence.push(trimmed);
        if (evidence.length >= 3) break;
      }
    }
  }

  // Pick winning framework
  const sortedFrameworks = Object.entries(frameworkScores).sort((a, b) => b[1] - a[1]);
  const framework = sortedFrameworks.length > 0 ? sortedFrameworks[0][0] : 'unknown';

  // Detect file naming pattern from test files
  const testFileNames = testFiles.slice(0, 10).map(f => f.name);
  let fileNaming = null;
  if (testFileNames.some(n => n.includes('.test.'))) fileNaming = '*.test.*';
  else if (testFileNames.some(n => n.includes('.spec.'))) fileNaming = '*.spec.*';
  else if (testFileNames.some(n => n.startsWith('test_'))) fileNaming = 'test_*';
  else if (testFileNames.some(n => n.endsWith('_test.go'))) fileNaming = '*_test.go';
  else if (testFileNames.some(n => n.endsWith('Test.java'))) fileNaming = '*Test.java';
  else if (testFileNames.some(n => n.endsWith('Tests.cs'))) fileNaming = '*Tests.cs';
  else if (testFileNames.some(n => n.endsWith('_spec.rb'))) fileNaming = '*_spec.rb';

  // Detect file location (colocated vs separate directory)
  let fileLocation = 'unknown';
  const testDirs = new Set(testFiles.map(f => path.dirname(f.path).split(path.sep)[0]));
  if (testDirs.has('test') || testDirs.has('tests') || testDirs.has('spec') || testDirs.has('src')) {
    fileLocation = 'separate-directory';
  } else {
    // Check if test files are next to source files
    fileLocation = 'colocated';
  }

  return {
    framework,
    assertion_style: assertionStyle,
    structure,
    file_naming: fileNaming,
    file_location: fileLocation,
    mocking,
    setup_teardown: setupTeardown,
    example_file: testFiles[0] ? testFiles[0].path : null,
    evidence,
  };
}

// ─────────────────────────────────────────────────────────
// STEP 5: Git Convention Extraction
// ─────────────────────────────────────────────────────────

function extractGitConventions(repoRoot) {
  // Check if git is available
  const gitDir = path.join(repoRoot, '.git');
  if (!fs.existsSync(gitDir)) {
    return {
      commit_format: 'unknown',
      commit_pattern: null,
      commit_types_seen: [],
      branch_pattern: null,
      branch_examples: [],
      default_branch: null,
      evidence_commits: [],
    };
  }

  // Get last 20 commits
  const logOutput = execGitSafe('git log --oneline -20', repoRoot);
  const commits = logOutput ? logOutput.split('\n').filter(Boolean) : [];

  // Detect commit format
  const conventionalPattern = /^[a-f0-9]+\s+(feat|fix|chore|docs|test|refactor|style|perf|ci|build|revert)(\(.+?\))?:\s/;
  const jiraPattern = /^[a-f0-9]+\s+[A-Z]+-\d+\s/;

  let conventionalCount = 0;
  let jiraCount = 0;
  const typesSet = new Set();
  const evidenceCommits = [];

  for (const commit of commits) {
    const conventionalMatch = commit.match(conventionalPattern);
    if (conventionalMatch) {
      conventionalCount++;
      typesSet.add(conventionalMatch[1]);
      if (evidenceCommits.length < 5) {
        // Strip the hash prefix for cleaner evidence
        evidenceCommits.push(commit.replace(/^[a-f0-9]+\s+/, ''));
      }
    } else if (jiraPattern.test(commit)) {
      jiraCount++;
      if (evidenceCommits.length < 5) {
        evidenceCommits.push(commit.replace(/^[a-f0-9]+\s+/, ''));
      }
    } else {
      if (evidenceCommits.length < 5) {
        evidenceCommits.push(commit.replace(/^[a-f0-9]+\s+/, ''));
      }
    }
  }

  let commitFormat = 'plain';
  let commitPattern = null;
  if (conventionalCount > commits.length * 0.5) {
    commitFormat = 'conventional';
    commitPattern = 'type(scope): description';
  } else if (jiraCount > commits.length * 0.5) {
    commitFormat = 'jira-prefixed';
    commitPattern = 'PROJ-123 description';
  }

  // Get branches
  const branchOutput = execGitSafe('git branch -a', repoRoot);
  const branches = branchOutput
    ? branchOutput.split('\n')
        .map(b => b.trim().replace(/^\*\s*/, '').replace(/^remotes\/origin\//, ''))
        .filter(b => b && !b.includes('->') && !b.includes('HEAD'))
    : [];

  // Detect default branch
  let defaultBranch = null;
  if (branches.includes('main')) defaultBranch = 'main';
  else if (branches.includes('master')) defaultBranch = 'master';
  else if (branches.includes('develop')) defaultBranch = 'develop';
  else if (branches.length > 0) defaultBranch = branches[0];

  // Detect branch pattern
  const featureBranches = branches.filter(b => !['main', 'master', 'develop', 'staging', 'production'].includes(b));
  let branchPattern = null;
  const branchExamples = featureBranches.slice(0, 5);

  if (featureBranches.some(b => /^(feature|feat)\//.test(b))) branchPattern = 'feature/description';
  else if (featureBranches.some(b => /^[A-Z]+-\d+/.test(b))) branchPattern = 'PROJ-123-description';
  else if (featureBranches.length > 0) branchPattern = 'flat (no prefix convention)';

  return {
    commit_format: commitFormat,
    commit_pattern: commitPattern,
    commit_types_seen: Array.from(typesSet),
    branch_pattern: branchPattern,
    branch_examples: branchExamples,
    default_branch: defaultBranch,
    evidence_commits: evidenceCommits,
  };
}

// ─────────────────────────────────────────────────────────
// STEP 6: Naming Pattern Detection (Helper)
// ─────────────────────────────────────────────────────────

function detectNamingPattern(names) {
  if (!names || names.length === 0) return null;

  // Filter out noise (very short names, numbers, built-in keywords)
  const filtered = names.filter(n =>
    n && n.length > 1 && n.length < 50 &&
    !/^(if|else|for|while|do|switch|case|break|continue|return|var|let|const|function|class|import|export|from|async|await|try|catch|throw|new|this|self|true|false|null|undefined|None|True|False)$/.test(n)
  );

  if (filtered.length === 0) return null;

  const patterns = {
    'camelCase':        /^[a-z][a-zA-Z0-9]*$/,
    'PascalCase':       /^[A-Z][a-zA-Z0-9]*$/,
    'snake_case':       /^[a-z][a-z0-9_]*$/,
    'UPPER_SNAKE_CASE': /^[A-Z][A-Z0-9_]*$/,
    'kebab-case':       /^[a-z][a-z0-9-]*$/,
  };

  const counts = {};
  for (const [patternName, regex] of Object.entries(patterns)) {
    counts[patternName] = filtered.filter(n => regex.test(n)).length;
  }

  // Find the pattern with the highest match count
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0 || sorted[0][1] === 0) return null;

  // Require >40% match to declare a pattern (lowered for mixed codebases)
  const threshold = filtered.length * 0.4;
  if (sorted[0][1] >= threshold) {
    return sorted[0][0];
  }

  return 'mixed';
}

function detectFileNamingPattern(fileNames) {
  if (!fileNames || fileNames.length === 0) return null;

  const patterns = {
    'kebab-case': /^[a-z][a-z0-9-]*$/,
    'camelCase':  /^[a-z][a-zA-Z0-9]*$/,
    'PascalCase': /^[A-Z][a-zA-Z0-9]*$/,
    'snake_case': /^[a-z][a-z0-9_]*$/,
  };

  const counts = {};
  for (const [patternName, regex] of Object.entries(patterns)) {
    counts[patternName] = fileNames.filter(n => regex.test(n)).length;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0 || sorted[0][1] === 0) return null;

  const threshold = fileNames.length * 0.4;
  if (sorted[0][1] >= threshold) return sorted[0][0];

  return 'mixed';
}

function detectImportConventions(importPaths, language) {
  if (!importPaths || importPaths.length === 0) {
    return { style: null, path_style: null, aliases: null, order: null, evidence: [] };
  }

  // Detect ES6 vs CommonJS (for JS/TS)
  let style = null;
  if (language === 'javascript' || language === 'typescript') {
    // This is detected from the file content, not import paths
    // For now, set based on language
    style = language === 'typescript' ? 'es6' : 'mixed';
  } else if (language === 'python') {
    style = 'from/import';
  } else if (language === 'java') {
    style = 'import';
  } else if (language === 'go') {
    style = 'import';
  }

  // Detect path style (relative vs absolute/alias)
  const relativePaths = importPaths.filter(p => p.startsWith('.') || p.startsWith('..'));
  const aliasPaths = importPaths.filter(p => p.startsWith('@') || p.startsWith('~'));
  const totalLocal = relativePaths.length + aliasPaths.length;

  let pathStyle = null;
  if (totalLocal > 0) {
    if (relativePaths.length > aliasPaths.length) pathStyle = 'relative';
    else pathStyle = 'alias';
  }

  // Detect aliases
  const aliases = {};
  for (const p of aliasPaths) {
    const prefix = p.split('/')[0];
    if (prefix) aliases[prefix + '/'] = '(detected alias)';
  }

  return {
    style,
    path_style: pathStyle,
    aliases: Object.keys(aliases).length > 0 ? aliases : null,
    order: null, // Would need AST analysis for reliable order detection
    evidence: importPaths.slice(0, 5),
  };
}

function detectErrorHandling(errorPatterns, language) {
  if (!errorPatterns || errorPatterns.length === 0) {
    return { pattern: 'unknown', custom_error_classes: false, logging: null, evidence: [] };
  }

  let pattern = 'try-catch';
  if (language === 'go') pattern = 'if err != nil';
  else if (language === 'rust') pattern = 'Result/Option';
  else if (language === 'python') pattern = 'try-except';

  return {
    pattern,
    custom_error_classes: false, // Would need deeper analysis
    logging: null, // Would need deeper analysis
    evidence: [...new Set(errorPatterns)].slice(0, 3),
  };
}

// ─────────────────────────────────────────────────────────
// STEP 7: Project Detection
// ─────────────────────────────────────────────────────────

function detectProject(repoRoot, configFiles, pkg) {
  let packageManager = null;
  let monorepo = false;
  let entryPoint = null;
  let buildCommand = null;
  let testCommand = null;
  const detectedFrom = [];

  if (pkg) {
    // Node.js project
    if (fs.existsSync(path.join(repoRoot, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
    else if (fs.existsSync(path.join(repoRoot, 'yarn.lock'))) packageManager = 'yarn';
    else if (fs.existsSync(path.join(repoRoot, 'bun.lockb'))) packageManager = 'bun';
    else packageManager = 'npm';

    // Detect monorepo
    if (pkg.scripts && pkg.scripts.workspaces) monorepo = true;
    if (fs.existsSync(path.join(repoRoot, 'lerna.json'))) monorepo = true;
    if (fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))) monorepo = true;

    entryPoint = pkg.scripts && pkg.scripts.start ? 'npm start' : null;
    buildCommand = pkg.scripts && pkg.scripts.build ? `${packageManager} run build` : null;
    testCommand = pkg.scripts && pkg.scripts.test ? `${packageManager} test` : null;

    detectedFrom.push('package.json');
  }

  if (configFiles['go.mod']) {
    packageManager = 'go modules';
    testCommand = 'go test ./...';
    buildCommand = 'go build ./...';
    detectedFrom.push('go.mod');
  }

  if (configFiles['Cargo.toml']) {
    packageManager = 'cargo';
    testCommand = 'cargo test';
    buildCommand = 'cargo build';
    detectedFrom.push('Cargo.toml');
  }

  if (configFiles['pom.xml']) {
    packageManager = 'maven';
    testCommand = 'mvn test';
    buildCommand = 'mvn package';
    detectedFrom.push('pom.xml');
  }

  if (configFiles['build.gradle'] || configFiles['build.gradle.kts']) {
    packageManager = 'gradle';
    testCommand = 'gradle test';
    buildCommand = 'gradle build';
    detectedFrom.push('build.gradle');
  }

  if (configFiles['Gemfile']) {
    packageManager = 'bundler';
    testCommand = 'bundle exec rake test';
    detectedFrom.push('Gemfile');
  }

  if (configFiles['composer.json']) {
    packageManager = 'composer';
    testCommand = 'composer test';
    detectedFrom.push('composer.json');
  }

  if (configFiles['pyproject.toml'] || configFiles['setup.py'] || configFiles['requirements.txt']) {
    if (configFiles['pyproject.toml']) {
      packageManager = 'pip/poetry';
      detectedFrom.push('pyproject.toml');
    } else {
      packageManager = 'pip';
      detectedFrom.push(configFiles['setup.py'] ? 'setup.py' : 'requirements.txt');
    }
    testCommand = testCommand || 'pytest';
  }

  return {
    package_manager: packageManager,
    monorepo,
    entry_point: entryPoint,
    build_command: buildCommand,
    test_command: testCommand,
    detected_from: detectedFrom,
  };
}

// ─────────────────────────────────────────────────────────
// REUSABLE SCAN FUNCTION (used by project-context.js)
// ─────────────────────────────────────────────────────────

function runScan(repoRoot, focusArea) {
  focusArea = focusArea || 'all';
  const validAreas = ['all', 'code', 'testing', 'git', 'imports', 'errors'];
  if (!validAreas.includes(focusArea)) return null;

  const { files, extCounts, totalFiles } = discoverFiles(repoRoot);
  const configFiles = detectConfigFiles(repoRoot);
  const pkg = parsePackageJson(repoRoot);
  const tsconfig = parseTsConfig(repoRoot);
  const codeStyle = parseCodeStyleConfigs(repoRoot, configFiles);
  const language = detectLanguage(extCounts, configFiles, repoRoot);

  const result = {
    scanned_at: now(),
    repo_root: repoRoot,
    files_scanned: totalFiles,
    conventions: {
      language: {
        primary: language.primary,
        secondary: language.secondary,
        detected_from: language.detected_from || [],
      },
    },
  };

  if (['all', 'code', 'imports', 'errors'].includes(focusArea)) {
    const sourceFiles = pickSourceFiles(files, language.primary, 5);
    const sourceConventions = extractSourceConventions(repoRoot, sourceFiles, language.primary);

    if (sourceConventions) {
      if (['all', 'code'].includes(focusArea)) {
        result.conventions.naming = sourceConventions.naming;
        result.conventions.code_style = codeStyle;
      }
      if (['all', 'imports'].includes(focusArea)) {
        result.conventions.imports = sourceConventions.imports;
      }
      if (['all', 'errors'].includes(focusArea)) {
        result.conventions.error_handling = sourceConventions.error_handling;
      }
    }
  }

  if (['all', 'testing'].includes(focusArea)) {
    const testFiles = findTestFiles(files, language.primary);
    const testConventions = extractTestConventions(repoRoot, testFiles, language.primary);
    result.conventions.testing = testConventions;
  }

  if (['all', 'git'].includes(focusArea)) {
    const gitConventions = extractGitConventions(repoRoot);
    result.conventions.git = gitConventions;
  }

  if (focusArea === 'all') {
    result.conventions.project = detectProject(repoRoot, configFiles, pkg);
    if (tsconfig) {
      result.conventions.typescript_config = tsconfig;
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────
// MAIN: CLI entry point
// ─────────────────────────────────────────────────────────

function main() {
  const focusArea = getFlag('--focus') || 'all';
  const outputPath = getFlag('--output');

  const repoRoot = findRepoRoot(process.cwd());
  const result = runScan(repoRoot, focusArea);

  if (!result) {
    fail(`Invalid focus area: "${focusArea}". Valid: all, code, testing, git, imports, errors`);
  }

  if (outputPath) {
    const resolvedPath = path.resolve(outputPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, JSON.stringify(result, null, 2), 'utf-8');
    output({ written_to: resolvedPath, files_scanned: result.files_scanned, language: result.conventions.language.primary });
  } else {
    output(result);
  }
}

// Only run CLI when executed directly
if (require.main === module) {
  main();
}

module.exports = {
  runScan,
  discoverFiles,
  detectLanguage,
  detectNamingPattern,
  detectFileNamingPattern,
  findTestFiles,
  extractGitConventions,
  LANGUAGE_PATTERNS,
  LANGUAGE_SIGNATURES,
  TEST_FILE_PATTERNS,
  TEST_FRAMEWORK_DETECTION,
};
