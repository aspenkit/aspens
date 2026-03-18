import { resolve, join } from 'path';
import { existsSync } from 'fs';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { scanRepo } from '../lib/scanner.js';
import { runClaude, loadPrompt, parseFileOutput } from '../lib/runner.js';
import { writeSkillFiles } from '../lib/skill-writer.js';

// Read-only tools — Claude explores the repo itself
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];

// Auto-scale timeout based on repo size
function autoTimeout(scan, userTimeout) {
  if (userTimeout) {
    const parsed = parseInt(userTimeout) * 1000;
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const defaults = { 'small': 120000, 'medium': 300000, 'large': 600000, 'very-large': 900000 };
  return defaults[scan.size?.category] || 300000;
}

function makeClaudeOptions(timeoutMs, verbose, model, spinner) {
  return {
    timeout: timeoutMs,
    allowedTools: READ_ONLY_TOOLS,
    verbose,
    model: model || null,
    onActivity: verbose && spinner ? (msg) => spinner.message(pc.dim(msg)) : null,
  };
}

// Track token usage across all calls
const tokenTracker = { promptTokens: 0, toolResultTokens: 0, output: 0, toolUses: 0, calls: 0 };

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
  const verbose = !!options.verbose;
  const model = options.model || null;

  // Reset token tracker for this run
  tokenTracker.promptTokens = 0;
  tokenTracker.toolResultTokens = 0;
  tokenTracker.output = 0;
  tokenTracker.toolUses = 0;
  tokenTracker.calls = 0;

  p.intro(pc.cyan('aspens doc init'));

  // Step 1: Scan
  const scanSpinner = p.spinner();
  scanSpinner.start('Scanning repository...');
  const scan = scanRepo(repoPath);
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
    console.log(pc.dim('  Domains: ') + scan.domains.map(d => d.name).join(', '));
  }
  const timeoutMs = autoTimeout(scan, options.timeout);
  if (scan.size) {
    console.log(pc.dim('  Size: ') + `${scan.size.sourceFiles} source files (${scan.size.category})`);
    console.log(pc.dim('  Timeout: ') + `${timeoutMs / 1000}s per call` + (model ? pc.dim(` | Model: ${model}`) : ''));
  }
  console.log();

  // Check for existing docs
  let existingDocsStrategy = 'fresh'; // default for repos with no existing docs
  if (options.strategy) {
    const strategyMap = { 'improve': 'improve', 'rewrite': 'rewrite', 'skip': 'skip-existing' };
    existingDocsStrategy = strategyMap[options.strategy] || options.strategy;
    if (!['improve', 'rewrite', 'skip-existing', 'fresh'].includes(existingDocsStrategy)) {
      p.log.error(`Unknown strategy: ${options.strategy}. Use: improve, rewrite, or skip`);
      process.exit(1);
    }
  } else if ((scan.hasClaudeConfig || scan.hasClaudeMd) && !options.force) {
    const strategy = await p.select({
      message: 'Existing CLAUDE.md and/or skills detected. How to proceed:',
      options: [
        { value: 'improve', label: 'Improve existing (recommended)', hint: 'read current docs, update based on actual code' },
        { value: 'rewrite', label: 'Rewrite from scratch', hint: 'ignore existing, generate fresh' },
        { value: 'skip-existing', label: 'Keep existing, skip', hint: 'only generate skills for new domains' },
      ],
    });

    if (p.isCancel(strategy)) {
      p.cancel('Aborted');
      process.exit(0);
    }
    existingDocsStrategy = strategy;

    if (existingDocsStrategy === 'skip-existing') {
      p.log.info('Keeping existing docs. Will only generate skills for new domains.');
    }
  }

  // Step 2: Choose generation mode
  let mode = 'all-at-once';
  let selectedDomains = scan.domains;

  // --mode flag skips interactive prompt (for CI / scripted use)
  if (options.mode) {
    const modeMap = { 'all': 'all-at-once', 'chunked': 'chunked', 'base-only': 'base-only' };
    mode = modeMap[options.mode] || options.mode;
    if (!['all-at-once', 'chunked', 'base-only'].includes(mode)) {
      p.log.error(`Unknown mode: ${options.mode}. Use: all, chunked, or base-only`);
      process.exit(1);
    }
  } else if (scan.domains.length === 0) {
    p.log.info('No domains detected — generating base skill only.');
    mode = 'base-only';
  } else {
    // Smart defaults based on repo size
    const isLarge = scan.size && (scan.size.category === 'large' || scan.size.category === 'very-large');
    const domainCount = scan.domains.length;

    let defaultMode = 'all-at-once';
    if (isLarge || domainCount > 6) defaultMode = 'chunked';

    // Estimate Claude calls for each mode
    const chunkedCalls = domainCount + 2; // base + N domains + CLAUDE.md

    const modeChoice = await p.select({
      message: `${domainCount} domains detected. Generate skills:`,
      initialValue: defaultMode,
      options: [
        { value: 'all-at-once', label: 'All at once', hint: isLarge ? 'may timeout on this repo — 1 call' : 'faster — 1 Claude call' },
        { value: 'chunked', label: 'One domain at a time', hint: `reliable — ${chunkedCalls} Claude calls` },
        { value: 'pick', label: 'Pick specific domains', hint: 'choose which domains to generate' },
        { value: 'base-only', label: 'Base skill only', hint: '2 Claude calls' },
      ],
    });

    if (p.isCancel(modeChoice)) {
      p.cancel('Aborted');
      process.exit(0);
    }
    mode = modeChoice;

    if (mode === 'pick') {
      const picked = await p.multiselect({
        message: 'Select domains:',
        options: scan.domains.map(d => ({
          value: d.name,
          label: d.name,
          hint: d.directories.join(', ') || d.files?.slice(0, 2).join(', '),
        })),
        required: true,
      });

      if (p.isCancel(picked)) {
        p.cancel('Aborted');
        process.exit(0);
      }
      selectedDomains = scan.domains.filter(d => picked.includes(d.name));
      mode = 'chunked';
    }
  }

  // Step 3: Generate
  let allFiles = [];

  if (mode === 'all-at-once') {
    allFiles = await generateAllAtOnce(repoPath, scan, timeoutMs, existingDocsStrategy, verbose, model);
  } else {
    allFiles = await generateChunked(repoPath, scan, selectedDomains, mode === 'base-only', timeoutMs, existingDocsStrategy, verbose, model);
  }

  if (allFiles.length === 0) {
    p.log.error('No skill files generated.');
    if (tokenTracker.calls > 0) {
      console.log(pc.dim(`  ${tokenTracker.calls} Claude call(s) made, but no parseable output.`));
    }
    process.exit(1);
  }

  // Step 4: Show what will be written
  console.log();
  p.log.info('Files to write:');
  for (const file of allFiles) {
    console.log(pc.dim('  ') + pc.green(file.path));
  }
  console.log();

  // Dry run
  if (options.dryRun) {
    p.log.info('Dry run — no files written. Preview:');
    for (const file of allFiles) {
      console.log(pc.bold(`\n--- ${file.path} ---`));
      console.log(pc.dim(file.content));
    }
    showTokenSummary();
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
    process.exit(0);
  }

  // Step 5: Write files
  const writeSpinner = p.spinner();
  writeSpinner.start('Writing files...');
  const results = writeSkillFiles(repoPath, allFiles, { force: options.force });
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

  showTokenSummary();

  console.log();
  p.outro(
    `${pc.green(`${created} created`)}` +
    (overwritten ? `, ${pc.yellow(`${overwritten} overwritten`)}` : '') +
    (skipped ? `, ${pc.dim(`${skipped} skipped`)}` : '')
  );
}

function showTokenSummary() {
  if (tokenTracker.calls > 0) {
    const parts = [
      `${tokenTracker.calls} call(s)`,
      `~${tokenTracker.promptTokens.toLocaleString()} prompt`,
      `~${tokenTracker.toolResultTokens.toLocaleString()} tool reads`,
      `${tokenTracker.output.toLocaleString()} output`,
    ];
    if (tokenTracker.toolUses > 0) {
      parts.push(`${tokenTracker.toolUses} tool calls`);
    }
    console.log();
    console.log(pc.dim(`  ${parts.join(' | ')}`));
  }
}

// --- Generation modes ---

function buildScanSummary(scan) {
  const cleanScan = { ...scan, path: undefined };
  return '## Scan Results\n```json\n' + JSON.stringify(cleanScan, null, 2) + '\n```';
}

function buildStrategyInstruction(strategy) {
  if (strategy === 'improve') {
    return `\n\n**IMPORTANT — Improve mode:** This repo already has existing CLAUDE.md and/or skills in .claude/skills/. Read them first. Preserve ALL explicitly written instructions, conventions, gotchas, and team decisions in the existing CLAUDE.md — these were hand-written for a reason and must not be lost or summarized away. Update what's outdated, add what's missing, improve structure, but treat existing human-written content as authoritative.`;
  }
  if (strategy === 'skip-existing') {
    return `\n\n**IMPORTANT — Skip existing mode:** This repo already has existing CLAUDE.md and/or skills. Do NOT regenerate files that already exist. Only generate skills for domains that don't have a skill file yet. Read existing .claude/skills/ to see what's already covered.`;
  }
  // 'rewrite' or 'fresh' — no special instruction
  return '';
}

async function generateAllAtOnce(repoPath, scan, timeoutMs, strategy, verbose, model) {
  const today = new Date().toISOString().split('T')[0];
  const systemPrompt = loadPrompt('doc-init');
  const scanSummary = buildScanSummary(scan);
  const strategyNote = buildStrategyInstruction(strategy);
  const fullPrompt = `${systemPrompt}${strategyNote}\n\n---\n\nGenerate skills for this repository at ${repoPath}. Today's date is ${today}.\n\n${scanSummary}`;

  const claudeSpinner = p.spinner();
  claudeSpinner.start('Exploring repo and generating skills...');

  try {
    const { text, usage } = await runClaude(fullPrompt, makeClaudeOptions(timeoutMs, verbose, model, claudeSpinner));
    trackUsage(usage, fullPrompt.length);
    let files = parseFileOutput(text);
    // Enforce skip-existing: filter out CLAUDE.md if it already exists
    if (strategy === 'skip-existing' && existsSync(join(repoPath, 'CLAUDE.md'))) {
      files = files.filter(f => f.path !== 'CLAUDE.md');
    }
    claudeSpinner.stop(`Generated ${pc.bold(files.length)} files`);
    return files;
  } catch (err) {
    claudeSpinner.stop(pc.red('Failed'));
    p.log.error(err.message);

    const retry = await p.confirm({
      message: 'Try chunked mode instead? (one domain at a time)',
      initialValue: true,
    });
    if (p.isCancel(retry) || !retry) {
      process.exit(1);
    }
    return generateChunked(repoPath, scan, scan.domains, false, timeoutMs, strategy, verbose, model);
  }
}

async function generateChunked(repoPath, scan, domains, baseOnly, timeoutMs, strategy, verbose, model) {
  const allFiles = [];
  const skippedDomains = [];
  const today = new Date().toISOString().split('T')[0];
  const scanSummary = buildScanSummary(scan);

  // 1. Generate base skill
  const baseSpinner = p.spinner();
  baseSpinner.start('Exploring repo and generating base skill...');

  const strategyNote = buildStrategyInstruction(strategy);
  const basePrompt = loadPrompt('doc-init') + strategyNote +
    `\n\n---\n\nGenerate ONLY the base skill for this repository at ${repoPath} (no domain skills, no CLAUDE.md). Today's date is ${today}.\n\n${scanSummary}`;

  let baseSkillContent = null;
  try {
    const { text, usage } = await runClaude(basePrompt, makeClaudeOptions(timeoutMs, verbose, model, baseSpinner));
    trackUsage(usage, basePrompt.length);
    const files = parseFileOutput(text);
    allFiles.push(...files);
    baseSkillContent = files.find(f => f.path.includes('/base/'))?.content;
    baseSpinner.stop(pc.green('Base skill generated'));
  } catch (err) {
    baseSpinner.stop(pc.red('Base skill failed'));
    p.log.error(err.message);
    return allFiles;
  }

  // 2. Generate each domain skill
  if (!baseOnly) {
    for (const domain of domains) {
      const domainSpinner = p.spinner();
      domainSpinner.start(`Exploring ${pc.bold(domain.name)} and generating skill...`);

      const domainInfo = `## Domain: ${domain.name}\nDirectories: ${domain.directories.join(', ')}\nFiles: ${(domain.files || []).join(', ')}`;
      const domainPrompt = loadPrompt('doc-init-domain', {
        domainName: domain.name,
      }) + strategyNote + `\n\n---\n\nRepository path: ${repoPath}\nToday's date is ${today}.\n\n## Base skill (for context)\n\`\`\`\n${baseSkillContent || 'Not available'}\n\`\`\`\n\n${domainInfo}`;

      try {
        const { text, usage } = await runClaude(domainPrompt, makeClaudeOptions(timeoutMs, verbose, model, domainSpinner));
        trackUsage(usage, domainPrompt.length);
        const files = parseFileOutput(text);
        if (files.length > 0) {
          allFiles.push(...files);
          domainSpinner.stop(pc.green(`${domain.name} skill generated`));
        } else {
          domainSpinner.stop(pc.dim(`${domain.name} — skipped (not enough substance)`));
        }
      } catch (err) {
        domainSpinner.stop(pc.yellow(`${domain.name} — timed out or failed`));
        skippedDomains.push(domain.name);
      }
    }
  }

  // Show skipped domains so user can retry
  if (skippedDomains.length > 0) {
    console.log();
    p.log.warn(`${skippedDomains.length} domain(s) skipped: ${skippedDomains.join(', ')}`);
    console.log(pc.dim('  Retry with: aspens doc init --mode chunked --timeout 600'));
    console.log(pc.dim('  Or pick just these: aspens doc init (select "Pick specific domains")'));
  }

  // 3. Generate CLAUDE.md (skip if it already exists and strategy says so)
  const claudeMdExists = existsSync(join(repoPath, 'CLAUDE.md'));
  if (allFiles.length > 0 && !(strategy === 'skip-existing' && claudeMdExists)) {
    const claudeMdSpinner = p.spinner();
    claudeMdSpinner.start('Generating CLAUDE.md...');

    const skillSummaries = allFiles.map(f => {
      const descMatch = f.content.match(/description:\s*(.+)/);
      const desc = descMatch ? descMatch[1].trim() : '';
      return `- ${f.path} — ${desc}`;
    }).join('\n');

    const claudeMdPrompt = loadPrompt('doc-init-claudemd') +
      `\n\n---\n\nRepository path: ${repoPath}\n\n## Scan Results\nRepo: ${scan.name} (${scan.repoType})\nLanguages: ${scan.languages.join(', ')}\nFrameworks: ${scan.frameworks.join(', ')}\nEntry points: ${scan.entryPoints.join(', ')}\n\n## Generated Skills\n${skillSummaries}`;

    try {
      const { text, usage } = await runClaude(claudeMdPrompt, makeClaudeOptions(timeoutMs, verbose, model, claudeMdSpinner));
      trackUsage(usage, claudeMdPrompt.length);
      const files = parseFileOutput(text);
      allFiles.push(...files);
      claudeMdSpinner.stop(pc.green('CLAUDE.md generated'));
    } catch (err) {
      claudeMdSpinner.stop(pc.yellow('CLAUDE.md — failed, skipped'));
    }
  }

  return allFiles;
}
