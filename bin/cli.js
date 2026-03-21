#!/usr/bin/env node

import { program } from 'commander';
import pc from 'picocolors';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scanCommand } from '../src/commands/scan.js';
import { docInitCommand } from '../src/commands/doc-init.js';
import { docSyncCommand } from '../src/commands/doc-sync.js';
import { addCommand } from '../src/commands/add.js';
import { customizeCommand } from '../src/commands/customize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'src', 'templates');
const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const VERSION = PKG.version;

function countTemplates(subdir) {
  try { return readdirSync(join(TEMPLATES_DIR, subdir)).filter(f => !f.startsWith('.')).length; } catch { return '?'; }
}

function showWelcome() {
  console.log(`
  ${pc.cyan(pc.bold('aspens'))} ${pc.dim(`v${VERSION}`)} — AI-ready documentation for your codebase

  ${pc.bold('Quick Start')}
    ${pc.green('aspens scan')}                       See your repo's tech stack and domains
    ${pc.green('aspens doc init')}                   Generate skills + CLAUDE.md
    ${pc.green('aspens doc sync --install-hook')}    Auto-update on every commit

  ${pc.bold('Generate & Sync')}
    ${pc.green('aspens doc init')} ${pc.dim('[path]')}          Generate skills from your code
    ${pc.green('aspens doc init --dry-run')}         Preview without writing
    ${pc.green('aspens doc init --mode chunked')}    One domain at a time (large repos)
    ${pc.green('aspens doc init --model haiku')}     Use a specific Claude model
    ${pc.green('aspens doc init --verbose')}         See what Claude is reading
    ${pc.green('aspens doc sync')} ${pc.dim('[path]')}          Update skills from recent commits
    ${pc.green('aspens doc sync --commits 5')}       Sync from last 5 commits

  ${pc.bold('Add Components')}
    ${pc.green('aspens add agent')} ${pc.dim('[name]')}         Add AI agents ${pc.dim(`(${countTemplates('agents')} available)`)}
    ${pc.green('aspens add command')} ${pc.dim('[name]')}       Add slash commands ${pc.dim(`(${countTemplates('commands')} available)`)}
    ${pc.green('aspens add hook')} ${pc.dim('[name]')}          Add auto-triggering hooks ${pc.dim(`(${countTemplates('hooks')} available)`)}
    ${pc.green('aspens add agent --list')}           Browse the library
    ${pc.green('aspens customize agents')}           Inject project context into agents

  ${pc.bold('Options')}
    ${pc.yellow('--dry-run')}          Preview without writing      ${pc.yellow('--verbose')}     See Claude's activity
    ${pc.yellow('--force')}            Overwrite existing files     ${pc.yellow('--model')} ${pc.dim('<m>')}   Choose Claude model
    ${pc.yellow('--mode')} ${pc.dim('<mode>')}       all, chunked, base-only     ${pc.yellow('--timeout')} ${pc.dim('<s>')}  Seconds per call
    ${pc.yellow('--strategy')} ${pc.dim('<s>')}    improve, rewrite, skip      ${pc.yellow('--json')}      JSON output (scan)

  ${pc.bold('Typical Workflow')}
    ${pc.dim('$')} aspens scan                              ${pc.dim('1. See what\'s in your repo')}
    ${pc.dim('$')} aspens doc init                          ${pc.dim('2. Generate skills + CLAUDE.md')}
    ${pc.dim('$')} aspens add agent all                     ${pc.dim('3. Add AI agents')}
    ${pc.dim('$')} aspens customize agents                  ${pc.dim('4. Tailor agents to your project')}
    ${pc.dim('$')} aspens doc sync --install-hook           ${pc.dim('5. Auto-update on every commit')}

  ${pc.dim('Run')} ${pc.cyan('aspens <command> --help')} ${pc.dim('for detailed usage.')}
`);
}

program
  .name('aspens')
  .description('Generate and maintain AI-ready documentation for your codebase')
  .version(VERSION)
  .action(() => {
    // No command given — show welcome
    showWelcome();
  });

// Scan command
program
  .command('scan')
  .description('Scan a repo and print its tech stack and structure')
  .argument('[path]', 'Path to repo', '.')
  .option('--json', 'Output as JSON')
  .option('--domains <domains>', 'Additional domains to include (comma-separated)')
  .option('--verbose', 'Show diagnostic output')
  .action(scanCommand);

// Doc commands
const doc = program
  .command('doc')
  .description('Generate and sync documentation (skills/guidelines)');

doc
  .command('init')
  .description('Scan repo and generate skills + guidelines')
  .argument('[path]', 'Path to repo', '.')
  .option('--dry-run', 'Preview without writing files')
  .option('--force', 'Overwrite existing skills')
  .option('--timeout <seconds>', 'Claude timeout in seconds', '300')
  .option('--mode <mode>', 'Generation mode: all, chunked, base-only (skips interactive prompt)')
  .option('--strategy <strategy>', 'Existing docs: improve, rewrite, skip (skips interactive prompt)')
  .option('--domains <domains>', 'Additional domains to include (comma-separated, e.g., "backtest,advisory")')
  .option('--model <model>', 'Claude model to use (e.g., sonnet, opus, haiku)')
  .option('--verbose', 'Show what Claude is reading/doing in real time')
  .action(docInitCommand);

doc
  .command('sync')
  .description('Update skills from recent commits')
  .argument('[path]', 'Path to repo', '.')
  .option('--commits <n>', 'Number of commits to analyze', '1')
  .option('--install-hook', 'Install git post-commit hook')
  .option('--dry-run', 'Preview without writing files')
  .option('--timeout <seconds>', 'Claude timeout in seconds', '300')
  .option('--model <model>', 'Claude model to use (e.g., sonnet, opus, haiku)')
  .option('--verbose', 'Show what Claude is reading/doing in real time')
  .action(docSyncCommand);

// Add command
program
  .command('add')
  .description('Add agents, hooks, or commands from the library')
  .argument('<type>', 'What to add: agent, hook, command')
  .argument('[name]', 'Name of the resource')
  .option('--list', 'List available resources')
  .action(addCommand);

// Customize command
program
  .command('customize')
  .description('Inject project-specific context into agents')
  .argument('<what>', 'What to customize: agents')
  .option('--dry-run', 'Preview without writing files')
  .option('--timeout <seconds>', 'Claude timeout in seconds', '300')
  .option('--model <model>', 'Claude model to use (e.g., sonnet, opus, haiku)')
  .option('--verbose', 'Show what Claude is reading/doing in real time')
  .action(customizeCommand);

program.parseAsync().catch((err) => {
  console.error(pc.red('Error:'), err.message);
  process.exit(1);
});
