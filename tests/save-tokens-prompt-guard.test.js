import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { recordClaudeContextTelemetry } from '../src/templates/hooks/save-tokens.mjs';

const TEST_DIR = join(import.meta.dirname, 'tmp-save-tokens-prompt-guard');
const SAVE_TOKENS_SCRIPT = join(import.meta.dirname, '..', 'src', 'templates', 'hooks', 'save-tokens.mjs');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('save-tokens prompt guard', () => {
  it('warns without blocking when Claude token telemetry is missing', () => {
    const result = runGuard({ prompt: 'hello' });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Claude token telemetry is unavailable');
  });

  it('warns without blocking above the warning threshold', () => {
    writeTelemetry(176000);

    const result = runGuard({ prompt: 'continue' });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('current context is 176k/200k');
    expect(result.stderr).toContain('/save-handoff');
  });

  it('warns strongly and saves a handoff above the compact threshold', () => {
    writeTelemetry(201000);

    const result = runGuard({ prompt: 'continue' });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('current context is 201k/200k');
    expect(result.stderr).toContain('Handoff saved: .aspens/sessions/');
    expect(result.stderr).toContain('/resume-handoff-latest');
  });
});

function writeTelemetry(inputTokens) {
  recordClaudeContextTelemetry(TEST_DIR, {
    context_window: {
      current_usage: {
        input_tokens: inputTokens,
      },
    },
  });
}

function runGuard(input) {
  return spawnSync(process.execPath, [SAVE_TOKENS_SCRIPT, 'prompt-guard'], {
    cwd: TEST_DIR,
    env: {
      ...process.env,
      ASPENS_PROJECT_DIR: TEST_DIR,
    },
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}
