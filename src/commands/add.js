import { resolve, join, dirname, basename } from 'path';
import { existsSync, readFileSync, copyFileSync, mkdirSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { CliError } from '../lib/errors.js';

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

  // Validate type
  if (!RESOURCE_TYPES[type]) {
    console.log(`
  ${pc.red('Unknown type:')} ${type}

  Available types:
    ${pc.green('agent')}     ${RESOURCE_TYPES.agent.description}
    ${pc.green('command')}   ${RESOURCE_TYPES.command.description}
    ${pc.green('hook')}      ${RESOURCE_TYPES.hook.description}

  Usage:
    ${pc.dim('aspens add agent [name]')}
    ${pc.dim('aspens add command [name]')}
    ${pc.dim('aspens add hook [name]')}
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
}
