import { resolve, join, relative } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { runClaude, loadPrompt, parseFileOutput } from '../lib/runner.js';
import { writeSkillFiles } from '../lib/skill-writer.js';
import { CliError } from '../lib/errors.js';
import { resolveTimeout } from '../lib/timeout.js';
import { readConfig } from '../lib/target.js';

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];

export async function customizeCommand(what, options) {
  const repoPath = resolve('.');

  if (what !== 'agents') {
    console.log(`
  ${pc.red('Unknown target:')} ${what}

  Usage:
    ${pc.green('aspens customize agents')}    Inject project context into your agents
`);
    throw new CliError(`Unknown target: ${what}`, { logged: true });
  }

  // Customize is Claude-only — Codex has no agent concept
  const config = readConfig(repoPath);
  const isCodexOnly = config?.targets?.length === 1 && config.targets[0] === 'codex';
  if (isCodexOnly) {
    throw new CliError(
      '"aspens customize agents" is only available for Claude Code targets. ' +
      'This repo is configured for Codex CLI only.'
    );
  }
  const { timeoutMs, envWarning } = resolveTimeout(options.timeout, 300);
  if (envWarning) p.log.warn('ASPENS_TIMEOUT is not a valid number — using default timeout.');
  const verbose = !!options.verbose;

  p.intro(pc.cyan('aspens customize agents'));

  if (options.reset) {
    p.log.info('--reset: re-customizing all agents (applies v0.8 upgrades like skills: [base]).');
  }

  // Phase 6: pre-flight — base skill is required for full subagent context.
  const baseSkillPath = join(repoPath, '.claude', 'skills', 'base', 'skill.md');
  if (!existsSync(baseSkillPath)) {
    throw new CliError("Run 'aspens doc init' first — base skill is required for agent context.");
  }
  const baseSkillExists = true;

  // Step 1: Find agents in the repo
  const agentsDir = join(repoPath, '.claude', 'agents');
  if (!existsSync(agentsDir)) {
    throw new CliError('No .claude/agents/ found. Run aspens add agent first.');
  }

  const agents = findAgents(agentsDir, repoPath);
  if (agents.length === 0) {
    throw new CliError('No agent files found in .claude/agents/');
  }

  p.log.info(`Found ${agents.length} agent(s): ${agents.map(a => pc.yellow(a.name)).join(', ')}`);

  // Step 2: Gather project context
  const contextSpinner = p.spinner();
  contextSpinner.start('Reading project context...');

  const projectContext = gatherProjectContext(repoPath);

  if (!projectContext) {
    contextSpinner.stop(pc.yellow('No skills or CLAUDE.md found'));
    p.log.warn('Run aspens doc init first to generate skills, then customize agents.');
    return;
  }

  contextSpinner.stop('Project context loaded');

  // Step 3: Customize each agent
  const allFiles = [];
  const systemPrompt = loadPrompt('customize-agents');

  for (const agent of agents) {
    const agentSpinner = p.spinner();
    agentSpinner.start(`Customizing ${pc.bold(agent.name)}...`);

    const prompt = `${systemPrompt}\n\n---\n\n## Agent to Customize\nPath: ${agent.relativePath}\n\n\`\`\`\n${agent.content}\n\`\`\`\n\n## Project Context\n${projectContext}`;

    try {
      const { text } = await runClaude(prompt, {
        timeout: timeoutMs,
        allowedTools: READ_ONLY_TOOLS,
        verbose,
        model: options.model || null,
        onActivity: verbose ? (msg) => agentSpinner.message(pc.dim(msg)) : null,
      });

      const files = parseFileOutput(text);
      if (files.length > 0) {
        // Phase 6: inject `skills: [base]` into customized agent frontmatter
        // when (a) base skill exists on disk, AND (b) the agent doesn't
        // already declare a `skills:` line OR --reset was passed.
        const injected = files.map(file => ({
          ...file,
          content: maybeInjectBaseSkill(file.content, baseSkillExists, !!options.reset),
        }));
        allFiles.push(...injected);
        agentSpinner.stop(pc.green(`${agent.name} customized`));
      } else {
        agentSpinner.stop(pc.dim(`${agent.name} — no changes needed`));
      }
    } catch (err) {
      agentSpinner.stop(pc.yellow(`${agent.name} — failed: ${err.message}`));
    }
  }

  if (allFiles.length === 0) {
    p.outro('No agents needed customization');
    return;
  }

  // Step 4: Show and write
  console.log();
  p.log.info(`${allFiles.length} agent(s) customized:`);
  for (const file of allFiles) {
    console.log(pc.dim('  ') + pc.yellow('~') + ' ' + file.path);
  }
  console.log();

  if (options.dryRun) {
    p.log.info('Dry run — no files written. Preview:');
    for (const file of allFiles) {
      console.log(pc.bold(`\n--- ${file.path} ---`));
      console.log(pc.dim(file.content));
    }
    p.outro('Dry run complete');
    return;
  }

  const proceed = await p.confirm({
    message: `Update ${allFiles.length} agent(s)?`,
    initialValue: true,
  });

  if (p.isCancel(proceed) || !proceed) {
    p.cancel('Aborted');
    return;
  }

  // Allow .claude/agents/ paths in sanitizePath
  const results = writeSkillFiles(repoPath, allFiles, { force: true });

  console.log();
  for (const result of results) {
    console.log(`  ${pc.yellow('~')} ${result.path}`);
  }

  console.log();
  p.outro(`${results.length} agent(s) customized for this project`);
}

// --- Helpers ---

/**
 * Inject `skills: [base]` into an agent's YAML frontmatter when the base
 * skill exists on disk AND the agent doesn't already declare `skills:` (or
 * `--reset` was passed, in which case we override).
 *
 * Templates intentionally do NOT carry `skills:` — that line is added here so
 * agents stay valid in any install state (including `aspens add agent` runs
 * without a prior `doc init`).
 *
 * @param {string} content - agent .md content (with frontmatter)
 * @param {boolean} baseSkillExists
 * @param {boolean} reset
 * @returns {string}
 */
export function maybeInjectBaseSkill(content, baseSkillExists, reset) {
  if (!baseSkillExists) return content;

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return content; // no frontmatter — leave alone

  const frontmatter = fmMatch[1];
  const hasSkillsLine = /^skills:\s*/m.test(frontmatter);

  if (hasSkillsLine && !reset) return content;

  let newFrontmatter;
  if (hasSkillsLine && reset) {
    newFrontmatter = frontmatter.replace(/^skills:\s*.*$/m, 'skills: [base]');
  } else {
    newFrontmatter = frontmatter.trimEnd() + '\nskills: [base]';
  }

  return content.replace(/^---\n[\s\S]*?\n---/, '---\n' + newFrontmatter + '\n---');
}

function findAgents(agentsDir, repoPath) {
  const agents = [];

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        const content = readFileSync(full, 'utf8');
        const nameMatch = content.match(/name:\s*(.+)/);
        agents.push({
          name: nameMatch ? nameMatch[1].trim() : entry.replace('.md', ''),
          relativePath: relative(repoPath, full),
          content,
        });
      }
    }
  }

  walk(agentsDir);
  return agents;
}

function gatherProjectContext(repoPath) {
  const parts = [];

  // CLAUDE.md
  const claudeMdPath = join(repoPath, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, 'utf8');
    // Truncate to key sections
    const truncated = content.length > 3000 ? content.slice(0, 3000) + '\n...(truncated)' : content;
    parts.push(`### CLAUDE.md\n\`\`\`\n${truncated}\n\`\`\``);
  }

  // Skills
  const skillsDir = join(repoPath, '.claude', 'skills');
  if (existsSync(skillsDir)) {
    function walkSkills(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walkSkills(full);
        } else if (entry.endsWith('.md')) {
          const content = readFileSync(full, 'utf8');
          const relativePath = relative(repoPath, full);
          parts.push(`### ${relativePath}\n\`\`\`\n${content}\n\`\`\``);
        }
      }
    }
    walkSkills(skillsDir);
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}
