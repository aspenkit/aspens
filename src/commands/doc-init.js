import { resolve, join, dirname, relative } from 'path';
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, chmodSync } from 'fs';
import { fileURLToPath } from 'url';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { scanRepo } from '../lib/scanner.js';
import { buildRepoGraph } from '../lib/graph-builder.js';
import { runLLM, loadPrompt, parseFileOutput, validateSkillFiles } from '../lib/runner.js';
import { writeSkillFiles, writeTransformedFiles, extractRulesFromSkills, generateDomainPatterns, mergeSettings } from '../lib/skill-writer.js';
import { persistGraphArtifacts } from '../lib/graph-persistence.js';
import { installGitHook } from '../lib/git-hook.js';
import { CliError } from '../lib/errors.js';
import { resolveTimeout } from '../lib/timeout.js';
import { TARGETS, resolveTarget, getAllowedPaths, writeConfig, loadConfig } from '../lib/target.js';
import { detectAvailableBackends, resolveBackend } from '../lib/backend.js';
import { transformForTarget, validateTransformedFiles } from '../lib/target-transform.js';
import { findSkillFiles } from '../lib/skill-reader.js';
import { getGitRoot } from '../lib/git-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

// Read-only tools — Claude explores the repo itself
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];

// Auto-scale timeout based on repo size
function autoTimeout(scan, userTimeout) {
  const sizeDefaults = { 'small': 120, 'medium': 300, 'large': 600, 'very-large': 900 };
  const fallback = sizeDefaults[scan.size?.category] || 300;
  const { timeoutMs, envWarning } = resolveTimeout(userTimeout, fallback);
  if (envWarning) console.warn('Warning: ASPENS_TIMEOUT is not a valid number — using auto-scaled timeout.');
  return timeoutMs;
}

function makeClaudeOptions(timeoutMs, verbose, model, spinner) {
  return {
    timeout: timeoutMs,
    allowedTools: READ_ONLY_TOOLS,
    verbose,
    model: model || null,
    onActivity: verbose && spinner ? (msg) => spinner.message(pc.dim(msg)) : null,
    cwd: _repoPath,
  };
}

// Sanitize markdown for safe inlining inside triple-backtick fences
const MAX_INLINE_CHARS = 2000;
function sanitizeInline(content, maxLen = MAX_INLINE_CHARS) {
  let text = content.length > maxLen ? content.slice(0, maxLen) + '\n\n[... truncated]' : content;
  // Escape triple backticks so they don't break wrapper fences
  text = text.replace(/```/g, '` ` `');
  return text;
}

/**
 * Parse files from LLM output, with Codex fallback.
 * Codex often returns plain markdown without <file> tags.
 * When that happens, wrap the text as the primary target's instructions file.
 */
function parseLLMOutput(text, allowedPaths, expectedPath) {
  let files = parseFileOutput(text, allowedPaths);
  const exactFiles = allowedPaths?.exactFiles || [];
  const dirPrefixes = allowedPaths?.dirPrefixes || [];
  const isSingleFilePrompt =
    !!expectedPath &&
    exactFiles.length === 1 &&
    exactFiles[0] === expectedPath &&
    dirPrefixes.length === 0;

  // If no <file> tags found (common with Codex), wrap only for true single-file prompts.
  if (files.length === 0 && text.trim().length > 50 && expectedPath && isSingleFilePrompt) {
    files = [{ path: expectedPath, content: text.trim() + '\n' }];
  }
  return files;
}

// Canonical (Claude) vars for prompts — generation always uses Claude format.
// Codex output is produced by transforming canonical output.
const CANONICAL_VARS = {
  skillsDir: '.claude/skills',
  skillFilename: 'skill.md',
  instructionsFile: 'CLAUDE.md',
  configDir: '.claude',
};
const CANONICAL_ALLOWED_PATHS = getAllowedPaths([TARGETS.claude]);

// Active backend for this run (set at start of docInitCommand, used by runLLM)
let _backendId = 'claude';
let _primaryTarget = TARGETS.claude;
let _allowedPaths = null;
let _repoPath = null;
let _reuseSourceTarget = null;

// Track token usage across all calls
const tokenTracker = { promptTokens: 0, toolResultTokens: 0, output: 0, toolUses: 0, calls: 0 };

function isCodexPrimary() {
  return _primaryTarget?.id === 'codex';
}

function baseArtifactLabel() {
  return isCodexPrimary() ? 'root AGENTS.md' : 'base skill';
}

function instructionsArtifactLabel() {
  return isCodexPrimary() ? 'root AGENTS.md' : 'CLAUDE.md';
}

function trackUsage(usage, promptLength) {
  if (usage) {
    tokenTracker.promptTokens += Math.ceil((promptLength || 0) / 4);
    tokenTracker.toolResultTokens += Math.ceil((usage.tool_result_chars || 0) / 4);
    tokenTracker.output += usage.output_tokens || 0;
    tokenTracker.toolUses += usage.tool_uses || 0;
    tokenTracker.calls++;
  }
}

export async function docInitCommand(path, options) {
  const repoPath = resolve(path);
  _repoPath = repoPath;
  const verbose = !!options.verbose;
  const model = options.model || null;
  const recommended = !!options.recommended;

  // --hooks-only: skip skill generation, just install/update hooks
  if (options.hooksOnly) {
    p.intro(pc.cyan('aspens doc init --hooks-only'));
    const hooksTarget = TARGETS.claude; // hooks are Claude-only
    const skillsDir = join(repoPath, hooksTarget.skillsDir);
    if (!existsSync(skillsDir)) {
      throw new CliError(`No skills found in ${hooksTarget.skillsDir}/. Run \`aspens doc init\` first.`);
    }
    await installHooks(repoPath, options);
    p.outro(pc.green('Hooks updated'));
    return;
  }

  // Reset token tracker for this run
  const startTime = Date.now();
  tokenTracker.promptTokens = 0;
  tokenTracker.toolResultTokens = 0;
  tokenTracker.output = 0;
  tokenTracker.toolUses = 0;
  tokenTracker.calls = 0;

  // Parse --domains flag
  const extraDomains = options.domains
    ? options.domains.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
    : undefined;

  p.intro(pc.cyan('aspens doc init'));

  // --- Step 0: Detect available backends ---
  const available = detectAvailableBackends();
  if (!available.claude && !available.codex) {
    throw new CliError(
      'aspens requires either Claude CLI or Codex CLI.\n' +
      '  Install Claude CLI: https://docs.anthropic.com/claude-code\n' +
      '  Install Codex CLI: https://github.com/openai/codex'
    );
  }

  // --- Step 1: Backend selection (which AI generates) ---
  let backendResult;
  let recommendedTargetIds = null;
  if (recommended && !options.target) {
    const { config } = loadConfig(repoPath, { persist: false });
    if (config?.targets?.length) {
      recommendedTargetIds = config.targets;
    }
  }

  if (options.backend) {
    backendResult = resolveBackend({ backendFlag: options.backend, available });
  } else if (recommended && recommendedTargetIds?.length === 1) {
    backendResult = resolveBackend({ targetId: recommendedTargetIds[0], available });
  } else if (available.claude && available.codex && !recommended) {
    const backendChoice = await p.select({
      message: 'Which AI should generate the docs?',
      options: [
        { value: 'claude', label: 'Claude CLI', hint: 'uses your Anthropic subscription' },
        { value: 'codex', label: 'Codex CLI', hint: 'uses your OpenAI subscription' },
      ],
    });
    if (p.isCancel(backendChoice)) { p.cancel('Aborted'); return; }
    backendResult = resolveBackend({ backendFlag: backendChoice, available });
  } else {
    // Only one available — use it
    backendResult = resolveBackend({ available });
  }
  const { backend, warning: backendWarning } = backendResult;
  if (backendWarning) p.log.warn(backendWarning);
  _backendId = backend.id;

  // --- Step 2: Target selection (what to generate FOR) ---
  let targetIds;
  if (options.target) {
    targetIds = options.target === 'all' ? ['claude', 'codex'] : [options.target];
  } else if (recommendedTargetIds?.length) {
    targetIds = recommendedTargetIds;
  } else if (recommended) {
    targetIds = [backend.id];
  } else if (available.claude && available.codex) {
    const selected = await p.multiselect({
      message: 'Generate docs for which coding agents?',
      options: [
        { value: 'claude', label: 'Claude Code', hint: 'CLAUDE.md + .claude/skills/ + hooks' },
        { value: 'codex', label: 'Codex CLI', hint: 'AGENTS.md + .agents/skills/' },
      ],
      initialValues: [backend.id], // pre-select matching target
      required: true,
    });
    if (p.isCancel(selected)) { p.cancel('Aborted'); return; }
    targetIds = selected;
  } else {
    // Only one CLI — generate for matching target
    targetIds = [available.claude ? 'claude' : 'codex'];
  }
  const targets = targetIds.map(id => resolveTarget(id));
  const primaryTarget = targets[0];
  _primaryTarget = primaryTarget;
  _allowedPaths = null; // canonical generation uses defaults

  console.log(pc.dim(`  Target: ${targets.map(t => t.label).join(' + ')}`));
  console.log(pc.dim(`  Backend: ${backend.label}`));
  if (recommended) {
    console.log(pc.dim('  Mode: ') + 'recommended defaults');
  }
  console.log();

  // Step 1: Scan
  const scanSpinner = p.spinner();
  scanSpinner.start('Scanning repository...');
  const scan = scanRepo(repoPath, { extraDomains });

  // Build import graph
  let repoGraph = null;
  let graphSerialized = null;
  if (options.graph !== false) {
    try {
      repoGraph = await buildRepoGraph(repoPath, scan.languages);
      // Persist graph, code-map skill, and index for runtime use
      // For Codex-only target, this returns serialized data without writing files
      try {
        graphSerialized = persistGraphArtifacts(repoPath, repoGraph, { target: primaryTarget });
      } catch { /* graph persistence failed — non-fatal */ }
    } catch { /* graph building failed — continue without it */ }
  }

  scanSpinner.stop(`Scanned ${pc.bold(scan.name)} (${scan.repoType})`);

  // Show what was found
  console.log();
  if (scan.languages.length > 0) {
    console.log(pc.dim('  Languages: ') + scan.languages.join(', '));
  }
  if (scan.frameworks.length > 0) {
    console.log(pc.dim('  Frameworks: ') + scan.frameworks.join(', '));
  }
  if (scan.domains.length > 0) {
    console.log(pc.dim('  Source modules: ') + scan.domains.map(d => d.name).join(', '));
  }
  if (repoGraph) {
    console.log(pc.dim('  Import graph: ') + `${repoGraph.stats.totalFiles} files, ${repoGraph.stats.totalEdges} edges`);
  }
  const timeoutMs = autoTimeout(scan, options.timeout);
  if (scan.size) {
    console.log(pc.dim('  Size: ') + `${scan.size.sourceFiles} source files (${scan.size.category})`);
    console.log(pc.dim('  Timeout: ') + `${timeoutMs / 1000}s per call` + (model ? pc.dim(` | Model: ${model}`) : ''));
  }
  console.log();

  // Step 2: Parallel Discovery — runs immediately, no user input needed
  let discoveryFindings = null;
  let discoveredDomains = [];
  let reusedDomains = [];

  const isBaseOnly = options.mode === 'base-only';
  const isDomainsOnly = options.mode === 'chunked' && extraDomains && extraDomains.length > 0;
  // When existing docs are found, ask whether to run discovery or reuse existing domains
  const hasClaudeDocs = scan.hasClaudeConfig || scan.hasClaudeMd;
  const hasCodexDocs = scan.hasAgentsMd;
  const hasExistingDocs = hasClaudeDocs || hasCodexDocs;
  _reuseSourceTarget = chooseReuseSourceTarget(targets, hasClaudeDocs, hasCodexDocs);
  let skipDiscovery = false;
  if (hasExistingDocs && !isBaseOnly && !isDomainsOnly && options.strategy !== 'rewrite') {
    if (recommended) {
      skipDiscovery = true;
    } else {
      const existingSource = hasClaudeDocs && hasCodexDocs ? 'Claude + Codex'
        : hasClaudeDocs ? 'Claude' : 'Codex';
      const reuse = await p.confirm({
        message: `Existing ${existingSource} docs found. Skip discovery and reuse existing domains?`,
        initialValue: true,
      });
      if (p.isCancel(reuse)) { p.cancel('Aborted'); return; }
      skipDiscovery = reuse;
    }
  }
  if (repoGraph && repoGraph.stats.totalFiles > 0 && !isBaseOnly && !isDomainsOnly && !skipDiscovery) {
    console.log(pc.dim('  Running 2 discovery agents in parallel...'));
    console.log();
    const discoverSpinner = p.spinner();
    discoverSpinner.start('Discovering domains + analyzing architecture...');

    try {
      const scanSummary = buildScanSummary(scan);

      // Build targeted graph context for each agent (not the full graph)
      const domainDiscoveryContext = buildGraphContextForDiscovery(repoGraph, 'domains');
      const archDiscoveryContext = buildGraphContextForDiscovery(repoGraph, 'architecture');

      // Run both discovery agents in parallel
      const [domainsResult, archResult] = await Promise.all([
        // Agent 1: Domain discovery — needs hub files + domain clusters only
        (async () => {
          try {
            const context = `\n\n---\n\nRepository: ${repoPath}\n\n${scanSummary}\n\n${domainDiscoveryContext}`;
            const prompt = loadPrompt('discover-domains') + context;
            const { text, usage } = await runLLM(prompt, makeClaudeOptions(timeoutMs, verbose, model, null), _backendId);
            trackUsage(usage, prompt.length);
            const match = text.match(/<findings>([\s\S]*?)<\/findings>/);
            return match ? match[1].trim() : null;
          } catch { return null; }
        })(),
        // Agent 2: Architecture analysis — needs hub files + rankings + hotspots
        (async () => {
          try {
            const context = `\n\n---\n\nRepository: ${repoPath}\n\n${scanSummary}\n\n${archDiscoveryContext}`;
            const prompt = loadPrompt('discover-architecture') + context;
            const { text, usage } = await runLLM(prompt, makeClaudeOptions(timeoutMs, verbose, model, null), _backendId);
            trackUsage(usage, prompt.length);
            const match = text.match(/<findings>([\s\S]*?)<\/findings>/);
            return match ? match[1].trim() : null;
          } catch { return null; }
        })(),
      ]);

      // Merge findings
      const findingsParts = [];
      if (domainsResult) findingsParts.push(domainsResult);
      if (archResult) findingsParts.push(archResult);
      discoveryFindings = findingsParts.join('\n\n');

      discoverSpinner.stop(pc.green('Discovery complete'));

      // Parse discovered domains
      if (domainsResult) {
        const domainMatch = domainsResult.match(/## Domains\n([\s\S]*?)(?=\n## |$)/);
        if (domainMatch) {
          const domainLines = domainMatch[1].trim().split('\n').filter(l => l.startsWith('- **'));
          for (const line of domainLines) {
            const nameMatch = line.match(/\*\*([^*]+)\*\*/);
            const descMatch = line.match(/\*\*[^*]+\*\*:\s*(.+?)(?:\s*—|\s*$)/);
            if (nameMatch) {
              const name = nameMatch[1];
              const desc = descMatch ? descMatch[1].trim() : '';
              const filePaths = [...line.matchAll(/`([^`]+\.[a-z]+)`/g)].map(m => m[1]);
              discoveredDomains.push({
                name,
                description: desc,
                directories: filePaths.length > 0 ? [filePaths[0].split('/').slice(0, -1).join('/')] : [],
                files: filePaths,
              });
            }
          }
        }
      }

      // Show results
      if (archResult) {
        // Extract architecture type
        const archMatch = archResult.match(/## Architecture\n([\s\S]*?)(?=\n## |$)/);
        if (archMatch) {
          const firstLine = archMatch[1].trim().split('\n')[0].replace(/\*\*/g, '').replace(/^Type:\s*/i, '');
          if (firstLine) console.log(pc.dim('  Architecture: ') + firstLine.slice(0, 80));
        }
      }

      if (discoveredDomains.length > 0) {
        console.log(pc.dim(`  Discovered ${discoveredDomains.length} feature domains:`));
        for (const d of discoveredDomains) {
          console.log(pc.dim('    ') + pc.green(d.name) + (d.description ? pc.dim(` — ${d.description.slice(0, 120)}`) : ''));
        }
      }
    } catch {
      discoverSpinner.stop(pc.dim('Discovery skipped — using scanner domains'));
    }
    console.log();
  }

  // Use discovered domains if available, otherwise fall back to scanner domains
  if (skipDiscovery && _reuseSourceTarget) {
    reusedDomains = loadReusableDomains(repoPath, _reuseSourceTarget);
    if (reusedDomains.length > 0) {
      console.log(pc.dim(`  Reusing ${reusedDomains.length} ${_reuseSourceTarget.label} skill domains:`));
      for (const d of reusedDomains) {
        const hint = d.description || d.files?.slice(0, 2).join(', ');
        console.log(pc.dim('    ') + pc.green(d.name) + (hint ? pc.dim(` — ${hint.slice(0, 120)}`) : ''));
      }
      console.log();
    }
  }

  const effectiveDomains = discoveredDomains.length > 0
    ? discoveredDomains
    : reusedDomains.length > 0
      ? reusedDomains
      : scan.domains;

  // Step 3: Strategy for existing docs
  let existingDocsStrategy = 'fresh';
  if (options.strategy) {
    const strategyMap = { 'improve': 'improve', 'rewrite': 'rewrite', 'skip': 'skip-existing' };
    existingDocsStrategy = strategyMap[options.strategy] || options.strategy;
    if (!['improve', 'rewrite', 'skip-existing', 'fresh'].includes(existingDocsStrategy)) {
      throw new CliError(`Unknown strategy: ${options.strategy}. Use: improve, rewrite, or skip`);
    }
  } else if (recommended && hasExistingDocs) {
    existingDocsStrategy = 'improve';
  } else if ((scan.hasClaudeConfig || scan.hasClaudeMd || scan.hasAgentsMd) && !options.force && !isDomainsOnly) {
    // Detect what actually exists per-target
    const hasClaudeDocs = scan.hasClaudeConfig || scan.hasClaudeMd;
    const hasCodexDocs = scan.hasAgentsMd;
    const isCodexTarget = targetIds.includes('codex');
    const isClaudeTarget = targetIds.includes('claude');

    // Build accurate message
    let existingMsg;
    if (hasClaudeDocs && hasCodexDocs) {
      existingMsg = 'Existing Claude and Codex docs detected. How to proceed:';
    } else if (hasClaudeDocs && isCodexTarget && !hasCodexDocs) {
      existingMsg = 'Existing Claude docs detected. Reuse them to generate Codex output?';
    } else if (hasCodexDocs && isClaudeTarget && !hasClaudeDocs) {
      existingMsg = 'Existing Codex docs detected. Reuse them to generate Claude output?';
    } else if (hasClaudeDocs) {
      existingMsg = 'Existing CLAUDE.md and/or skills detected. How to proceed:';
    } else {
      existingMsg = 'Existing AGENTS.md detected. How to proceed:';
    }

    const strategyOptions = [
      { value: 'improve', label: 'Improve existing (recommended)', hint: hasClaudeDocs && isCodexTarget && !hasCodexDocs ? 'reuse Claude docs as context for Codex' : 'read current docs, update based on actual code' },
      { value: 'rewrite', label: 'Rewrite from scratch', hint: 'ignore existing, generate fresh' },
      { value: 'skip-existing', label: 'Keep existing, skip', hint: 'only generate skills for new domains' },
    ];

    const strategy = await p.select({
      message: existingMsg,
      options: strategyOptions,
    });

    if (p.isCancel(strategy)) {
      p.cancel('Aborted');
      return;
    }
    existingDocsStrategy = strategy;

    if (existingDocsStrategy === 'skip-existing') {
      p.log.info('Keeping existing docs. Will only generate skills for new domains.');
    }
  }

  // Step 4: Choose generation mode
  let mode = 'all-at-once';
  let selectedDomains = effectiveDomains;

  // --mode flag skips interactive prompt (for CI / scripted use)
  if (options.mode) {
    const modeMap = { 'all': 'all-at-once', 'chunked': 'chunked', 'base-only': 'base-only' };
    mode = modeMap[options.mode] || options.mode;
    if (!['all-at-once', 'chunked', 'base-only'].includes(mode)) {
      throw new CliError(`Unknown mode: ${options.mode}. Use: all, chunked, or base-only`);
    }
    // --domains flag filters which domains to generate (useful for retrying failed domains)
    if (extraDomains && extraDomains.length > 0 && mode === 'chunked') {
      selectedDomains = effectiveDomains.filter(d =>
        extraDomains.includes(d.name.toLowerCase())
      );
      if (selectedDomains.length === 0) {
        p.log.warn(`No matching domains found for: ${extraDomains.join(', ')}`);
        p.log.info(`Available: ${effectiveDomains.map(d => d.name).join(', ')}`);
        return;
      }
      p.log.info(`Generating ${selectedDomains.length} domain(s): ${selectedDomains.map(d => d.name).join(', ')}`);
    }
  } else if (effectiveDomains.length === 0) {
    p.log.info(`No domains detected — generating ${baseArtifactLabel()} only.`);
    mode = 'base-only';
  } else if (recommended) {
    const isLarge = scan.size && (scan.size.category === 'large' || scan.size.category === 'very-large');
    mode = isLarge || effectiveDomains.length > 6 ? 'chunked' : 'all-at-once';
    p.log.info(`Recommended mode: ${mode === 'chunked' ? 'one domain at a time' : 'all at once'}.`);
  } else {
    // Smart defaults based on repo size
    const isLarge = scan.size && (scan.size.category === 'large' || scan.size.category === 'very-large');
    const domainCount = effectiveDomains.length;

    let defaultMode = 'all-at-once';
    if (isLarge || domainCount > 6) defaultMode = 'chunked';

    // Estimate LLM calls for each mode
    const chunkedCalls = domainCount + 2; // base + N domains + instructions file
    const backendName = _backendId === 'codex' ? 'Codex' : 'Claude';

    const modeChoice = await p.select({
      message: `${domainCount} domains detected. Generate skills:`,
      initialValue: defaultMode,
      options: [
        { value: 'all-at-once', label: 'All at once', hint: isLarge ? 'may timeout on this repo — 1 call' : `faster — 1 ${backendName} call` },
        { value: 'chunked', label: 'One domain at a time', hint: `reliable — ${chunkedCalls} ${backendName} calls` },
        { value: 'pick', label: 'Pick specific domains', hint: 'choose which domains to generate' },
        { value: 'base-only', label: isCodexPrimary() ? 'Root AGENTS only' : 'Base skill only', hint: `2 ${backendName} calls` },
      ],
    });

    if (p.isCancel(modeChoice)) {
      p.cancel('Aborted');
      return;
    }
    mode = modeChoice;

    if (mode === 'pick') {
      const picked = await p.multiselect({
        message: 'Select domains:',
        options: effectiveDomains.map(d => ({
          value: d.name,
          label: d.name,
          hint: d.description || d.directories?.join(', ') || d.files?.slice(0, 2).join(', '),
        })),
        required: true,
      });

      if (p.isCancel(picked)) {
        p.cancel('Aborted');
        return;
      }
      selectedDomains = effectiveDomains.filter(d => picked.includes(d.name));
      mode = 'chunked';
    }
  }

  // Step 5: Generate skills
  let allFiles = [];
  const reuseExistingCanonical = (
    existingDocsStrategy === 'improve' &&
    _reuseSourceTarget?.id === 'claude'
  );
  if (reuseExistingCanonical) {
    p.log.info(pc.dim(`Using existing ${_reuseSourceTarget.label} docs as improvement context.`));
  }

  if (mode === 'all-at-once') {
    allFiles = await generateAllAtOnce(repoPath, scan, repoGraph, selectedDomains, timeoutMs, existingDocsStrategy, verbose, model, discoveryFindings, !!options.mode);
  } else {
    const domainsOnly = isDomainsOnly; // retrying specific domains — skip base + CLAUDE.md
    allFiles = await generateChunked(repoPath, scan, repoGraph, selectedDomains, mode === 'base-only', timeoutMs, existingDocsStrategy, verbose, model, discoveryFindings, domainsOnly);
  }

  if (allFiles.length === 0) {
    if (tokenTracker.calls > 0) {
      const backendLabel = _backendId === 'codex' ? 'Codex' : 'Claude';
      console.log(pc.dim(`  ${tokenTracker.calls} ${backendLabel} call(s) made, but no parseable output.`));
    }
    throw new CliError('No skill files generated.', { logged: true });
  }

  // Step 6: Validate generated files
  let validation = { valid: true, issues: [] };
  try {
    validation = validateSkillFiles(allFiles, repoPath);
  } catch (err) {
    p.log.warn(`Validation failed: ${err.message}`);
  }

  if (!validation.valid) {
    console.log();
    p.log.warn(`Found ${validation.issues.length} issue(s) in generated skills:`);
    for (const issue of validation.issues) {
      const icon = issue.issue === 'bad-path' ? pc.yellow('?') : pc.red('!');
      console.log(pc.dim('  ') + `${icon} ${pc.dim(issue.file)} — ${issue.detail}`);
    }

    // Filter out truncated files — they'd be useless
    const truncated = validation.issues.filter(i => i.issue === 'truncated').map(i => i.file);
    if (truncated.length > 0) {
      allFiles = allFiles.filter(f => !truncated.includes(f.path));
      p.log.warn(`Removed ${truncated.length} truncated file(s). Re-run to regenerate them.`);
    }
    console.log();
  }

  // Step 6.5: Transform canonical output for each target
  // Generation always produces Claude-canonical format (.claude/skills/, CLAUDE.md).
  // For Claude target: canonical files are the final output (no transform needed).
  // For non-Claude targets: transform canonical → target format.
  // For --target all: keep canonical + add transformed for each non-Claude target.
  const canonicalFiles = [...allFiles]; // preserve originals
  const nonClaudeTargets = targets.filter(t => t.id !== 'claude');

  if (nonClaudeTargets.length > 0) {
    for (const target of nonClaudeTargets) {
      const transformSpinner = p.spinner();
      transformSpinner.start(`Transforming output for ${target.label}...`);

      const transformed = transformForTarget(canonicalFiles, TARGETS.claude, target, {
        scanResult: scan,
        graphSerialized,
      });

      const transformValidation = validateTransformedFiles(transformed);
      if (!transformValidation.valid) {
        p.log.warn(`Transform issues for ${target.label}:`);
        for (const issue of transformValidation.issues) {
          console.log(pc.dim('  ') + pc.yellow('!') + ' ' + issue);
        }
      }

      const validTransformed = transformValidation.valid
        ? transformed
        : transformed.filter(f => validateTransformedFiles([f]).valid);

      allFiles = [...allFiles, ...validTransformed];
      transformSpinner.stop(`Transformed ${validTransformed.length} files for ${target.label}`);
    }

    // If no Claude target requested, remove the canonical Claude files from output
    if (!targets.some(t => t.id === 'claude')) {
      allFiles = allFiles.filter(f => !canonicalFiles.includes(f));
    }
  }

  // Step 7: Show what will be written
  const shouldForce = options.force || existingDocsStrategy === 'improve' || existingDocsStrategy === 'rewrite';
  console.log();
  p.log.info('Files to write:');
  for (const file of allFiles) {
    const hasIssues = validation.issues?.some(i => i.file === file.path) ?? false;
    const willOverwrite = existsSync(join(repoPath, file.path));
    const willWrite = shouldForce || !willOverwrite || hasIssues;
    const icon = hasIssues ? pc.yellow('~') : willWrite && willOverwrite ? pc.yellow('~') : willWrite ? pc.green('+') : pc.dim('-');
    console.log(pc.dim('  ') + icon + ' ' + file.path);
  }
  console.log();

  // Dry run
  if (options.dryRun) {
    p.log.info('Dry run — no files written. Preview:');
    for (const file of allFiles) {
      console.log(pc.bold(`\n--- ${file.path} ---`));
      console.log(pc.dim(file.content));
    }
    showTokenSummary(startTime);
    p.outro('Dry run complete');
    return;
  }

  // Confirm
  const proceed = await p.confirm({
    message: `Write ${allFiles.length} files to ${repoPath}?`,
    initialValue: true,
  });

  if (p.isCancel(proceed) || !proceed) {
    p.cancel('Aborted');
    return;
  }

  // Step 8: Write files
  // Split: Claude-target files use writeSkillFiles (standard paths),
  // directory-scoped files (e.g., src/billing/AGENTS.md) use writeTransformedFiles (warn-and-skip)
  const writeSpinner = p.spinner();
  writeSpinner.start('Writing files...');
  const directWriteFiles = allFiles.filter(f => !(f.path.endsWith('/AGENTS.md') && f.path !== 'AGENTS.md'));
  const dirScopedFiles = allFiles.filter(f => f.path.endsWith('/AGENTS.md') && f.path !== 'AGENTS.md');

  const results = [
    ...writeSkillFiles(repoPath, directWriteFiles, { force: shouldForce }),
    ...writeTransformedFiles(repoPath, dirScopedFiles, { force: shouldForce }),
  ];
  writeSpinner.stop('Done');

  // Summary
  console.log();
  const created = results.filter(r => r.status === 'created').length;
  const overwritten = results.filter(r => r.status === 'overwritten').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  for (const result of results) {
    const icon = result.status === 'created' ? pc.green('+')
      : result.status === 'overwritten' ? pc.yellow('~')
      : pc.dim('-');
    const status = result.status === 'skipped' ? pc.dim(` (${result.reason})`) : '';
    console.log(`  ${icon} ${result.path}${status}`);
  }

  // Step 9: Generate skill-rules.json + install hooks (unless --no-hooks)
  // Only for targets that support hooks (Claude)
  const hasHookTarget = targets.some(t => t.supportsHooks);
  if (options.hooks !== false && hasHookTarget) {
    await installHooks(repoPath, options);
  }

  // Step 10: Persist target config
  writeConfig(repoPath, { targets: targetIds, backend: backend.id });

  console.log(pc.dim('  Verification: ') + [
    `${targets.map(t => t.label).join(' + ')} configured`,
    `${effectiveDomains.length} domain${effectiveDomains.length === 1 ? '' : 's'} analyzed`,
    hasHookTarget && options.hooks !== false ? 'hooks updated where supported' : 'no hook changes',
  ].join(' | '));

  showTokenSummary(startTime);

  // Offer auto-sync git hook (works for all targets — runs `aspens doc sync` on commit)
  const gitRoot = getGitRoot(repoPath);
  if (options.hook !== false && !options.dryRun && gitRoot) {
    const hookPath = join(gitRoot, '.git', 'hooks', 'post-commit');
    const hookInstalled = existsSync(hookPath) &&
      readFileSync(hookPath, 'utf8').includes(`aspens doc-sync hook (${toPosixRelative(gitRoot, repoPath) || '.'})`);
    if (!hookInstalled) {
      console.log();
      const wantHook = await p.confirm({
        message: 'Install post-commit hook to keep docs in sync automatically?',
        initialValue: true,
      });
      if (!p.isCancel(wantHook) && wantHook) {
        installGitHook(repoPath);
      }
    }
  }

  console.log();
  p.outro(
    `${pc.green(`${created} created`)}` +
    (overwritten ? `, ${pc.yellow(`${overwritten} overwritten`)}` : '') +
    (skipped ? `, ${pc.dim(`${skipped} skipped`)}` : '')
  );
}

function showTokenSummary(startTime) {
  if (tokenTracker.calls > 0) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    const parts = [
      `${tokenTracker.calls} call(s)`,
      `~${tokenTracker.promptTokens.toLocaleString()} prompt`,
      `~${tokenTracker.toolResultTokens.toLocaleString()} tool reads`,
      `${tokenTracker.output.toLocaleString()} output`,
    ];
    if (tokenTracker.toolUses > 0) {
      parts.push(`${tokenTracker.toolUses} tool calls`);
    }
    parts.push(timeStr);
    console.log();
    console.log(pc.dim(`  ${parts.join(' | ')}`));
  }
}

// --- Hook installation ---

async function installHooks(repoPath, options) {
  const skillsDir = join(repoPath, '.claude', 'skills');
  const hooksDir = join(repoPath, '.claude', 'hooks');
  const settingsPath = join(repoPath, '.claude', 'settings.json');

  if (!existsSync(skillsDir)) {
    p.log.warn('No skills directory found — skipping hook installation.');
    return;
  }

  const hookSpinner = p.spinner();
  hookSpinner.start('Installing skill activation hooks...');

  try {
    // 9a: Generate skill-rules.json
    const rules = extractRulesFromSkills(skillsDir);
    const skillCount = Object.keys(rules.skills).length;

    if (skillCount === 0) {
      hookSpinner.stop(pc.dim('No skills found — skipping hooks'));
      return;
    }

    const rulesPath = join(skillsDir, 'skill-rules.json');

    if (!options.dryRun) {
      writeFileSync(rulesPath, JSON.stringify(rules, null, 2) + '\n');
    } else {
      p.log.info(pc.dim(`[dry-run] Would write ${rulesPath} (${skillCount} skills)`));
    }

    // 9b: Copy hook files
    if (!options.dryRun) {
      mkdirSync(hooksDir, { recursive: true });
    }

    const hookFiles = [
      { src: 'hooks/skill-activation-prompt.sh', dest: 'skill-activation-prompt.sh', chmod: true },
      { src: 'hooks/skill-activation-prompt.mjs', dest: 'skill-activation-prompt.mjs', chmod: false },
      { src: 'hooks/graph-context-prompt.sh', dest: 'graph-context-prompt.sh', chmod: true },
      { src: 'hooks/graph-context-prompt.mjs', dest: 'graph-context-prompt.mjs', chmod: false },
    ];

    for (const hf of hookFiles) {
      const srcPath = join(TEMPLATES_DIR, hf.src);
      const destPath = join(hooksDir, hf.dest);
      if (!existsSync(srcPath)) {
        p.log.warn(`Template not found: ${hf.src}`);
        continue;
      }
      if (!options.dryRun) {
        copyFileSync(srcPath, destPath);
        if (hf.chmod) {
          chmodSync(destPath, 0o755);
        }
      }
    }

    // 9c: Generate post-tool-use-tracker with domain patterns
    const trackerSrc = join(TEMPLATES_DIR, 'hooks', 'post-tool-use-tracker.sh');
    const trackerDest = join(hooksDir, 'post-tool-use-tracker.sh');
    if (existsSync(trackerSrc)) {
      let trackerContent = readFileSync(trackerSrc, 'utf8');

      // Inject generated domain patterns into detect_skill_domain()
      const domainPatterns = generateDomainPatterns(rules);
      // Replace using BEGIN/END markers (preferred), fall back to regex
      const markerRegex = /# BEGIN detect_skill_domain[\s\S]*?# END detect_skill_domain/;
      if (markerRegex.test(trackerContent)) {
        trackerContent = trackerContent.replace(markerRegex, domainPatterns.trim());
      } else {
        // Fallback for templates without markers
        const stubRegex = /detect_skill_domain\(\)\s*\{[\s\S]*?\n\}/;
        if (stubRegex.test(trackerContent)) {
          trackerContent = trackerContent.replace(stubRegex, domainPatterns.trim());
        }
      }

      if (!options.dryRun) {
        writeFileSync(trackerDest, trackerContent);
        chmodSync(trackerDest, 0o755);
      }
    }

    // 9d: Merge settings.json
    let templateSettings;
    try {
      templateSettings = createHookSettings(
        repoPath,
        JSON.parse(readFileSync(join(TEMPLATES_DIR, 'settings', 'settings.json'), 'utf8'))
      );
    } catch (err) {
      hookSpinner.stop(pc.yellow('Hook installation incomplete'));
      p.log.warn(`Could not read template settings: ${err.message}`);
      return;
    }

    let existingSettings = null;
    if (existsSync(settingsPath)) {
      try {
        existingSettings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        // Backup existing settings
        if (!options.dryRun) {
          writeFileSync(settingsPath + '.bak', JSON.stringify(existingSettings, null, 2) + '\n');
        }
      } catch {
        // Existing settings malformed — overwrite
      }
    }

    const merged = mergeSettings(existingSettings, templateSettings);

    if (!options.dryRun) {
      mkdirSync(dirname(settingsPath), { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    }

    hookSpinner.stop(pc.green(`Hooks installed (${skillCount} skills in rules)`));

    // Show what was done
    console.log();
    const items = [
      `${pc.green('+')} .claude/skills/skill-rules.json ${pc.dim(`(${skillCount} skills)`)}`,
      `${pc.green('+')} .claude/hooks/skill-activation-prompt.sh`,
      `${pc.green('+')} .claude/hooks/skill-activation-prompt.mjs`,
      `${pc.green('+')} .claude/hooks/graph-context-prompt.sh`,
      `${pc.green('+')} .claude/hooks/graph-context-prompt.mjs`,
      `${pc.green('+')} .claude/hooks/post-tool-use-tracker.sh ${pc.dim('(with domain patterns)')}`,
      `${existingSettings ? pc.yellow('~') : pc.green('+')} .claude/settings.json ${pc.dim(existingSettings ? '(merged)' : '(created)')}`,
    ];
    for (const item of items) {
      console.log(`  ${item}`);
    }
    if (existingSettings && !options.dryRun) {
      console.log(pc.dim('  Backup: .claude/settings.json.bak'));
    }
    console.log();
  } catch (err) {
    hookSpinner.stop(pc.red('Hook installation failed'));
    p.log.error(err.message);
  }
}

function createHookSettings(repoPath, templateSettings) {
  const gitRoot = getGitRoot(repoPath) || repoPath;
  const projectRelative = toPosixRelative(gitRoot, repoPath);
  const hookPrefix = projectRelative ? `$CLAUDE_PROJECT_DIR/${projectRelative}` : '$CLAUDE_PROJECT_DIR';
  const settings = JSON.parse(JSON.stringify(templateSettings));

  for (const entries of Object.values(settings.hooks || {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!Array.isArray(entry.hooks)) continue;
      for (const hook of entry.hooks) {
        if (typeof hook.command === 'string' && hook.command.startsWith('$CLAUDE_PROJECT_DIR/')) {
          hook.command = hook.command.replace('$CLAUDE_PROJECT_DIR', hookPrefix);
        }
      }
    }
  }

  return settings;
}

function toPosixRelative(from, to) {
  const rel = relative(from, to);
  if (!rel || rel === '.') return '';
  return rel.split('\\').join('/');
}

// --- Generation modes ---

function buildScanSummary(scan) {
  const cleanScan = { ...scan, path: undefined };
  return '## Scan Results\n```json\n' + JSON.stringify(cleanScan, null, 2) + '\n```';
}

function buildGraphContext(graph) {
  if (!graph) return '';

  const sections = ['## Import Graph Analysis\n'];

  // Hub files — most architecturally important
  if (graph.hubs.length > 0) {
    sections.push('### Hub Files (most depended on — read these first)\n');
    for (const hub of graph.hubs.slice(0, 10)) {
      const fileInfo = graph.files[hub.path];
      sections.push(`- \`${hub.path}\` — ${hub.fanIn} dependents, ${fileInfo?.exportCount || 0} exports, ${fileInfo?.lines || 0} lines`);
    }
    sections.push('');
  }

  // Domain clusters with coupling
  if (graph.clusters?.components?.length > 0) {
    sections.push('### Domain Clusters (files that import each other)\n');
    for (const comp of graph.clusters.components) {
      if (comp.size <= 1) continue;
      const fileList = comp.files.slice(0, 10).map(f => `\`${f}\``).join(', ');
      const more = comp.files.length > 10 ? ` +${comp.files.length - 10} more` : '';
      sections.push(`- **${comp.label}** (${comp.size} files): ${fileList}${more}`);
    }
    sections.push('');
  }

  // Coupling between domains
  if (graph.clusters?.coupling?.length > 0) {
    sections.push('### Cross-Domain Dependencies\n');
    for (const c of graph.clusters.coupling) {
      sections.push(`- ${c.from} → ${c.to} (${c.edges} imports)`);
    }
    sections.push('');
  }

  // File ranking (top files Claude should prioritize reading)
  if (graph.ranked?.length > 0) {
    sections.push('### File Priority Ranking (read in this order)\n');
    for (const file of graph.ranked.slice(0, 15)) {
      sections.push(`- \`${file.path}\` — priority ${file.priority.toFixed(1)} (${file.fanIn} dependents, ${file.exportCount} exports, ${file.lines} lines)`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Build targeted graph context for discovery agents.
 * Each agent only gets the graph sections it needs, not the full context.
 * @param {'domains'|'architecture'} mode
 */
function buildGraphContextForDiscovery(graph, mode) {
  if (!graph) return '';

  const sections = ['## Import Graph Analysis\n'];

  // Hub files — both agents need these
  if (graph.hubs.length > 0) {
    sections.push('### Hub Files (most depended on — read these first)\n');
    for (const hub of graph.hubs.slice(0, 10)) {
      const fileInfo = graph.files[hub.path];
      sections.push(`- \`${hub.path}\` — ${hub.fanIn} dependents, ${fileInfo?.exportCount || 0} exports, ${fileInfo?.lines || 0} lines`);
    }
    sections.push('');
  }

  if (mode === 'domains') {
    if (graph.clusters?.components?.length > 0) {
      sections.push('### Domain Clusters (files that import each other)\n');
      for (const comp of graph.clusters.components) {
        if (comp.size <= 1) continue;
        const fileList = comp.files.slice(0, 10).map(f => `\`${f}\``).join(', ');
        const more = comp.files.length > 10 ? ` +${comp.files.length - 10} more` : '';
        sections.push(`- **${comp.label}** (${comp.size} files): ${fileList}${more}`);
      }
      sections.push('');
    }
  }

  if (mode === 'architecture') {
    if (graph.ranked?.length > 0) {
      sections.push('### File Priority Ranking (read in this order)\n');
      for (const file of graph.ranked.slice(0, 15)) {
        sections.push(`- \`${file.path}\` — priority ${file.priority.toFixed(1)} (${file.fanIn} dependents, ${file.exportCount} exports, ${file.lines} lines)`);
      }
      sections.push('');
    }
    if (graph.hotspots && graph.hotspots.length > 0) {
      sections.push('### Hotspots (high churn)\n');
      const maxHotspots = 15;
      for (const h of graph.hotspots.slice(0, maxHotspots)) {
        sections.push(`- \`${h.path}\` — ${h.churn} changes, ${h.lines} lines`);
      }
      if (graph.hotspots.length > maxHotspots) {
        sections.push(`- ...and ${graph.hotspots.length - maxHotspots} more hotspots`);
      }
      sections.push('');
    }
  }

  return sections.join('\n');
}

/**
 * Produce a 1-line summary of the base skill instead of sending the full text.
 */
function summarizeBaseSkill(baseSkillContent, scan) {
  if (!baseSkillContent) {
    return '## Base skill reference\nBase skill not yet generated.';
  }
  const descMatch = baseSkillContent.match(/description:\s*(.+)/);
  const desc = descMatch ? descMatch[1].trim() : '';
  const tech = [
    ...(scan.languages || []),
    ...(scan.frameworks || []),
  ].filter(Boolean).join(', ');
  return `## Base skill reference\nBase skill covers: ${desc || 'tech stack, commands, conventions'}${tech ? ` [${tech}]` : ''}. See base skill for details — do not duplicate its content in domain skills.`;
}

function buildDomainGraphContext(graph, domain) {
  if (!graph) return '';

  const sections = ['## Domain Import Context\n'];

  // Find files in this domain
  const domainFiles = Object.entries(graph.files)
    .filter(([path]) => domain.directories?.some(d => path.startsWith(d)))
    .sort(([, a], [, b]) => (b.fanIn || 0) - (a.fanIn || 0));

  if (domainFiles.length === 0) return '';

  // Show each file's imports and dependents
  for (const [path, info] of domainFiles) {
    const deps = info.imports.length > 0 ? `imports: ${info.imports.map(i => `\`${i}\``).join(', ')}` : 'no imports';
    const depBy = info.importedBy.length > 0 ? `depended on by: ${info.importedBy.map(i => `\`${i}\``).join(', ')}` : '';
    sections.push(`- \`${path}\` (${info.lines} lines) — ${deps}${depBy ? '; ' + depBy : ''}`);
  }

  // External deps used by this domain
  const externalDeps = new Set(domainFiles.flatMap(([, info]) => info.externalImports || []));
  if (externalDeps.size > 0) {
    sections.push(`\nExternal dependencies: ${[...externalDeps].join(', ')}`);
  }

  return sections.join('\n');
}

function buildStrategyInstruction(strategy) {
  if (strategy === 'improve') {
    return `\n\n**IMPORTANT — Improve mode:** This repo already has existing project docs and/or skills. Read them first. Preserve ALL explicitly written instructions, conventions, gotchas, and team decisions in the existing docs — these were hand-written for a reason and must not be lost or summarized away. Update what's outdated, add what's missing, improve structure, but treat existing human-written content as authoritative.`;
  }
  if (strategy === 'skip-existing') {
    return `\n\n**IMPORTANT — Skip existing mode:** This repo already has existing project docs and/or skills. Do NOT regenerate files that already exist. Only generate skills for domains that don't have a skill file yet. Read the existing docs first to see what's already covered.`;
  }
  // 'rewrite' or 'fresh' — no special instruction
  return '';
}

function chooseReuseSourceTarget(targets, hasClaudeDocs, hasCodexDocs) {
  const wantsClaude = targets.some(t => t.id === 'claude');
  const wantsCodex = targets.some(t => t.id === 'codex');

  if (hasClaudeDocs && !hasCodexDocs) return TARGETS.claude;
  if (hasCodexDocs && !hasClaudeDocs) return TARGETS.codex;
  if (wantsCodex && !wantsClaude && hasClaudeDocs) return TARGETS.claude;
  if (wantsClaude && !wantsCodex && hasCodexDocs) return TARGETS.codex;
  if (hasClaudeDocs) return TARGETS.claude;
  if (hasCodexDocs) return TARGETS.codex;
  return null;
}

function loadReusableDomains(repoPath, sourceTarget) {
  if (!sourceTarget?.skillsDir) return [];

  const rulesDomains = loadReusableDomainsFromRules(repoPath, sourceTarget);
  if (rulesDomains.length > 0) {
    return rulesDomains;
  }

  const skillsDir = join(repoPath, sourceTarget.skillsDir);
  const skillFiles = findSkillFiles(skillsDir, { skillFilename: sourceTarget.skillFilename });
  return skillFiles
    .filter(skill => !['base', 'architecture'].includes(skill.name))
    .map(skill => {
      const fallbackFiles = extractKeyFilePatterns(skill.content);
      const files = (skill.activationPatterns && skill.activationPatterns.length > 0)
        ? skill.activationPatterns
        : fallbackFiles;

      return {
        name: skill.frontmatter?.name || skill.name,
        description: skill.frontmatter?.description || '',
        directories: [...new Set(
          files
            .filter(file => file.includes('/'))
            .map(file => file.split('/').slice(0, -1).join('/'))
            .filter(Boolean)
        )],
        files,
      };
    })
    .filter(skill => skill.name);
}

function loadReusableDomainsFromRules(repoPath, sourceTarget) {
  const candidatePaths = [];
  if (sourceTarget?.skillsDir) {
    candidatePaths.push(join(repoPath, sourceTarget.skillsDir, 'skill-rules.json'));
  }
  if (sourceTarget?.id !== 'claude') {
    candidatePaths.push(join(repoPath, '.claude', 'skills', 'skill-rules.json'));
  }

  for (const rulesPath of candidatePaths) {
    if (!existsSync(rulesPath)) continue;

    try {
      const rules = JSON.parse(readFileSync(rulesPath, 'utf8'));
      const skills = rules?.skills || {};
      const domains = [];

      for (const [name, config] of Object.entries(skills)) {
        if (name === 'base' || config?.type === 'base') continue;

        const patterns = Array.isArray(config?.filePatterns) ? config.filePatterns.filter(Boolean) : [];
        const directories = [...new Set(
          patterns
            .filter(file => file.includes('/'))
            .map(file => file.split('/').slice(0, -1).join('/'))
            .filter(Boolean)
        )];

        domains.push({
          name,
          description: '',
          directories,
          files: patterns,
        });
      }

      if (domains.length > 0) {
        return domains;
      }
    } catch {
      // Fall through to skill-file parsing.
    }
  }

  return [];
}

function extractKeyFilePatterns(content) {
  if (!content || typeof content !== 'string') return [];
  const keyFilesMatch = content.match(/## Key Files[\s\S]*?(?=\n## |\n---|$)/);
  if (!keyFilesMatch) return [];

  const patterns = [];
  const lineRegex = /^[\s]*-\s*`([^`]+)`/gm;
  let match;
  while ((match = lineRegex.exec(keyFilesMatch[0])) !== null) {
    const pattern = match[1].trim();
    if (pattern && /[/.]/.test(pattern)) {
      patterns.push(pattern);
    }
  }

  return [...new Set(patterns)];
}

function loadTargetFiles(repoPath, sourceTarget, domains, options = {}) {
  const { includeInstructions = true, includeBase = true, includeDomains = true } = options;
  const files = [];

  if (includeInstructions && sourceTarget.instructionsFile) {
    const instructionsPath = join(repoPath, sourceTarget.instructionsFile);
    if (existsSync(instructionsPath)) {
      files.push({
        path: sourceTarget.instructionsFile,
        content: readFileSync(instructionsPath, 'utf8'),
      });
    }
  }

  if (includeBase && sourceTarget.skillsDir) {
    const basePath = join(repoPath, sourceTarget.skillsDir, 'base', sourceTarget.skillFilename);
    if (existsSync(basePath)) {
      files.push({
        path: join(sourceTarget.skillsDir, 'base', sourceTarget.skillFilename),
        content: readFileSync(basePath, 'utf8'),
      });
    }
  }

  if (includeDomains && sourceTarget.skillsDir) {
    for (const domain of domains) {
      if (!domain?.name || domain.name.includes('..') || domain.name.startsWith('/')) continue;
      const skillPath = join(repoPath, sourceTarget.skillsDir, domain.name, sourceTarget.skillFilename);
      if (!existsSync(skillPath)) continue;
      files.push({
        path: join(sourceTarget.skillsDir, domain.name, sourceTarget.skillFilename),
        content: readFileSync(skillPath, 'utf8'),
      });
    }
  }

  return files;
}

function loadExistingDocsContext(repoPath, sourceTarget, domains, options = {}) {
  const files = loadTargetFiles(repoPath, sourceTarget, domains, options);
  const sections = [];

  for (const file of files) {
    const label = file.path === sourceTarget.instructionsFile
      ? `Existing ${sourceTarget.instructionsFile}`
      : file.path.includes(`/base/${sourceTarget.skillFilename}`)
        ? 'Existing base skill'
        : `Existing skill: ${file.path.split('/').slice(-2, -1)[0]}`;
    sections.push(`### ${label}\n\`\`\`\n${sanitizeInline(file.content)}\n\`\`\``);
  }

  return sections.length > 0
    ? `\n\n## Existing Docs (improve these — preserve hand-written rules, update what's outdated, add what's missing)\n${sections.join('\n\n')}`
    : '';
}

async function generateAllAtOnce(repoPath, scan, repoGraph, selectedDomains, timeoutMs, strategy, verbose, model, findings, nonInteractive = false) {
  const today = new Date().toISOString().split('T')[0];
  const systemPrompt = loadPrompt('doc-init', CANONICAL_VARS);
  const scanSummary = buildScanSummary(scan);
  const graphContext = buildGraphContext(repoGraph);
  const strategyNote = buildStrategyInstruction(strategy);
  const findingsSection = findings ? `\n\n## Architecture Analysis (from discovery pass)\n\n${findings}` : '';

  // When improving, include existing content so Claude can build on it
  let existingSection = '';
  if (strategy === 'improve') {
    existingSection = loadExistingDocsContext(repoPath, _reuseSourceTarget || TARGETS.claude, selectedDomains, {
      includeInstructions: true,
      includeBase: true,
      includeDomains: true,
    });
  }

  const fullPrompt = `${systemPrompt}${strategyNote}\n\n---\n\nGenerate skills for this repository at ${repoPath}. Today's date is ${today}.\n\n${scanSummary}\n\n${graphContext}${findingsSection}${existingSection}`;

  const claudeSpinner = p.spinner();
  claudeSpinner.start('Exploring repo and generating skills...');

  try {
    const { text, usage } = await runLLM(fullPrompt, makeClaudeOptions(timeoutMs, verbose, model, claudeSpinner), _backendId);
    trackUsage(usage, fullPrompt.length);
    let files = parseLLMOutput(text, _allowedPaths, 'CLAUDE.md');
    // Enforce skip-existing: filter out instructions file if it already exists
    const instrFile = 'CLAUDE.md';
    if (strategy === 'skip-existing' && existsSync(join(repoPath, instrFile))) {
      files = files.filter(f => f.path !== instrFile);
    }
    claudeSpinner.stop(`Generated ${pc.bold(files.length)} files`);
    return files;
  } catch (err) {
    claudeSpinner.stop(pc.red('Failed'));
    p.log.error(err.message);

    const isTimeout = /timed out/i.test(err.message);

    // In non-interactive mode or on timeout, auto-fallback to chunked
    if (nonInteractive || isTimeout) {
      p.log.info('Falling back to chunked mode (one domain at a time)...');
      return generateChunked(repoPath, scan, repoGraph, selectedDomains, false, timeoutMs, strategy, verbose, model, findings);
    }

    const retry = await p.confirm({
      message: 'Try chunked mode instead? (one domain at a time)',
      initialValue: true,
    });
    if (p.isCancel(retry) || !retry) {
      throw new CliError('Generation failed.', { logged: true });
    }
    return generateChunked(repoPath, scan, repoGraph, selectedDomains, false, timeoutMs, strategy, verbose, model, findings);
  }
}

async function generateChunked(repoPath, scan, repoGraph, domains, baseOnly, timeoutMs, strategy, verbose, model, findings, domainsOnly = false) {
  const allFiles = [];
  const skippedDomains = [];
  const today = new Date().toISOString().split('T')[0];
  const scanSummary = buildScanSummary(scan);
  const graphContext = buildGraphContext(repoGraph);
  const findingsSection = findings ? `\n\n## Architecture Analysis (from discovery pass)\n\n${findings}` : '';
  const strategyNote = buildStrategyInstruction(strategy);

  // 1. Generate base skill (skip when retrying specific domains)
  let baseSkillContent = null;
  if (domainsOnly) {
    // Load existing base skill for context (used in domain prompts)
    const baseTarget = _reuseSourceTarget || TARGETS.claude;
    const existingBase = join(repoPath, baseTarget.skillsDir, 'base', baseTarget.skillFilename);
    if (existsSync(existingBase)) {
      baseSkillContent = readFileSync(existingBase, 'utf8');
    }
  } else {
  const baseSpinner = p.spinner();
  const baseLabel = baseArtifactLabel();
  baseSpinner.start(`Generating ${baseLabel}...`);

  // When improving, include existing base skill content so Claude can build on it
  let existingBaseSection = '';
  if (strategy === 'improve') {
    existingBaseSection = loadExistingDocsContext(repoPath, _reuseSourceTarget || TARGETS.claude, domains, {
      includeInstructions: false,
      includeBase: true,
      includeDomains: false,
    });
  }

  const basePrompt = loadPrompt('doc-init', CANONICAL_VARS) + strategyNote +
    `\n\n---\n\nGenerate ONLY the base skill for this repository at ${repoPath} (no domain skills, no CLAUDE.md). Today's date is ${today}.\n\n${scanSummary}\n\n${graphContext}${findingsSection}${existingBaseSection}`;

  // Generation always canonical — expected base skill path is always Claude format
  const expectedBasePath = '.claude/skills/base/skill.md';

  try {
    let { text, usage } = await runLLM(basePrompt, makeClaudeOptions(timeoutMs, verbose, model, baseSpinner), _backendId);
    trackUsage(usage, basePrompt.length);
    let files = parseLLMOutput(text, _allowedPaths, expectedBasePath);

    // Retry up to 2 times if LLM didn't produce parseable output
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt < MAX_RETRIES && files.length === 0; attempt++) {
      baseSpinner.message(`${baseLabel} missing file tags — retry ${attempt + 1}/${MAX_RETRIES}...`);
      const retryPrompt = `Your previous response did not include the required <file path="...">content</file> XML tags. I need you to output the base skill wrapped in exactly this format:\n\n<file path=".claude/skills/base/skill.md">\n---\nname: base\ndescription: ...\n---\n[skill content]\n</file>\n\nHere is your previous output — please re-wrap it correctly:\n\n${text}`;
      const retry = await runLLM(retryPrompt, makeClaudeOptions(timeoutMs, verbose, model, null), _backendId);
      trackUsage(retry.usage, retryPrompt.length);
      files = parseLLMOutput(retry.text, _allowedPaths, expectedBasePath);
      text = retry.text;
    }

    if (files.length === 0) {
      baseSpinner.stop(pc.yellow(`${baseLabel} — failed after retries`));
      p.log.warn(`Could not generate ${baseLabel}. Try again with: aspens doc init --strategy rewrite --mode base-only`);
    } else {
      allFiles.push(...files);
      baseSkillContent = files.find(f => f.path.includes('/base/'))?.content;
      baseSpinner.stop(pc.green(`${baseLabel} generated`));
    }
  } catch (err) {
    baseSpinner.stop(pc.red(`${baseLabel} failed`));
    p.log.error(err.message);
    return allFiles;
  }
  } // end if (!domainsOnly)

  // 2. Generate domain skills (in parallel batches for speed)
  if (!baseOnly) {
    const PARALLEL_LIMIT = 3; // run up to 3 domains concurrently

    for (let i = 0; i < domains.length; i += PARALLEL_LIMIT) {
      const batch = domains.slice(i, i + PARALLEL_LIMIT);
      const batchLabel = batch.map(d => d.name).join(', ');

      const batchSpinner = p.spinner();
      batchSpinner.start(`Generating skills: ${pc.bold(batchLabel)}...`);

      const promises = batch.map(async (domain) => {
        const domainInfo = `## Domain: ${domain.name}\nDirectories: ${(domain.directories || []).join(', ')}\nFiles: ${(domain.files || []).join(', ')}`;
        const domainGraph = buildDomainGraphContext(repoGraph, domain);

        // Extract domain-specific findings if available
        let domainFindings = '';
        if (findings) {
          const escapedName = domain.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const domainRegex = new RegExp(`-\\s*\\*\\*${escapedName}\\*\\*:([^\\n]*(?:\\n(?!-\\s*\\*\\*).*)*)`,'i');
          const domainMatch = findings.match(domainRegex);
          if (domainMatch) {
            domainFindings = `\n\n## Discovery Findings for ${domain.name}\n${domainMatch[0]}`;
          }
        }

        // When improving, include existing domain skill content
        let existingDomainSection = '';
        if (strategy === 'improve') {
          if (domain.name.includes('..') || domain.name.startsWith('/')) {
            return { domain: domain.name, files: [], success: false };
          }
          existingDomainSection = loadExistingDocsContext(repoPath, _reuseSourceTarget || TARGETS.claude, [domain], {
            includeInstructions: false,
            includeBase: false,
            includeDomains: true,
          });
        }

        const baseRef = summarizeBaseSkill(baseSkillContent, scan);

        const domainPrompt = loadPrompt('doc-init-domain', {
          ...CANONICAL_VARS,
          domainName: domain.name,
        }) + strategyNote + `\n\n---\n\nRepository path: ${repoPath}\nToday's date is ${today}.\n\n${baseRef}\n\n${domainInfo}\n\n${domainGraph}${domainFindings}${existingDomainSection}`;

        try {
          const { text, usage } = await runLLM(domainPrompt, makeClaudeOptions(timeoutMs, verbose, model, null), _backendId);
          trackUsage(usage, domainPrompt.length);
          const expectedDomainPath = `.claude/skills/${domain.name}/skill.md`;
          const files = parseLLMOutput(text, _allowedPaths, expectedDomainPath);
          return { domain: domain.name, files, success: true };
        } catch {
          return { domain: domain.name, files: [], success: false };
        }
      });

      const results = await Promise.all(promises);

      const succeeded = [];
      for (const result of results) {
        if (result.success && result.files.length > 0) {
          allFiles.push(...result.files);
          succeeded.push(result.domain);
        } else if (!result.success) {
          skippedDomains.push(result.domain);
        }
      }

      const statusParts = [];
      if (succeeded.length > 0) statusParts.push(pc.green(succeeded.join(', ')));
      if (results.some(r => !r.success)) statusParts.push(pc.yellow(results.filter(r => !r.success).map(r => r.domain).join(', ') + ' failed'));
      if (results.some(r => r.success && r.files.length === 0)) statusParts.push(pc.dim(results.filter(r => r.success && r.files.length === 0).map(r => r.domain).join(', ') + ' skipped'));

      batchSpinner.stop(statusParts.join(pc.dim(' | ')));
    }
  }

  // Show skipped domains so user can retry
  if (skippedDomains.length > 0) {
    console.log();
    p.log.warn(`${skippedDomains.length} domain(s) skipped: ${skippedDomains.join(', ')}`);
    console.log(pc.dim(`  Retry just these: aspens doc init --mode chunked --domains "${skippedDomains.join(',')}" ${repoPath}`));
    console.log(pc.dim(`  Or retry all: aspens doc init --mode chunked --timeout 600 ${repoPath}`));
  }

  // 3. Generate CLAUDE.md (skip when retrying specific domains, or if strategy says so)
  const claudeMdExists = existsSync(join(repoPath, 'CLAUDE.md'));
  if (allFiles.length > 0 && !domainsOnly && !(strategy === 'skip-existing' && claudeMdExists)) {
    const claudeMdSpinner = p.spinner();
    claudeMdSpinner.start(`Generating ${instructionsArtifactLabel()}...`);

    const skillSummaries = allFiles.map(f => {
      const descMatch = f.content.match(/description:\s*(.+)/);
      const desc = descMatch ? descMatch[1].trim() : '';
      return `- ${f.path} — ${desc}`;
    }).join('\n');

    // When improving, include existing CLAUDE.md so Claude can build on it
    let existingClaudeMdSection = '';
    if (strategy === 'improve' && (_reuseSourceTarget?.instructionsFile || claudeMdExists)) {
      existingClaudeMdSection = loadExistingDocsContext(repoPath, _reuseSourceTarget || TARGETS.claude, domains, {
        includeInstructions: true,
        includeBase: false,
        includeDomains: false,
      });
    }

    const claudeMdPrompt = loadPrompt('doc-init-claudemd', CANONICAL_VARS) +
      `\n\n---\n\nRepository path: ${repoPath}\n\n## Scan Results\nRepo: ${scan.name} (${scan.repoType})\nLanguages: ${scan.languages.join(', ')}\nFrameworks: ${scan.frameworks.join(', ')}\nEntry points: ${scan.entryPoints.join(', ')}\n\n## Generated Skills\n${skillSummaries}${existingClaudeMdSection}`;

    try {
      let { text, usage } = await runLLM(claudeMdPrompt, makeClaudeOptions(timeoutMs, verbose, model, claudeMdSpinner), _backendId);
      trackUsage(usage, claudeMdPrompt.length);
      let files = parseLLMOutput(text, _allowedPaths, 'CLAUDE.md');

      // Retry up to 2 times if LLM didn't produce parseable output
      const MAX_RETRIES = 2;
      for (let attempt = 0; attempt < MAX_RETRIES && files.length === 0; attempt++) {
        claudeMdSpinner.message(`${instructionsArtifactLabel()} missing file tags — retry ${attempt + 1}/${MAX_RETRIES}...`);
        const retryPrompt = `Your previous response did not include the required <file path="CLAUDE.md">content</file> XML tags. I need you to output CLAUDE.md wrapped in exactly this format:\n\n<file path="CLAUDE.md">\n# project-name\n[CLAUDE.md content]\n</file>\n\nHere is your previous output — please re-wrap it correctly:\n\n${text}`;
        const retry = await runLLM(retryPrompt, makeClaudeOptions(timeoutMs, verbose, model, null), _backendId);
        trackUsage(retry.usage, retryPrompt.length);
        files = parseLLMOutput(retry.text, _allowedPaths, 'CLAUDE.md');
        text = retry.text;
      }

      if (files.length === 0) {
        claudeMdSpinner.stop(pc.yellow(`${instructionsArtifactLabel()} — failed after retries`));
        p.log.warn(`Could not generate ${instructionsArtifactLabel()}. Try: aspens doc init --strategy rewrite --mode base-only`);
      } else {
        allFiles.push(...files);
        claudeMdSpinner.stop(pc.green(`${instructionsArtifactLabel()} generated`));
      }
    } catch (err) {
      claudeMdSpinner.stop(pc.yellow(`${instructionsArtifactLabel()} — failed, skipped`));
    }
  }

  return allFiles;
}
