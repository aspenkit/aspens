#!/usr/bin/env node

import { program, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { scanCommand } from '../src/commands/scan.js';
import { docInitCommand } from '../src/commands/doc-init.js';
import { docSyncCommand } from '../src/commands/doc-sync.js';
import { docGraphCommand } from '../src/commands/doc-graph.js';
import { addCommand } from '../src/commands/add.js';
import { customizeCommand } from '../src/commands/customize.js';
import { CliError } from '../src/lib/errors.js';

function parsePositiveInt(value, name) {
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) throw new InvalidArgumentError(`${name} must be a positive integer`);
  return n;
}

function parseTimeout(value) { return parsePositiveInt(value, 'timeout'); }
function parseCommits(value) {
  const n = parsePositiveInt(value, 'commits');
  if (n > 50) throw new InvalidArgumentError('commits must be 50 or less');
  return n;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'src', 'templates');
let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version || '0.0.0';
} catch { /* use fallback version */ }

function countTemplates(subdir) {
  try { return readdirSync(join(TEMPLATES_DIR, subdir)).filter(f => !f.startsWith('.')).length; } catch { return '?'; }
}

function showWelcome() {
  console.log(`
  ${pc.cyan(pc.bold('aspens'))} ${pc.dim(`v${VERSION}`)} — AI-ready documentation for your codebase

  ${pc.bold('Quick Start')}
    ${pc.green('aspens scan')}                       See your repo's tech stack and domains
    ${pc.green('aspens doc init')}                   Generate skills + hooks + CLAUDE.md
    ${pc.green('aspens doc sync --install-hook')}    Auto-update on every commit

  ${pc.bold('Generate & Sync')}
    ${pc.green('aspens doc init')} ${pc.dim('[path]')}          Generate skills from your code
    ${pc.green('aspens doc init --dry-run')}         Preview without writing
    ${pc.green('aspens doc init --mode chunked')}    One domain at a time (large repos)
    ${pc.green('aspens doc init --model haiku')}     Use a specific Claude model
    ${pc.green('aspens doc init --verbose')}         See what Claude is reading
    ${pc.green('aspens doc sync')} ${pc.dim('[path]')}          Update skills from recent commits
    ${pc.green('aspens doc sync --commits 5')}       Sync from last 5 commits
    ${pc.green('aspens doc sync --refresh')}         Refresh all skills from current code

  ${pc.bold('Add Components')}
    ${pc.green('aspens add agent')} ${pc.dim('[name]')}         Add AI agents ${pc.dim(`(${countTemplates('agents')} available)`)}
    ${pc.green('aspens add command')} ${pc.dim('[name]')}       Add slash commands ${pc.dim(`(${countTemplates('commands')} available)`)}
    ${pc.green('aspens add hook')} ${pc.dim('[name]')}          Add auto-triggering hooks ${pc.dim(`(${countTemplates('hooks')} available)`)}
    ${pc.green('aspens add skill')} ${pc.dim('<name>')}         Add custom skills (conventions, workflows)
    ${pc.green('aspens add agent --list')}           Browse the library
    ${pc.green('aspens customize agents')}           Inject project context into agents

  ${pc.bold('Options')}
    ${pc.yellow('--dry-run')}          Preview without writing      ${pc.yellow('--verbose')}     See Claude's activity
    ${pc.yellow('--force')}            Overwrite existing files     ${pc.yellow('--model')} ${pc.dim('<m>')}   Choose Claude model
    ${pc.yellow('--mode')} ${pc.dim('<mode>')}       all, chunked, base-only     ${pc.yellow('--timeout')} ${pc.dim('<s>')}  Seconds per call
    ${pc.yellow('--strategy')} ${pc.dim('<s>')}    improve, rewrite, skip      ${pc.yellow('--json')}      JSON output (scan)
    ${pc.yellow('--no-hooks')}         Skip hook installation       ${pc.yellow('--hooks-only')}  Update hooks only
    ${pc.yellow('--no-graph')}         Skip import graph analysis

  ${pc.bold('Typical Workflow')}
    ${pc.dim('$')} aspens scan                              ${pc.dim('1. See what\'s in your repo')}
    ${pc.dim('$')} aspens doc init                          ${pc.dim('2. Generate skills + CLAUDE.md')}
    ${pc.dim('$')} aspens add agent all                     ${pc.dim('3. Add AI agents')}
    ${pc.dim('$')} aspens customize agents                  ${pc.dim('4. Tailor agents to your project')}
    ${pc.dim('$')} aspens doc sync --install-hook           ${pc.dim('5. Auto-update on every commit')}

  ${pc.dim('Run')} ${pc.cyan('aspens <command> --help')} ${pc.dim('for detailed usage.')}

  ${pc.dim('🌲 aspens is in active development — please keep it up to date.')}
  ${pc.dim('   Run into issues? Let us know:')} ${pc.cyan('https://github.com/aspenkit/aspens/issues')}
`);
}

/**
 * Check if a target repo has Claude skills but is missing hooks.
 * Only relevant for Claude Code target (Codex doesn't use hooks).
 * Warns users who ran doc init before hooks were available (pre-0.2.2).
 */
function checkMissingHooks(repoPath) {
  const skillsDir = join(repoPath, '.claude', 'skills');
  if (!existsSync(skillsDir)) return; // no Claude skills — nothing to check

  const hookFile = join(repoPath, '.claude', 'hooks', 'skill-activation-prompt.sh');
  const rulesFile = join(repoPath, '.claude', 'skills', 'skill-rules.json');

  if (!existsSync(hookFile) || !existsSync(rulesFile)) {
    console.log(
      pc.yellow('\n  ⚠  Claude skills found but activation hooks are missing.') +
      pc.dim('\n     Skills won\'t auto-activate without hooks.') +
      '\n     Run: ' + pc.cyan('aspens doc init --hooks-only') +
      pc.dim(' to install them.\n')
    );
  }
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
  .option('--no-graph', 'Skip import graph analysis')
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
  .option('--timeout <seconds>', 'Claude timeout in seconds', parseTimeout, 300)
  .option('--mode <mode>', 'Generation mode: all, chunked, base-only (skips interactive prompt)')
  .option('--strategy <strategy>', 'Existing docs: improve, rewrite, skip (skips interactive prompt)')
  .option('--domains <domains>', 'Additional domains to include (comma-separated, e.g., "backtest,advisory")')
  .option('--model <model>', 'Claude model to use (e.g., sonnet, opus, haiku)')
  .option('--no-hook', 'Skip post-commit hook prompt')
  .option('--verbose', 'Show what Claude is reading/doing in real time')
  .option('--no-hooks', 'Skip hook/rules/settings installation')
  .option('--hooks-only', 'Skip skill generation, just install/update hooks')
  .option('--no-graph', 'Skip import graph analysis')
  .option('--target <target>', 'Output target: claude, codex, all')
  .option('--backend <backend>', 'Generation backend: claude, codex (default: matches target)')
  .action(docInitCommand);

doc
  .command('sync')
  .description('Update skills from recent commits')
  .argument('[path]', 'Path to repo', '.')
  .option('--commits <n>', 'Number of commits to analyze', parseCommits, 1)
  .option('--refresh', 'Refresh all skills from current codebase state (no git diff)')
  .option('--install-hook', 'Install git post-commit hook')
  .option('--remove-hook', 'Remove git post-commit hook')
  .option('--dry-run', 'Preview without writing files')
  .option('--timeout <seconds>', 'Claude timeout in seconds', parseTimeout, 300)
  .option('--model <model>', 'Claude model to use (e.g., sonnet, opus, haiku)')
  .option('--verbose', 'Show what Claude is reading/doing in real time')
  .option('--no-graph', 'Skip import graph analysis')
  .action((path, options) => {
    checkMissingHooks(resolve(path));
    return docSyncCommand(path, options);
  });

doc
  .command('graph')
  .description('Rebuild the import graph cache')
  .argument('[path]', 'Path to repo', '.')
  .option('--verbose', 'Show detailed graph info')
  .action(docGraphCommand);

// Add command
program
  .command('add')
  .description('Add agents, hooks, commands, or custom skills')
  .argument('<type>', 'What to add: agent, hook, command, skill')
  .argument('[name]', 'Name of the resource')
  .option('--list', 'List available resources')
  .option('--from <path>', 'Generate skill from a reference document (skill type only)')
  .option('--timeout <seconds>', 'Claude timeout in seconds (skill --from)', parseTimeout)
  .option('--model <model>', 'Claude model to use (skill --from)')
  .option('--verbose', 'Show Claude activity (skill --from)')
  .action((type, name, options) => {
    checkMissingHooks(resolve('.'));
    return addCommand(type, name, options);
  });

// Customize command
program
  .command('customize')
  .description('Inject project-specific context into agents')
  .argument('<what>', 'What to customize: agents')
  .option('--dry-run', 'Preview without writing files')
  .option('--timeout <seconds>', 'Claude timeout in seconds', parseTimeout, 300)
  .option('--model <model>', 'Claude model to use (e.g., sonnet, opus, haiku)')
  .option('--verbose', 'Show what Claude is reading/doing in real time')
  .action((what, options) => {
    checkMissingHooks(resolve('.'));
    return customizeCommand(what, options);
  });

// Clean up spawned processes on interrupt
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

program.parseAsync().catch((err) => {
  if (err instanceof CliError) {
    if (!err.logged) console.error(pc.red('Error:'), err.message);
    process.exit(err.exitCode);
  }
  console.error(pc.red('Error:'), err.message);
  process.exit(1);
});
