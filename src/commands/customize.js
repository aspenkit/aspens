import { resolve, join, relative } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { runClaude, loadPrompt, parseFileOutput } from '../lib/runner.js';
import { writeSkillFiles } from '../lib/skill-writer.js';

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];

export async function customizeCommand(what, options) {
  const repoPath = resolve('.');
  const timeoutMs = parseInt(options.timeout) * 1000 || 300000;
  const verbose = !!options.verbose;

  if (what !== 'agents') {
    console.log(`
  ${pc.red('Unknown target:')} ${what}

  Usage:
    ${pc.green('aspens customize agents')}    Inject project context into your agents
`);
    process.exit(1);
  }

  p.intro(pc.cyan('aspens customize agents'));

  // Step 1: Find agents in the repo
  const agentsDir = join(repoPath, '.claude', 'agents');
  if (!existsSync(agentsDir)) {
    p.log.error('No .claude/agents/ found. Run aspens add agent first.');
    process.exit(1);
  }

  const agents = findAgents(agentsDir, repoPath);
  if (agents.length === 0) {
    p.log.error('No agent files found in .claude/agents/');
    process.exit(1);
  }

  p.log.info(`Found ${agents.length} agent(s): ${agents.map(a => pc.yellow(a.name)).join(', ')}`);

  // Step 2: Gather project context
  const contextSpinner = p.spinner();
  contextSpinner.start('Reading project context...');

  const projectContext = gatherProjectContext(repoPath);

  if (!projectContext) {
    contextSpinner.stop(pc.yellow('No skills or CLAUDE.md found'));
    p.log.warn('Run aspens doc init first to generate skills, then customize agents.');
    process.exit(0);
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
      const output = await runClaude(prompt, {
        timeout: timeoutMs,
        allowedTools: READ_ONLY_TOOLS,
        verbose,
        onActivity: verbose ? (msg) => agentSpinner.message(pc.dim(msg)) : null,
      });

      const files = parseFileOutput(output);
      if (files.length > 0) {
        allFiles.push(...files);
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
    process.exit(0);
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

  // Guidelines paths (just list them, don't read)
  const guidelinesDir = join(repoPath, '.claude', 'guidelines');
  if (existsSync(guidelinesDir)) {
    const paths = [];
    function walkGuidelines(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walkGuidelines(full);
        } else if (entry.endsWith('.md')) {
          paths.push(relative(repoPath, full));
        }
      }
    }
    walkGuidelines(guidelinesDir);
    if (paths.length > 0) {
      parts.push(`### Available Guidelines\n${paths.map(p => `- ${p}`).join('\n')}`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}
