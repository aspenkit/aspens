#!/usr/bin/env node

import { program } from 'commander';
import pc from 'picocolors';
import { scanCommand } from '../src/commands/scan.js';
import { docInitCommand } from '../src/commands/doc-init.js';
import { docSyncCommand } from '../src/commands/doc-sync.js';
import { addCommand } from '../src/commands/add.js';
import { customizeCommand } from '../src/commands/customize.js';

function showWelcome() {
  console.log(`
  ${pc.cyan(pc.bold('aspens'))} ${pc.dim('v0.0.1')} — AI-ready documentation for your codebase

  ${pc.bold('Getting Started')}
    ${pc.green('aspens scan')} ${pc.dim('[path]')}              Scan a repo's tech stack and structure
    ${pc.green('aspens doc init')} ${pc.dim('[path]')}          Generate skills + CLAUDE.md from your code
    ${pc.green('aspens doc sync')} ${pc.dim('[path]')}          Keep skills updated on every commit

  ${pc.bold('Add Components')}
    ${pc.green('aspens add agent')} ${pc.dim('[name]')}         Add AI agents to your repo
    ${pc.green('aspens add hook')} ${pc.dim('[name]')}          Add auto-triggering hooks
    ${pc.green('aspens add command')} ${pc.dim('[name]')}       Add slash commands
    ${pc.green('aspens customize agents')}          Inject project context into agents

  ${pc.bold('Common Options')}
    ${pc.yellow('--dry-run')}                        Preview without writing files
    ${pc.yellow('--mode')} ${pc.dim('<all|chunked|base-only>')}  Generation strategy
    ${pc.yellow('--force')}                          Overwrite existing files
    ${pc.yellow('--help')}                           Show help for any command

  ${pc.bold('Examples')}
    ${pc.dim('$')} aspens scan .                          ${pc.dim('See what\'s in your repo')}
    ${pc.dim('$')} aspens doc init --dry-run .            ${pc.dim('Preview generated skills')}
    ${pc.dim('$')} aspens doc init --mode chunked .       ${pc.dim('Generate one domain at a time')}
    ${pc.dim('$')} aspens doc init --force .              ${pc.dim('Overwrite existing skills')}

  ${pc.dim('Run')} ${pc.cyan('aspens <command> --help')} ${pc.dim('for detailed usage of any command.')}
`);
}

program
  .name('aspens')
  .description('Generate and maintain AI-ready documentation for your codebase')
  .version('0.0.1')
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
  .option('--verbose', 'Show what Claude is reading/doing in real time')
  .action(customizeCommand);

program.parseAsync().catch((err) => {
  console.error(pc.red('Error:'), err.message);
  process.exit(1);
});
