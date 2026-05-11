import { resolve, join, dirname, basename } from 'path';
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { CliError } from '../lib/errors.js';
import { resolveTimeout } from '../lib/timeout.js';
import { runLLM, loadPrompt, parseFileOutput } from '../lib/runner.js';
import { extractRulesFromSkills } from '../lib/skill-writer.js';
import { findSkillFiles } from '../lib/skill-reader.js';
import { TARGETS, getAllowedPaths, readConfig } from '../lib/target.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

const RESOURCE_TYPES = {
  agent: {
    templateDir: join(TEMPLATES_DIR, 'agents'),
    targetDir: '.claude/agents',
    label: 'Agents',
    description: 'Specialized AI personas for code review, refactoring, documentation, etc.',
  },
  command: {
    templateDir: join(TEMPLATES_DIR, 'commands'),
    targetDir: '.claude/commands',
    label: 'Commands',
    description: 'Slash commands for planning, documentation, and workflow.',
  },
  hook: {
    templateDir: join(TEMPLATES_DIR, 'hooks'),
    targetDir: '.claude/hooks',
    label: 'Hooks',
    description: 'Auto-triggering scripts that run on events (skill activation, file tracking).',
  },
};

export async function addCommand(type, name, options) {
  const repoPath = resolve('.');

  // Check if target is Codex-only — agents, commands, hooks are Claude-only
  const config = readConfig(repoPath);
  const isCodexOnly = config?.targets?.length === 1 && config.targets[0] === 'codex';
  if (isCodexOnly && ['agent', 'command', 'hook'].includes(type)) {
    throw new CliError(
      `"aspens add ${type}" is only available for Claude Code targets. ` +
      `This repo is configured for Codex CLI only.\n` +
      `Use "aspens add skill" instead — skills work with both targets.`
    );
  }

  // Skill type — handled separately (not template-based)
  if (type === 'skill') {
    return addSkillCommand(repoPath, name, options);
  }

  // Validate type
  if (!RESOURCE_TYPES[type]) {
    console.log(`
  ${pc.red('Unknown type:')} ${type}

  Available types:
    ${pc.green('agent')}     ${RESOURCE_TYPES.agent.description}
    ${pc.green('command')}   ${RESOURCE_TYPES.command.description}
    ${pc.green('hook')}      ${RESOURCE_TYPES.hook.description}
    ${pc.green('skill')}     Custom skills for conventions, workflows, and processes

  Usage:
    ${pc.dim('aspens add agent [name]')}
    ${pc.dim('aspens add command [name]')}
    ${pc.dim('aspens add hook [name]')}
    ${pc.dim('aspens add skill <name>')}
    ${pc.dim('aspens add skill <name> --from doc.md')}
    ${pc.dim('aspens add agent --list')}
`);
    throw new CliError(`Unknown type: ${type}`, { logged: true });
  }

  const resourceType = RESOURCE_TYPES[type];
  const available = listAvailable(resourceType.templateDir);

  // --list mode
  if (options.list) {
    showList(type, resourceType, available);
    return;
  }

  // No name given — show interactive picker
  if (!name) {
    if (available.length === 0) {
      console.log(pc.yellow(`\n  No ${type}s available in the library.\n`));
      return;
    }

    const picked = await p.multiselect({
      message: `Select ${type}(s) to add:`,
      options: available.map(a => ({
        value: a.name,
        label: a.name,
        hint: a.description,
      })),
      required: true,
    });

    if (p.isCancel(picked)) {
      p.cancel('Aborted');
      return;
    }

    for (const pickedName of picked) {
      addResource(repoPath, resourceType, pickedName, available);
    }

    console.log(pc.green(`\n  ${picked.length} ${type}(s) added.`));
    if (type === 'agent') showCustomizeTip();
    console.log();
    return;
  }

  // Add by name
  if (name === 'all') {
    for (const a of available) {
      addResource(repoPath, resourceType, a.name, available);
    }
    console.log(pc.green(`\n  All ${available.length} ${type}(s) added.`));
    if (type === 'agent') showCustomizeTip();
    console.log();
    return;
  }

  const found = available.find(a => a.name === name);
  if (!found) {
    console.log(`
  ${pc.red('Not found:')} ${name}

  Available ${type}s:
${available.map(a => `    ${pc.green(a.name)} — ${a.description}`).join('\n')}
`);
    throw new CliError(`Not found: ${name}`, { logged: true });
  }

  addResource(repoPath, resourceType, name, available);
  console.log(pc.green(`\n  Added ${type}: ${name}`));
  if (type === 'agent') showCustomizeTip();
  console.log();
}

function resolveSkillTarget(config) {
  const targetIds = config?.targets || ['claude'];
  if (targetIds.length === 1 && targetIds[0] === 'codex') {
    return TARGETS.codex;
  }
  return TARGETS.claude;
}

function showCustomizeTip() {
  console.log();
  console.log(pc.dim('  Tip: Run ') + pc.cyan('aspens customize agents') + pc.dim(' to inject your project\'s'));
  console.log(pc.dim('  tech stack and conventions into the agents for better results.'));
}

// --- Helpers ---

function listAvailable(templateDir) {
  if (!existsSync(templateDir)) return [];

  return readdirSync(templateDir)
    .filter(f => f.endsWith('.md') || f.endsWith('.sh'))
    .map(f => {
      const content = readFileSync(join(templateDir, f), 'utf8');
      const nameMatch = content.match(/name:\s*(.+)/);
      const descMatch = content.match(/description:\s*(.+?)(?:\n|\\n)/);
      const fileName = basename(f, '.md').replace('.sh', '');
      return {
        name: nameMatch ? nameMatch[1].trim() : fileName,
        fileName: f,
        description: descMatch ? descMatch[1].trim().slice(0, 80) : '',
      };
    });
}

function showList(type, resourceType, available) {
  console.log(`
  ${pc.bold(resourceType.label)} ${pc.dim(`(${available.length} available)`)}
  ${pc.dim(resourceType.description)}
`);

  if (available.length === 0) {
    console.log(pc.dim('  None available.\n'));
    return;
  }

  for (const a of available) {
    console.log(`  ${pc.green(a.name)}`);
    if (a.description) {
      console.log(`  ${pc.dim(a.description)}`);
    }
    console.log();
  }

  console.log(pc.dim(`  Add one:  aspens add ${type} ${available[0].name}`));
  console.log(pc.dim(`  Add all:  aspens add ${type} all`));
  console.log();
}

function addResource(repoPath, resourceType, name, available) {
  const resource = available.find(a => a.name === name);
  if (!resource) return;

  const sourceFile = join(resourceType.templateDir, resource.fileName);
  const targetDir = join(repoPath, resourceType.targetDir);
  const targetFile = join(targetDir, resource.fileName);

  mkdirSync(targetDir, { recursive: true });

  if (existsSync(targetFile)) {
    console.log(pc.dim(`  ~ ${resourceType.targetDir}/${resource.fileName} (already exists, skipped)`));
    return;
  }

  copyFileSync(sourceFile, targetFile);
  console.log(`  ${pc.green('+')} ${resourceType.targetDir}/${resource.fileName}`);

  // Phase 6: agents reference the base skill via conditional reads (and via
  // `skills: [base]` if Claude Code supports it). Warn — non-fatal — when the
  // base skill is not on disk so users know to run `aspens doc init`.
  if (resourceType.targetDir === '.claude/agents') {
    const baseSkillPath = join(repoPath, '.claude', 'skills', 'base', 'skill.md');
    if (!existsSync(baseSkillPath)) {
      console.log(pc.yellow('    ! Base skill missing.') + pc.dim(" Run 'aspens doc init' before this agent can fully self-contextualize. The agent will still install."));
    }
  }

  // Plan/execute agents need dev/ gitignored for plan storage
  if (name === 'plan' || name === 'execute') {
    ensureDevGitignore(repoPath);
  }
}

function ensureDevGitignore(repoPath) {
  try {
    const gitignorePath = join(repoPath, '.gitignore');
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf8');
      if (/^dev\/$/m.test(content)) return; // already present
      writeFileSync(gitignorePath, content.trimEnd() + '\ndev/\n', 'utf8');
    } else {
      writeFileSync(gitignorePath, 'dev/\n', 'utf8');
    }
    console.log(`  ${pc.green('+')} Added ${pc.cyan('dev/')} to .gitignore (used for plan storage)`);
  } catch (err) {
    throw new CliError(`Failed to update .gitignore: ${err.message}. Check file permissions.`);
  }
}

// --- Custom skill ---

async function addSkillCommand(repoPath, name, options) {
  const config = readConfig(repoPath);
  const target = resolveSkillTarget(config);
  const skillsDir = join(repoPath, target.skillsDir);
  const skillFilename = target.skillFilename;
  const relSkillsDir = target.skillsDir;

  // --list mode: show existing skills
  if (options.list) {
    const skills = existsSync(skillsDir) ? findSkillFiles(skillsDir, { skillFilename }) : [];
    console.log(`
  ${pc.bold('Skills')} ${pc.dim(`(${skills.length} installed)`)}
  ${pc.dim('Custom skills for conventions, workflows, and processes.')}
`);
    if (skills.length === 0) {
      console.log(pc.dim('  None installed yet.\n'));
    } else {
      for (const skill of skills) {
        const desc = skill.frontmatter?.description || '';
        console.log(`  ${pc.green(skill.name)}`);
        if (desc) console.log(`  ${pc.dim(desc)}`);
        console.log();
      }
    }
    console.log(pc.dim('  Create one:  aspens add skill my-convention'));
    console.log(pc.dim('  From a doc:  aspens add skill release --from dev/release.md'));
    console.log();
    return;
  }

  // Name is required for skills
  if (!name) {
    console.log(`
  ${pc.bold('Add a custom skill')}

  Usage:
    ${pc.green('aspens add skill <name>')}                 Scaffold a new skill
    ${pc.green('aspens add skill <name> --from <file>')}   Generate from a reference doc
    ${pc.green('aspens add skill --list')}                 Show existing skills

  Examples:
    ${pc.dim('aspens add skill ui-conventions')}
    ${pc.dim('aspens add skill release --from dev/release.md')}
    ${pc.dim('aspens add skill code-review --from docs/review-process.md')}
`);
    return;
  }

  // Sanitize skill name
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!safeName) {
    throw new CliError('Invalid skill name. Use letters, numbers, and hyphens.');
  }

  const skillDir = join(skillsDir, safeName);
  const skillPath = join(skillDir, skillFilename);
  const relPath = `${relSkillsDir}/${safeName}/${skillFilename}`;

  if (existsSync(skillPath)) {
    console.log(pc.yellow(`\n  Skill already exists: ${relPath}`));
    console.log(pc.dim('  Edit it directly or delete and re-create.\n'));
    return;
  }

  // --from mode: generate from reference doc
  if (options.from) {
    return generateSkillFromDoc(repoPath, safeName, options);
  }

  // Scaffold mode: create blank template
  const today = new Date().toISOString().split('T')[0];
  const scaffold = `---
name: ${safeName}
description: TODO — describe what this skill covers
---

## Activation

This skill triggers when working on ${safeName}-related tasks.
- \`TODO: add file patterns\`

Keywords: ${safeName}

---

You are working on **${safeName}**.

## Key Files
- \`TODO\` — Add key files relevant to this skill

## Key Concepts
- **TODO:** Add key concepts, conventions, or workflows

## Critical Rules
- TODO: Add rules that must not be violated

---
**Last Updated:** ${today}
`;

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillPath, scaffold, 'utf8');

  console.log(`\n  ${pc.green('+')} ${relPath}`);
  console.log(pc.dim(`\n  Edit the skill to add your conventions and file patterns.`));
  if (target.id === 'claude') {
    console.log(pc.dim(`  Then run ${pc.cyan('aspens doc init --hooks-only')} to update activation rules.\n`));
  } else {
    console.log();
  }

  if (target.id === 'claude') {
    updateSkillRules(skillsDir);
  }
}

async function generateSkillFromDoc(repoPath, skillName, options) {
  const config = readConfig(repoPath);
  const target = resolveSkillTarget(config);
  const backendId = config?.backend || target.id;
  const fromPath = resolve(options.from);
  if (!existsSync(fromPath)) {
    throw new CliError(`Reference file not found: ${options.from}`);
  }

  const skillDir = join(repoPath, target.skillsDir, skillName);
  const relPath = `${target.skillsDir}/${skillName}/${target.skillFilename}`;
  const verbose = !!options.verbose;
  const allowedPaths = getAllowedPaths([target]);

  const { timeoutMs } = resolveTimeout(options.timeout, 120);

  let refContent = readFileSync(fromPath, 'utf8');
  const REF_MAX_CHARS = 50000;
  if (refContent.length > REF_MAX_CHARS) {
    refContent = refContent.slice(0, REF_MAX_CHARS) + '\n... (truncated)';
    p.log.warn(`Reference doc truncated to ${Math.round(REF_MAX_CHARS / 1024)}k chars.`);
  }
  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = loadPrompt('add-skill', {
    skillPath: relPath,
  });

  const userPrompt = `Skill name: ${skillName}
Today's date: ${today}
Repository path: ${repoPath}

## Reference Document (${options.from})
\`\`\`
${refContent}
\`\`\``;

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  const genSpinner = p.spinner();
  genSpinner.start(`Generating ${pc.cyan(skillName)} skill from ${options.from}...`);

  let result;
  try {
    result = await runLLM(fullPrompt, {
      timeout: timeoutMs,
      allowedTools: ['Read', 'Glob', 'Grep'],
      verbose,
      model: options.model || null,
      onActivity: verbose ? (msg) => genSpinner.message(pc.dim(msg)) : null,
      cwd: repoPath,
    }, backendId);
  } catch (err) {
    genSpinner.stop(pc.red('Failed'));
    throw new CliError(err.message, { cause: err });
  }

  const files = parseFileOutput(result.text, allowedPaths);
  if (files.length === 0) {
    genSpinner.stop(pc.red('No skill generated'));
    throw new CliError('Claude did not produce a skill file. Try a different reference document or write the skill manually.');
  }

  genSpinner.stop(`Generated ${pc.cyan(skillName)} skill`);

  // Write the skill
  mkdirSync(skillDir, { recursive: true });
  for (const file of files) {
    const fullPath = join(repoPath, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf8');
    console.log(`\n  ${pc.green('+')} ${file.path}`);
  }

  if (target.id === 'claude') {
    const skillsDir = join(repoPath, target.skillsDir);
    updateSkillRules(skillsDir);
  }

  console.log(pc.dim(`\n  Review the generated skill and adjust as needed.`));
  if (target.id === 'claude') {
    console.log(pc.dim(`  Run ${pc.cyan('aspens doc init --hooks-only')} to update activation hooks.\n`));
  } else {
    console.log();
  }
}

function updateSkillRules(skillsDir) {
  try {
    const rules = extractRulesFromSkills(skillsDir);
    writeFileSync(join(skillsDir, 'skill-rules.json'), JSON.stringify(rules, null, 2) + '\n');
  } catch { /* non-fatal — hooks-only will catch up */ }
}
