import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve, relative } from 'path';
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
  const facts = extractSessionFacts(projectDir, input);

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
  if (facts.branch) {
    lines.push(`- Branch: ${facts.branch}`);
  }

  lines.push('');
  lines.push('## Task summary');
  lines.push('');
  if (facts.originalTask) {
    lines.push(facts.originalTask);
  } else {
    lines.push('(no task captured)');
  }

  lines.push('');
  lines.push('## Files modified');
  lines.push('');
  if (facts.filesModified.length > 0) {
    for (const f of facts.filesModified) lines.push(`- ${f}`);
  } else {
    lines.push('(none detected)');
  }

  lines.push('');
  lines.push('## Git commits');
  lines.push('');
  if (facts.gitCommits.length > 0) {
    for (const c of facts.gitCommits) lines.push(`- ${c}`);
  } else {
    lines.push('(none)');
  }

  if (facts.recentPrompts.length > 0) {
    lines.push('');
    lines.push('## Recent prompts');
    lines.push('');
    for (const p of facts.recentPrompts) {
      lines.push(`- ${p}`);
    }
  }

  lines.push('');

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

  if (!config.enabled) return;

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
    // stdout → injected into Claude's context as a system message
    console.log(
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
    lines.push('IMPORTANT — you must tell the user:');
    lines.push('1. Start a fresh Claude session');
    lines.push('2. Run /resume-handoff-latest to continue');
    lines.push('');
    lines.push('Or run /save-handoff first for a richer summary with current state and next steps.');

    // stdout → injected into Claude's context as a system message
    console.log(lines.join('\n'));
    return 0;
  }

  if (currentTokens >= config.warnAtTokens) {
    // stdout → injected into Claude's context as a system message
    console.log(
      `save-tokens: current context is ${formatTokens(currentTokens)}/${formatTokens(config.compactAtTokens)}. ` +
      'Tell the user to consider running /save-handoff soon.'
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
  console.log(`save-tokens: handoff saved before compact to ${handoffPath}.`);
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

const MAX_TASK_CHARS = 500;
const MAX_PROMPT_CHARS = 200;
const MAX_RECENT_PROMPTS = 3;

function extractSessionFacts(projectDir, input) {
  const facts = {
    originalTask: '',
    recentPrompts: [],
    filesModified: [],
    gitCommits: [],
    branch: '',
  };

  const transcriptPath = input.transcript_path || input.transcriptPath || '';
  const resolvedTranscriptPath = transcriptPath ? resolve(projectDir, transcriptPath) : '';
  const transcriptRelPath = resolvedTranscriptPath ? relative(projectDir, resolvedTranscriptPath) : '';
  const transcriptInsideProject = transcriptRelPath === '' || (!transcriptRelPath.startsWith('..') && !transcriptRelPath.startsWith('/') && !transcriptRelPath.includes('..\\'));

  if (!resolvedTranscriptPath || !transcriptInsideProject || !existsSync(resolvedTranscriptPath)) {
    // Fallback: use prompt field as task summary when no transcript available
    const prompt = input.prompt || input.user_prompt || input.message || '';
    if (prompt) {
      facts.originalTask = prompt.length > MAX_TASK_CHARS
        ? prompt.slice(0, MAX_TASK_CHARS) + '...'
        : prompt;
    }
    return facts;
  }

  try {
    const content = readFileSync(resolvedTranscriptPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);

    const userMessages = [];
    const editedFiles = new Set();
    const commits = [];

    for (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }

      // Extract branch from user records
      if (record.type === 'user' && record.gitBranch && !facts.branch) {
        facts.branch = record.gitBranch;
      }

      // Extract user messages
      if (record.type === 'user' && record.message?.content) {
        const text = typeof record.message.content === 'string'
          ? record.message.content
          : record.message.content
              .filter(b => b.type === 'text')
              .map(b => b.text)
              .join('\n');
        if (text.trim()) userMessages.push(text.trim());
      }

      // Extract files modified from tool_use blocks in assistant messages
      if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
        for (const block of record.message.content) {
          if (block.type !== 'tool_use') continue;
          if ((block.name === 'Edit' || block.name === 'Write') && block.input?.file_path) {
            editedFiles.add(block.input.file_path);
          }
        }
      }

      // Extract git commits from Bash tool calls
      if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
        for (const block of record.message.content) {
          if (block.type !== 'tool_use' || block.name !== 'Bash') continue;
          const cmd = block.input?.command || '';
          if (/git\s+commit/.test(cmd)) {
            const msgMatch = cmd.match(/-m\s+["']([^"']+)["']/);
            commits.push(msgMatch ? msgMatch[1] : '(commit)');
          }
        }
      }
    }

    // First user message = original task
    if (userMessages.length > 0) {
      const task = userMessages[0];
      facts.originalTask = task.length > MAX_TASK_CHARS
        ? task.slice(0, MAX_TASK_CHARS) + '...'
        : task;
    }

    // Last N user messages as recent prompts (skip the first one since it's the task)
    const recent = userMessages.slice(-MAX_RECENT_PROMPTS);
    facts.recentPrompts = recent.map(p =>
      p.length > MAX_PROMPT_CHARS ? p.slice(0, MAX_PROMPT_CHARS) + '...' : p
    );

    facts.filesModified = [...editedFiles];
    facts.gitCommits = commits;
  } catch {
    // If transcript parsing fails, return empty facts
  }

  return facts;
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
