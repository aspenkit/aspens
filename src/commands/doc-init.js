import { resolve, join } from 'path';
import { existsSync } from 'fs';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { scanRepo } from '../lib/scanner.js';
import { buildRepoGraph } from '../lib/graph-builder.js';
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

  // Step 1: Scan
  const scanSpinner = p.spinner();
  scanSpinner.start('Scanning repository...');
  const scan = scanRepo(repoPath, { extraDomains });

  // Build import graph
  let repoGraph = null;
  try {
    repoGraph = await buildRepoGraph(repoPath, scan.languages);
  } catch { /* graph building failed — continue without it */ }

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

  if (repoGraph && repoGraph.stats.totalFiles > 0 && options.mode !== 'base-only') {
    console.log(pc.dim('  Running 2 discovery agents in parallel...'));
    console.log();
    const discoverSpinner = p.spinner();
    discoverSpinner.start('Discovering domains + analyzing architecture...');

    try {
      const graphContext = buildGraphContext(repoGraph);
      let hotspotsSection = '';
      if (repoGraph.hotspots && repoGraph.hotspots.length > 0) {
        hotspotsSection = '\n\n### Hotspots (high churn)\n';
        for (const h of repoGraph.hotspots) {
          hotspotsSection += `- \`${h.path}\` — ${h.churn} changes, ${h.lines} lines\n`;
        }
      }

      const scanSummary = buildScanSummary(scan);
      const sharedContext = `\n\n---\n\nRepository: ${repoPath}\n\n${scanSummary}\n\n${graphContext}${hotspotsSection}`;

      // Run both discovery agents in parallel
      const [domainsResult, archResult] = await Promise.all([
        // Agent 1: Domain discovery (focused, fast)
        (async () => {
          try {
            const prompt = loadPrompt('discover-domains') + sharedContext;
            const { text, usage } = await runClaude(prompt, makeClaudeOptions(timeoutMs, verbose, model, null));
            trackUsage(usage, prompt.length);
            const match = text.match(/<findings>([\s\S]*?)<\/findings>/);
            return match ? match[1].trim() : null;
          } catch { return null; }
        })(),
        // Agent 2: Architecture analysis (deeper, reads hub files)
        (async () => {
          try {
            const prompt = loadPrompt('discover-architecture') + sharedContext;
            const { text, usage } = await runClaude(prompt, makeClaudeOptions(timeoutMs, verbose, model, null));
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
  const effectiveDomains = discoveredDomains.length > 0 ? discoveredDomains : scan.domains;

  // Step 3: Strategy for existing docs
  let existingDocsStrategy = 'fresh';
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

  // Step 4: Choose generation mode
  let mode = 'all-at-once';
  let selectedDomains = effectiveDomains;

  // --mode flag skips interactive prompt (for CI / scripted use)
  if (options.mode) {
    const modeMap = { 'all': 'all-at-once', 'chunked': 'chunked', 'base-only': 'base-only' };
    mode = modeMap[options.mode] || options.mode;
    if (!['all-at-once', 'chunked', 'base-only'].includes(mode)) {
      p.log.error(`Unknown mode: ${options.mode}. Use: all, chunked, or base-only`);
      process.exit(1);
    }
  } else if (effectiveDomains.length === 0) {
    p.log.info('No domains detected — generating base skill only.');
    mode = 'base-only';
  } else {
    // Smart defaults based on repo size
    const isLarge = scan.size && (scan.size.category === 'large' || scan.size.category === 'very-large');
    const domainCount = effectiveDomains.length;

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
        options: effectiveDomains.map(d => ({
          value: d.name,
          label: d.name,
          hint: d.description || d.directories?.join(', ') || d.files?.slice(0, 2).join(', '),
        })),
        required: true,
      });

      if (p.isCancel(picked)) {
        p.cancel('Aborted');
        process.exit(0);
      }
      selectedDomains = effectiveDomains.filter(d => picked.includes(d.name));
      mode = 'chunked';
    }
  }

  // Step 4: Generate (Layer 3) — write skills from findings
  let allFiles = [];

  if (mode === 'all-at-once') {
    allFiles = await generateAllAtOnce(repoPath, scan, repoGraph, selectedDomains, timeoutMs, existingDocsStrategy, verbose, model, discoveryFindings);
  } else {
    allFiles = await generateChunked(repoPath, scan, repoGraph, selectedDomains, mode === 'base-only', timeoutMs, existingDocsStrategy, verbose, model, discoveryFindings);
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

  showTokenSummary(startTime);

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
  if (graph.ranked.length > 0) {
    sections.push('### File Priority Ranking (read in this order)\n');
    for (const file of graph.ranked.slice(0, 15)) {
      sections.push(`- \`${file.path}\` — priority ${file.priority.toFixed(1)} (${file.fanIn} dependents, ${file.exportCount} exports, ${file.lines} lines)`);
    }
    sections.push('');
  }

  return sections.join('\n');
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
  const externalDeps = new Set(domainFiles.flatMap(([, info]) => info.externalImports));
  if (externalDeps.size > 0) {
    sections.push(`\nExternal dependencies: ${[...externalDeps].join(', ')}`);
  }

  return sections.join('\n');
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

async function generateAllAtOnce(repoPath, scan, repoGraph, selectedDomains, timeoutMs, strategy, verbose, model, findings) {
  const today = new Date().toISOString().split('T')[0];
  const systemPrompt = loadPrompt('doc-init');
  const scanSummary = buildScanSummary(scan);
  const graphContext = buildGraphContext(repoGraph);
  const strategyNote = buildStrategyInstruction(strategy);
  const findingsSection = findings ? `\n\n## Architecture Analysis (from discovery pass)\n\n${findings}` : '';
  const fullPrompt = `${systemPrompt}${strategyNote}\n\n---\n\nGenerate skills for this repository at ${repoPath}. Today's date is ${today}.\n\n${scanSummary}\n\n${graphContext}${findingsSection}`;

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
    return generateChunked(repoPath, scan, repoGraph, selectedDomains, false, timeoutMs, strategy, verbose, model, findings);
  }
}

async function generateChunked(repoPath, scan, repoGraph, domains, baseOnly, timeoutMs, strategy, verbose, model, findings) {
  const allFiles = [];
  const skippedDomains = [];
  const today = new Date().toISOString().split('T')[0];
  const scanSummary = buildScanSummary(scan);
  const graphContext = buildGraphContext(repoGraph);
  const findingsSection = findings ? `\n\n## Architecture Analysis (from discovery pass)\n\n${findings}` : '';

  // 1. Generate base skill
  const baseSpinner = p.spinner();
  baseSpinner.start('Generating base skill...');

  const strategyNote = buildStrategyInstruction(strategy);
  const basePrompt = loadPrompt('doc-init') + strategyNote +
    `\n\n---\n\nGenerate ONLY the base skill for this repository at ${repoPath} (no domain skills, no CLAUDE.md). Today's date is ${today}.\n\n${scanSummary}\n\n${graphContext}${findingsSection}`;

  let baseSkillContent = null;
  try {
    let { text, usage } = await runClaude(basePrompt, makeClaudeOptions(timeoutMs, verbose, model, baseSpinner));
    trackUsage(usage, basePrompt.length);
    let files = parseFileOutput(text);

    // Retry: if Claude didn't wrap output in <file> tags, ask it to fix the format
    if (files.length === 0) {
      baseSpinner.message('Base skill generated without file tags — retrying with format reminder...');
      const retryPrompt = `Your previous response did not include the required <file path="...">content</file> XML tags. I need you to output the base skill wrapped in exactly this format:\n\n<file path=".claude/skills/base/skill.md">\n---\nname: base\ndescription: ...\n---\n[skill content]\n</file>\n\nHere is your previous output — please re-wrap it correctly:\n\n${text}`;
      const retry = await runClaude(retryPrompt, makeClaudeOptions(timeoutMs, verbose, model, null));
      trackUsage(retry.usage, retryPrompt.length);
      files = parseFileOutput(retry.text);
    }

    allFiles.push(...files);
    baseSkillContent = files.find(f => f.path.includes('/base/'))?.content;
    baseSpinner.stop(files.length > 0 ? pc.green('Base skill generated') : pc.yellow('Base skill — no parseable output'));
  } catch (err) {
    baseSpinner.stop(pc.red('Base skill failed'));
    p.log.error(err.message);
    return allFiles;
  }

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

        const domainPrompt = loadPrompt('doc-init-domain', {
          domainName: domain.name,
        }) + strategyNote + `\n\n---\n\nRepository path: ${repoPath}\nToday's date is ${today}.\n\n## Base skill (for context)\n\`\`\`\n${baseSkillContent || 'Not available'}\n\`\`\`\n\n${domainInfo}\n\n${domainGraph}${domainFindings}`;

        try {
          const { text, usage } = await runClaude(domainPrompt, makeClaudeOptions(timeoutMs, verbose, model, null));
          trackUsage(usage, domainPrompt.length);
          const files = parseFileOutput(text);
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
      let { text, usage } = await runClaude(claudeMdPrompt, makeClaudeOptions(timeoutMs, verbose, model, claudeMdSpinner));
      trackUsage(usage, claudeMdPrompt.length);
      let files = parseFileOutput(text);

      // Retry: if Claude didn't wrap output in <file> tags, ask it to fix the format
      if (files.length === 0) {
        claudeMdSpinner.message('CLAUDE.md generated without file tags — retrying with format reminder...');
        const retryPrompt = `Your previous response did not include the required <file path="CLAUDE.md">content</file> XML tags. I need you to output CLAUDE.md wrapped in exactly this format:\n\n<file path="CLAUDE.md">\n# project-name\n[CLAUDE.md content]\n</file>\n\nHere is your previous output — please re-wrap it correctly:\n\n${text}`;
        const retry = await runClaude(retryPrompt, makeClaudeOptions(timeoutMs, verbose, model, null));
        trackUsage(retry.usage, retryPrompt.length);
        files = parseFileOutput(retry.text);
      }

      allFiles.push(...files);
      claudeMdSpinner.stop(files.length > 0 ? pc.green('CLAUDE.md generated') : pc.yellow('CLAUDE.md — could not generate'));
    } catch (err) {
      claudeMdSpinner.stop(pc.yellow('CLAUDE.md — failed, skipped'));
    }
  }

  return allFiles;
}
