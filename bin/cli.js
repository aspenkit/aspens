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
import { docImpactCommand } from '../src/commands/doc-impact.js';
import { addCommand } from '../src/commands/add.js';
import { customizeCommand } from '../src/commands/customize.js';
import { saveTokensCommand } from '../src/commands/save-tokens.js';
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
  ${pc.cyan(pc.bold('aspens'))} ${pc.dim(`v${VERSION}`)} — keep agent context accurate as your repo changes

  ${pc.bold('Essential')}
    ${pc.green('aspens doc init --recommended')}     Install docs, hooks, agents, save-tokens, and doc-sync
    ${pc.green('aspens doc impact')}                 Verify health and see what else aspens can add
    ${pc.green('aspens doc sync --install-hook')}    Enable/repair automatic doc updates after commits

  ${pc.bold('Generate & Sync')}
    ${pc.green('aspens doc init')}                   Generate docs from your code
    ${pc.green('aspens doc init --recommended')}     Install the full recommended setup
    ${pc.green('aspens doc init --dry-run')}         Preview without writing
    ${pc.green('aspens doc init --mode chunked')}    One domain at a time (large repos)
    ${pc.green('aspens doc init --target all')}      Generate Claude + Codex docs together
    ${pc.green('aspens doc init --model haiku')}     Use a specific backend model
    ${pc.green('aspens doc init --verbose')}         See backend activity in real time
    ${pc.green('aspens doc sync')}                   Update generated docs from recent commits
    ${pc.green('aspens doc impact')}                 Check freshness, coverage, and hooks
    ${pc.green('aspens doc sync --install-hook')}    Auto-update generated docs after git commits
    ${pc.green('aspens doc sync --commits 5')}       Sync from last 5 commits
    ${pc.green('aspens doc sync --refresh')}         Refresh all skills from current code

  ${pc.bold('Claude Add-ons')}
    ${pc.green('aspens save-tokens')}                Install token warnings + handoff commands
    ${pc.green('aspens add agent')} ${pc.dim('[name]')}        Add Claude-side agents ${pc.dim(`(${countTemplates('agents')} available)`)}
    ${pc.green('aspens add command')} ${pc.dim('[name]')}      Add slash commands ${pc.dim(`(${countTemplates('commands')} available)`)}
    ${pc.green('aspens add hook')} ${pc.dim('[name]')}         Add auto-triggering hooks ${pc.dim(`(${countTemplates('hooks')} available)`)}
    ${pc.green('aspens add agent --list')}           Browse the library
    ${pc.green('aspens customize agents')}           Inject project context into agents

  ${pc.bold('Utilities')}
    ${pc.green('aspens scan')}                       Inspect tech stack, domains, and repo shape (no AI)
    ${pc.green('aspens add skill')} ${pc.dim('<name>')}        Add custom skills (conventions, workflows)

  ${pc.bold('Options')}
    ${pc.yellow('--dry-run')}          Preview without writing      ${pc.yellow('--verbose')}     See backend activity
    ${pc.yellow('--force')}            Overwrite existing files     ${pc.yellow('--model')} ${pc.dim('<m>')}   Choose backend model
    ${pc.yellow('--mode')} ${pc.dim('<mode>')}       all, chunked, base-only     ${pc.yellow('--timeout')} ${pc.dim('<s>')}  Seconds per call
    ${pc.yellow('--strategy')} ${pc.dim('<s>')}    improve, rewrite, skip      ${pc.yellow('--json')}      JSON output (scan)
    ${pc.yellow('--target')} ${pc.dim('<t>')}       claude, codex, all          ${pc.yellow('--backend')} ${pc.dim('<b>')} Generate with claude or codex
    ${pc.yellow('--no-hooks')}         Skip Claude hook installation ${pc.yellow('--hooks-only')}  Update Claude hooks only
    ${pc.yellow('--no-graph')}         Skip import graph analysis

  ${pc.bold('Typical Workflow')}
    ${pc.dim('$')} aspens doc init --recommended            ${pc.dim('1. Install the recommended setup')}
    ${pc.dim('$')} aspens doc impact                        ${pc.dim('2. Verify health + discover optional upgrades')}

  ${pc.bold('Target Notes')}
    ${pc.dim('Claude:')} ${pc.cyan('CLAUDE.md + .claude/skills + hooks')}
    ${pc.dim('Codex: ')} ${pc.cyan('AGENTS.md + .agents/skills + directory AGENTS.md')}
    ${pc.dim('Hooks are Claude-only today. Codex is instruction-file driven.')}

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
  .description('Keep agent context accurate as your codebase changes')
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
  .option('--recommended', 'Use the recommended target and install the full recommended aspens setup')
  .option('--dry-run', 'Preview without writing files')
  .option('--force', 'Overwrite existing skills')
  .option('--timeout <seconds>', 'Backend timeout in seconds', parseTimeout, 300)
  .option('--mode <mode>', 'Generation mode: all, chunked, base-only (skips interactive prompt)')
  .option('--strategy <strategy>', 'Existing docs: improve, rewrite, skip (skips interactive prompt)')
  .option('--domains <domains>', 'Additional domains to include (comma-separated, e.g., "backtest,advisory")')
  .option('--model <model>', 'Model to use for the selected backend')
  .option('--no-hook', 'Skip post-commit hook prompt')
  .option('--verbose', 'Show backend reads/activity in real time')
  .option('--no-hooks', 'Skip Claude hook/rules/settings installation')
  .option('--hooks-only', 'Skip doc generation, just install/update Claude hooks')
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
  .option('--install-hook', 'Install Claude git post-commit hook')
  .option('--remove-hook', 'Remove Claude git post-commit hook')
  .option('--dry-run', 'Preview without writing files')
  .option('--timeout <seconds>', 'Backend timeout in seconds', parseTimeout, 300)
  .option('--model <model>', 'Model to use for the selected backend')
  .option('--verbose', 'Show backend reads/activity in real time')
  .option('--no-graph', 'Skip import graph analysis')
  .action((path, options) => {
    checkMissingHooks(resolve(path));
    return docSyncCommand(path, options);
  });

doc
  .command('impact')
  .description('Show generated context freshness and coverage')
  .argument('[path]', 'Path to repo', '.')
  .option('--apply', 'Apply recommended fixes after confirmation')
  .option('--backend <backend>', 'Interpretation backend: claude, codex (default: whichever is available)')
  .option('--model <model>', 'Model to use for impact interpretation')
  .option('--timeout <seconds>', 'Backend timeout in seconds', parseTimeout, 300)
  .option('--verbose', 'Show backend reads/activity in real time')
  .option('--no-graph', 'Skip import graph analysis')
  .action(docImpactCommand);

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
  .option('--timeout <seconds>', 'Backend timeout in seconds (skill --from)', parseTimeout)
  .option('--model <model>', 'Model to use for skill --from generation')
  .option('--verbose', 'Show backend activity (skill --from)')
  .action((type, name, options) => {
    checkMissingHooks(resolve('.'));
    return addCommand(type, name, options);
  });

program
  .command('save-tokens')
  .description('Install recommended token-saving session settings')
  .argument('[path]', 'Path to repo', '.')
  .option('--recommended', 'Install the recommended save-tokens setup without prompts')
  .option('--remove', 'Remove aspens save-tokens Claude hooks/statusLine/settings')
  .action(saveTokensCommand);

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
