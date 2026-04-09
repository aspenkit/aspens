import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  latestHandoff,
  pruneOldHandoffs,
  readClaudeContextTelemetry,
  recordClaudeContextTelemetry,
  saveHandoff,
  sessionTokenSnapshot,
} from '../src/templates/hooks/save-tokens.mjs';

const TEST_DIR = join(import.meta.dirname, 'tmp-save-tokens-hooks');
const EXTERNAL_DIR = join(import.meta.dirname, 'tmp-save-tokens-external');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  if (existsSync(EXTERNAL_DIR)) rmSync(EXTERNAL_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(EXTERNAL_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  if (existsSync(EXTERNAL_DIR)) rmSync(EXTERNAL_DIR, { recursive: true, force: true });
});

describe('save-tokens hook telemetry', () => {
  it('records current Claude context usage from statusLine input', () => {
    const telemetry = recordClaudeContextTelemetry(TEST_DIR, {
      session_id: 'session-1',
      context_window: {
        context_window_size: 200000,
        used_percentage: 56.5,
        current_usage: {
          input_tokens: 100000,
          cache_creation_input_tokens: 5000,
          cache_read_input_tokens: 7000,
          output_tokens: 3000,
        },
      },
    });

    expect(telemetry.currentContextTokens).toBe(115000);
    expect(readClaudeContextTelemetry(TEST_DIR).currentContextTokens).toBe(115000);
  });

  it('treats stale Claude telemetry as unavailable', () => {
    const sessionsDir = join(TEST_DIR, '.aspens', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'claude-context.json'), JSON.stringify({
      recordedAt: new Date(Date.now() - 301000).toISOString(),
      currentContextTokens: 112000,
    }), 'utf8');

    expect(readClaudeContextTelemetry(TEST_DIR)).toBeNull();
  });

  it('prefers Claude statusLine telemetry for token snapshots', () => {
    recordClaudeContextTelemetry(TEST_DIR, {
      context_window: {
        current_usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
        },
      },
    });

    const snapshot = sessionTokenSnapshot(TEST_DIR, { prompt: 'ignored prompt text' });
    expect(snapshot.source).toBe('claude-statusline');
    expect(snapshot.tokens).toBe(60);
  });

  it('does not estimate tokens when telemetry is missing', () => {
    const snapshot = sessionTokenSnapshot(TEST_DIR, {
      prompt: 'large prompt',
    });

    expect(snapshot.source).toBe('missing-claude-statusline');
    expect(snapshot.tokens).toBeNull();
  });

  it('saves handoffs with unknown tokens when telemetry is missing', () => {
    const handoffPath = saveHandoff(TEST_DIR, {
      prompt: 'continue the checkout task',
    }, 'precompact');

    const content = readFileSync(join(TEST_DIR, handoffPath), 'utf8');
    expect(content).toContain('- Session tokens: unknown (missing-claude-statusline)');
    expect(content).toContain('```text\ncontinue the checkout task\n```');
    expect(content).toContain('continue the checkout task');
  });

  it('ignores transcript paths outside the project directory', () => {
    const sessionsDir = join(TEST_DIR, '.aspens', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const externalTranscript = join(EXTERNAL_DIR, 'external-transcript.jsonl');
    writeFileSync(externalTranscript, 'SECRET_TRANSCRIPT\n', 'utf8');

    const handoffPath = saveHandoff(TEST_DIR, {
      prompt: 'continue',
      transcript_path: externalTranscript,
    }, 'precompact');

    const content = readFileSync(join(TEST_DIR, handoffPath), 'utf8');
    expect(content).not.toContain('SECRET_TRANSCRIPT');
    expect(content).not.toContain('## Recent transcript excerpt');
  });

  it('includes transcript excerpts from inside the project directory', () => {
    const transcriptPath = join(TEST_DIR, 'transcript.jsonl');
    writeFileSync(transcriptPath, 'SAFE_TRANSCRIPT\n', 'utf8');

    const handoffPath = saveHandoff(TEST_DIR, {
      prompt: 'continue',
      transcript_path: transcriptPath,
    }, 'precompact');

    const content = readFileSync(join(TEST_DIR, handoffPath), 'utf8');
    expect(content).toContain('SAFE_TRANSCRIPT');
  });

  it('finds the newest handoff and ignores README markdown', () => {
    const sessionsDir = join(TEST_DIR, '.aspens', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'README.md'), '# readme\n', 'utf8');
    writeFileSync(join(sessionsDir, '2026-01-01T00-00-00-000Z-claude-handoff.md'), 'old\n', 'utf8');
    writeFileSync(join(sessionsDir, '2026-02-01T00-00-00-000Z-claude-handoff.md'), 'new\n', 'utf8');

    expect(latestHandoff(TEST_DIR)).toBe(join('.aspens', 'sessions', '2026-02-01T00-00-00-000Z-claude-handoff.md'));
  });

  it('prunes old handoffs without removing session support files', () => {
    const sessionsDir = join(TEST_DIR, '.aspens', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, '.gitignore'), '*\n', 'utf8');
    writeFileSync(join(sessionsDir, 'README.md'), '# readme\n', 'utf8');
    writeFileSync(join(sessionsDir, 'note.md'), '# user note\n', 'utf8');

    for (let i = 0; i < 12; i += 1) {
      const day = String(i + 1).padStart(2, '0');
      writeFileSync(join(sessionsDir, `2026-01-${day}T00-00-00-000Z-claude-handoff.md`), `${day}\n`, 'utf8');
    }

    pruneOldHandoffs(TEST_DIR, 10);

    expect(existsSync(join(sessionsDir, '.gitignore'))).toBe(true);
    expect(existsSync(join(sessionsDir, 'README.md'))).toBe(true);
    expect(existsSync(join(sessionsDir, 'note.md'))).toBe(true);
    expect(existsSync(join(sessionsDir, '2026-01-01T00-00-00-000Z-claude-handoff.md'))).toBe(false);
    expect(existsSync(join(sessionsDir, '2026-01-02T00-00-00-000Z-claude-handoff.md'))).toBe(false);
    expect(existsSync(join(sessionsDir, '2026-01-12T00-00-00-000Z-claude-handoff.md'))).toBe(true);
  });
});
