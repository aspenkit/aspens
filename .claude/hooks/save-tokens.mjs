import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_CONFIG = {
  enabled: true,
  warnAtTokens: 175000,
  compactAtTokens: 200000,
  saveHandoff: true,
  sessionRotation: true,
};

export function getProjectDir() {
  return process.env.ASPENS_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

export function loadSaveTokensConfig(projectDir) {
  const path = join(projectDir, '.aspens.json');
  if (!existsSync(path)) return DEFAULT_CONFIG;

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      ...(parsed?.saveTokens || {}),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function readHookInput() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function readClaudeContextTelemetry(projectDir, maxAgeMs = 300000) {
  const path = join(projectDir, '.aspens', 'sessions', 'claude-context.json');
  if (!existsSync(path)) return null;

  try {
    const telemetry = JSON.parse(readFileSync(path, 'utf8'));
    if (!telemetry?.recordedAt) return null;
    if (Date.now() - Date.parse(telemetry.recordedAt) > maxAgeMs) return null;
    if (!Number.isInteger(telemetry.currentContextTokens) || telemetry.currentContextTokens < 0) return null;
    return telemetry;
  } catch {
    return null;
  }
}

export function recordClaudeContextTelemetry(projectDir, input = {}) {
  const sessionsDir = join(projectDir, '.aspens', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });

  const currentUsage = input.context_window?.current_usage || null;
  const currentContextTokens = currentUsage
    ? sumInputContextTokens(currentUsage)
    : 0;

  const telemetry = {
    recordedAt: new Date().toISOString(),
    sessionId: input.session_id || input.sessionId || null,
    transcriptPath: input.transcript_path || input.transcriptPath || null,
    contextWindowSize: input.context_window?.context_window_size || null,
    usedPercentage: input.context_window?.used_percentage ?? null,
    currentContextTokens,
    exceeds200kTokens: !!input.exceeds_200k_tokens,
    currentUsage,
  };

  writeFileSync(join(sessionsDir, 'claude-context.json'), JSON.stringify(telemetry, null, 2) + '\n', 'utf8');
  return telemetry;
}

export function sessionTokenSnapshot(projectDir, input = {}) {
  const telemetry = readClaudeContextTelemetry(projectDir);
  if (telemetry) {
    return {
      tokens: telemetry.currentContextTokens,
      source: 'claude-statusline',
      telemetry,
    };
  }

  return {
    tokens: null,
    source: 'missing-claude-statusline',
    telemetry: null,
  };
}

export function saveHandoff(projectDir, input = {}, reason = 'limit') {
  const sessionsDir = join(projectDir, '.aspens', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const relativePath = join('.aspens', 'sessions', `${stamp}-claude-handoff.md`);
  const handoffPath = join(projectDir, relativePath);
  const snapshot = sessionTokenSnapshot(projectDir, input);
  const tokenCount = Number.isInteger(snapshot.tokens) ? snapshot.tokens : null;
  const tokenLabel = tokenCount === null ? 'unknown' : `~${tokenCount.toLocaleString()}`;
  const prompt = extractPrompt(input);
  const transcriptExcerpt = readTranscriptExcerpt(input);

  const lines = [
    '# Claude save-tokens handoff',
    '',
    `- Saved: ${now.toISOString()}`,
    `- Reason: ${reason}`,
    `- Session tokens: ${tokenLabel} (${snapshot.source})`,
  ];

  if (input.cwd) {
    lines.push(`- Working directory: ${input.cwd}`);
  }

  lines.push('');

  if (prompt) {
    lines.push('## Latest prompt');
    lines.push('');
    lines.push(prompt);
    lines.push('');
  }

  if (transcriptExcerpt) {
    lines.push('## Recent transcript excerpt');
    lines.push('');
    lines.push('```text');
    lines.push(transcriptExcerpt);
    lines.push('```');
    lines.push('');
  }

  writeFileSync(handoffPath, lines.join('\n'), 'utf8');
  writeLatestIndex(projectDir, relativePath, now.toISOString(), reason, tokenCount);
  pruneOldHandoffs(projectDir);
  return relativePath;
}

export function latestHandoff(projectDir) {
  const sessionsDir = join(projectDir, '.aspens', 'sessions');
  if (!existsSync(sessionsDir)) return null;

  const entries = readdirSync(sessionsDir)
    .filter(name => name.endsWith('-handoff.md'))
    .sort()
    .reverse();

  return entries[0] ? join('.aspens', 'sessions', entries[0]) : null;
}

const MAX_HANDOFFS = 10;

export function pruneOldHandoffs(projectDir, keep = MAX_HANDOFFS) {
  const sessionsDir = join(projectDir, '.aspens', 'sessions');
  if (!existsSync(sessionsDir)) return;

  const handoffs = readdirSync(sessionsDir)
    .filter(name => name.endsWith('-handoff.md'))
    .sort()
    .reverse();

  for (const name of handoffs.slice(keep)) {
    try { unlinkSync(join(sessionsDir, name)); } catch { /* ignore */ }
  }
}

export function runStatusline() {
  const input = readHookInput();
  const projectDir = getProjectDir();
  const config = loadSaveTokensConfig(projectDir);
  const telemetry = recordClaudeContextTelemetry(projectDir, input);

  if (telemetry.currentContextTokens > 0) {
    process.stdout.write(`save-tokens ${formatTokens(telemetry.currentContextTokens)}/${formatTokens(config.compactAtTokens)}`);
  }
}

export function runPromptGuard() {
  const input = readHookInput();
  const projectDir = getProjectDir();
  const config = loadSaveTokensConfig(projectDir);

  if (!config.enabled || config.claude?.enabled === false) {
    return 0;
  }
  if (config.warnAtTokens === Number.MAX_SAFE_INTEGER && config.compactAtTokens === Number.MAX_SAFE_INTEGER) {
    return 0;
  }

  const snapshot = sessionTokenSnapshot(projectDir, input);
  const currentTokens = snapshot.tokens;

  if (!Number.isInteger(currentTokens)) {
    console.error(
      'save-tokens: Claude token telemetry is unavailable. ' +
      'Open an issue if this persists: https://github.com/aspenkit/aspens/issues'
    );
    return 0;
  }

  if (currentTokens >= config.compactAtTokens) {
    const handoffPath = config.saveHandoff
      ? saveHandoff(projectDir, input, config.sessionRotation ? 'rotation-threshold' : 'compact-threshold')
      : null;

    const lines = [
      `save-tokens: current context is ${formatTokens(currentTokens)}/${formatTokens(config.compactAtTokens)}.`,
    ];
    if (handoffPath) {
      lines.push(`Handoff saved: ${handoffPath}`);
    }
    lines.push('');
    lines.push('Recommended:');
    lines.push('1. Run /save-handoff to save a rich summary');
    lines.push('2. Start a fresh Claude session');
    lines.push('3. Run /resume-handoff-latest to continue');
    lines.push('');
    lines.push('Alternative:');
    lines.push('Continue here, or run /compact if you prefer to compact this session.');

    console.error(lines.join('\n'));
    return 0;
  }

  if (currentTokens >= config.warnAtTokens) {
    console.error(
      `save-tokens: current context is ${formatTokens(currentTokens)}/${formatTokens(config.compactAtTokens)}. ` +
      'Consider running /save-handoff soon.'
    );
  }

  return 0;
}

export function runPrecompact() {
  const input = readHookInput();
  const projectDir = getProjectDir();
  const config = loadSaveTokensConfig(projectDir);

  if (!config.enabled || config.claude?.enabled === false || !config.saveHandoff) {
    return 0;
  }

  const handoffPath = saveHandoff(projectDir, input, 'precompact');
  console.error(`save-tokens: handoff saved before compact to ${handoffPath}.`);
  return 0;
}

function writeLatestIndex(projectDir, relativePath, savedAt, reason, tokens) {
  const indexPath = join(projectDir, '.aspens', 'sessions', 'index.json');
  const payload = {
    latest: relativePath,
    savedAt,
    reason,
    tokens,
  };
  writeFileSync(indexPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function extractPrompt(input) {
  return input.prompt || input.user_prompt || input.message || '';
}

function readTranscriptExcerpt(input) {
  const transcriptPath = input.transcript_path || input.transcriptPath || '';
  if (!transcriptPath || !existsSync(transcriptPath)) return '';

  try {
    const content = readFileSync(transcriptPath, 'utf8');
    return content.slice(-4000);
  } catch {
    return '';
  }
}

function sumInputContextTokens(currentUsage) {
  return [
    currentUsage.input_tokens,
    currentUsage.cache_creation_input_tokens,
    currentUsage.cache_read_input_tokens,
    currentUsage.output_tokens,
  ].reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function formatTokens(value) {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function main() {
  const command = process.argv[2];
  if (command === 'statusline') {
    runStatusline();
    return process.exit(0);
  }
  if (command === 'prompt-guard') return process.exit(runPromptGuard());
  if (command === 'precompact') return process.exit(runPrecompact());
  console.error('save-tokens: expected command: statusline, prompt-guard, or precompact');
  return process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
