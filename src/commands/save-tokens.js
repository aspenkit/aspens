import { resolve, join, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { loadConfig, mergeConfiguredTargets, writeConfig } from '../lib/target.js';
import {
  buildSaveTokensConfig,
  buildSaveTokensGitignore,
  buildSaveTokensReadme,
  buildSaveTokensSettings,
} from '../lib/save-tokens.js';
import { mergeSettings } from '../lib/skill-writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

const CLAUDE_SAVE_TOKENS_HOOKS = [
  { src: 'hooks/save-tokens.mjs', dest: '.claude/hooks/save-tokens.mjs', chmod: false },
  { src: 'hooks/save-tokens-statusline.sh', dest: '.claude/hooks/save-tokens-statusline.sh', chmod: true },
  { src: 'hooks/save-tokens-prompt-guard.sh', dest: '.claude/hooks/save-tokens-prompt-guard.sh', chmod: true },
  { src: 'hooks/save-tokens-precompact.sh', dest: '.claude/hooks/save-tokens-precompact.sh', chmod: true },
];

export async function saveTokensCommand(path = '.', _options = {}) {
  const repoPath = resolve(path);
  const { config: existingConfig } = loadConfig(repoPath, { persist: false });
  const targets = existingConfig?.targets?.length ? existingConfig.targets : ['claude'];
  const saveTokensConfig = buildSaveTokensConfig(existingConfig?.saveTokens);

  p.intro(pc.cyan('aspens save-tokens'));

  if (_options.remove) {
    removeSaveTokens(repoPath, existingConfig);
    p.outro(pc.green('save-tokens removed'));
    return;
  }

  if (_options.recommended) {
    const summaryLines = [];
    const finalConfig = installSaveTokensRecommended(repoPath, existingConfig, targets.map(id => ({ id })), summaryLines);
    const persistedTargets = mergeConfiguredTargets(existingConfig?.targets, targets);
    writeConfig(repoPath, {
      targets: persistedTargets,
      backend: existingConfig?.backend ?? null,
      saveTokens: finalConfig,
    });
    summaryLines.push(`${pc.yellow('~')} .aspens.json`);
    renderInstallSummary(summaryLines, targets.includes('claude'), targets.includes('codex'));
    p.outro(pc.green('save-tokens configured'));
    return;
  }

  const selectedFeatures = await selectSaveTokensFeatures();
  if (!selectedFeatures) return;

  const confirmInstall = await p.confirm({
    message: 'Install selected save-tokens settings?',
    initialValue: true,
  });

  if (p.isCancel(confirmInstall) || !confirmInstall) {
    p.cancel('Aborted');
    return;
  }

  const finalConfig = configFromSelectedFeatures(saveTokensConfig, selectedFeatures);

  const sessionsDir = join(repoPath, '.aspens', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  const readmePath = join(sessionsDir, 'README.md');
  const hadReadme = existsSync(readmePath);
  writeFileSync(join(sessionsDir, '.gitignore'), buildSaveTokensGitignore(), 'utf8');
  if (!hadReadme) {
    writeFileSync(readmePath, buildSaveTokensReadme(), 'utf8');
  }

  const summaryLines = [];
  summaryLines.push(`${pc.green('+')} .aspens/sessions/.gitignore`);
  if (!hadReadme) {
    summaryLines.push(`${pc.green('+')} .aspens/sessions/README.md`);
  } else {
    summaryLines.push(`${pc.dim('-')} .aspens/sessions/README.md (already exists)`);
  }

  const hasClaudeTarget = targets.includes('claude');
  if (hasClaudeTarget) {
    const installResult = installClaudeSaveTokens(repoPath, summaryLines);
    applyStatusLineAvailability(finalConfig, installResult.statusLineInstalled, summaryLines);
  }

  const persistedTargets = mergeConfiguredTargets(existingConfig?.targets, targets);
  writeConfig(repoPath, {
    targets: persistedTargets,
    backend: existingConfig?.backend ?? null,
    saveTokens: finalConfig,
  });
  summaryLines.push(`${pc.yellow('~')} .aspens.json`);

  renderInstallSummary(summaryLines, hasClaudeTarget, targets.includes('codex'));

  p.outro(pc.green('save-tokens configured'));
}

function renderInstallSummary(summaryLines, hasClaudeTarget, hasCodexTarget) {
  console.log();
  for (const line of summaryLines) {
    console.log(`  ${line}`);
  }
  console.log();
  console.log(pc.dim('  Claude: ') + (hasClaudeTarget ? 'automatic save-tokens hooks installed' : 'not configured for this repo'));
  if (hasCodexTarget) {
    console.log(pc.dim('  Codex: ') + 'no automatic save-tokens integration installed');
  }
  console.log();
}

export function installSaveTokensRecommended(repoPath, existingConfig, targets, summaryLines = []) {
  const saveTokensConfig = buildSaveTokensConfig(existingConfig?.saveTokens);
  const sessionsDir = join(repoPath, '.aspens', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });

  const readmePath = join(sessionsDir, 'README.md');
  const hadReadme = existsSync(readmePath);
  writeFileSync(join(sessionsDir, '.gitignore'), buildSaveTokensGitignore(), 'utf8');
  if (!hadReadme) {
    writeFileSync(readmePath, buildSaveTokensReadme(), 'utf8');
  }

  summaryLines.push(`${pc.green('+')} .aspens/sessions/.gitignore`);
  summaryLines.push(`${hadReadme ? pc.yellow('~') : pc.green('+')} .aspens/sessions/README.md`);

  const hasClaudeTarget = targets.some(target => target.id === 'claude');
  if (hasClaudeTarget) {
    const installResult = installClaudeSaveTokens(repoPath, summaryLines);
    applyStatusLineAvailability(saveTokensConfig, installResult.statusLineInstalled, summaryLines);
  }

  return saveTokensConfig;
}

async function selectSaveTokensFeatures() {
  const selected = await p.multiselect({
    message: 'Select save-tokens settings:',
    required: true,
    initialValues: ['warnings', 'handoffs'],
    options: [
      { value: 'warnings', label: 'Claude token warnings', hint: 'warns at 175k and strongly recommends fresh-session handoff at 200k' },
      { value: 'handoffs', label: 'Automatic handoff saves', hint: 'saves basic handoffs before compacting and at 200k' },
    ],
  });

  if (p.isCancel(selected)) {
    p.cancel('Aborted');
    return null;
  }
  return selected;
}

function configFromSelectedFeatures(baseConfig, selected) {
  const enabled = selected.length > 0;
  return {
    ...baseConfig,
    enabled,
    warnAtTokens: selected.includes('warnings') ? baseConfig.warnAtTokens : Number.MAX_SAFE_INTEGER,
    compactAtTokens: selected.includes('warnings') ? baseConfig.compactAtTokens : Number.MAX_SAFE_INTEGER,
    saveHandoff: selected.includes('handoffs'),
    sessionRotation: selected.includes('warnings'),
    claude: {
      ...baseConfig.claude,
      enabled,
    },
  };
}

function installClaudeSaveTokens(repoPath, summaryLines) {
  const hooksDir = join(repoPath, '.claude', 'hooks');
  mkdirSync(hooksDir, { recursive: true });

  for (const hook of CLAUDE_SAVE_TOKENS_HOOKS) {
    const src = join(TEMPLATES_DIR, hook.src);
    const dest = join(repoPath, hook.dest);
    const existed = existsSync(dest);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    if (hook.chmod) chmodSync(dest, 0o755);
    summaryLines.push(`${existed ? pc.yellow('~') : pc.green('+')} ${hook.dest}`);
  }

  const settingsPath = join(repoPath, '.claude', 'settings.json');
  const existingSettings = readJsonFile(settingsPath, summaryLines, '.claude/settings.json');
  const statusLineInstalled = canInstallSaveTokensStatusLine(existingSettings);

  if (existingSettings && !existsSync(settingsPath + '.bak')) {
    writeFileSync(settingsPath + '.bak', JSON.stringify(existingSettings, null, 2) + '\n', 'utf8');
    summaryLines.push(`${pc.green('+')} .claude/settings.json.bak`);
  }

  const merged = mergeSettings(existingSettings, buildSaveTokensSettings());
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  summaryLines.push(`${existingSettings ? pc.yellow('~') : pc.green('+')} .claude/settings.json`);

  const commands = ['save-handoff.md', 'resume-handoff-latest.md', 'resume-handoff.md'];
  for (const cmd of commands) {
    const src = join(TEMPLATES_DIR, 'commands', cmd);
    const dest = join(repoPath, '.claude', 'commands', cmd);
    const existed = existsSync(dest);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    summaryLines.push(`${existed ? pc.yellow('~') : pc.green('+')} .claude/commands/${cmd}`);
  }

  return { statusLineInstalled };
}

function readJsonFile(path, summaryLines, label) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    summaryLines.push(`${pc.yellow('!')} ${label} (invalid JSON; left unchanged)`);
    return null;
  }
}

function canInstallSaveTokensStatusLine(settings) {
  if (!settings?.statusLine) return true;
  return String(settings.statusLine.command || '').includes('save-tokens-statusline');
}

function applyStatusLineAvailability(config, statusLineInstalled, summaryLines) {
  if (statusLineInstalled) return config;
  config.warnAtTokens = Number.MAX_SAFE_INTEGER;
  config.compactAtTokens = Number.MAX_SAFE_INTEGER;
  config.sessionRotation = false;
  summaryLines.push(`${pc.yellow('!')} save-tokens token warnings disabled (custom Claude statusLine is already configured)`);
  return config;
}

function removeSaveTokens(repoPath, existingConfig) {
  const summaryLines = [];
  const filesToRemove = [
    '.claude/hooks/save-tokens-lib.mjs',
    '.claude/hooks/save-tokens.mjs',
    '.claude/hooks/save-tokens-statusline.sh',
    '.claude/hooks/save-tokens-statusline.mjs',
    '.claude/hooks/save-tokens-prompt-guard.sh',
    '.claude/hooks/save-tokens-prompt-guard.mjs',
    '.claude/hooks/save-tokens-precompact.sh',
    '.claude/hooks/save-tokens-precompact.mjs',
    '.claude/commands/save-handoff.md',
    '.claude/commands/resume-handoff-latest.md',
    '.claude/commands/resume-handoff.md',
    '.claude/commands/save-tokens-resume.md',
  ];

  for (const rel of filesToRemove) {
    const full = join(repoPath, rel);
    if (!existsSync(full)) continue;
    rmSync(full, { force: true });
    summaryLines.push(`${pc.red('-')} ${rel}`);
  }

  const settingsPath = join(repoPath, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const cleaned = removeSaveTokensFromSettings(settings);
      writeFileSync(settingsPath, JSON.stringify(cleaned, null, 2) + '\n', 'utf8');
      summaryLines.push(`${pc.yellow('~')} .claude/settings.json`);
    } catch {
      summaryLines.push(`${pc.yellow('!')} .claude/settings.json (invalid JSON; left unchanged)`);
    }
  }

  if (existingConfig) {
    writeConfig(repoPath, {
      targets: existingConfig.targets,
      backend: existingConfig.backend,
      saveTokens: null,
    });
    summaryLines.push(`${pc.yellow('~')} .aspens.json`);
  }

  console.log();
  for (const line of summaryLines) {
    console.log(`  ${line}`);
  }
  if (summaryLines.length === 0) {
    console.log(pc.dim('  No save-tokens installation found.'));
  }
  console.log();
}

function removeSaveTokensFromSettings(settings) {
  const cleaned = JSON.parse(JSON.stringify(settings));
  if (cleaned.statusLine?.command?.includes('save-tokens-statusline')) {
    delete cleaned.statusLine;
  }

  for (const [eventName, entries] of Object.entries(cleaned.hooks || {})) {
    if (!Array.isArray(entries)) continue;
    cleaned.hooks[eventName] = entries
      .map(entry => ({
        ...entry,
        hooks: (entry.hooks || []).filter(hook => !String(hook.command || '').includes('save-tokens-')),
      }))
      .filter(entry => (entry.hooks || []).length > 0);
  }

  return cleaned;
}
