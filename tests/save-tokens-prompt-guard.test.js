import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';

const TEST_DIR = join(import.meta.dirname, 'tmp-save-tokens-prompt-guard');
const SAVE_TOKENS_SCRIPT = join(import.meta.dirname, '..', 'src', 'templates', 'hooks', 'save-tokens.mjs');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe.sequential('save-tokens prompt guard', () => {
  it('exits successfully when running the statusline command', () => {
    const result = spawnSync(process.execPath, [SAVE_TOKENS_SCRIPT, 'statusline'], {
      cwd: TEST_DIR,
      env: {
        ...process.env,
        ASPENS_PROJECT_DIR: TEST_DIR,
      },
      input: JSON.stringify({
        context_window: {
          current_usage: { input_tokens: 123 },
        },
      }),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('save-tokens 123/200k');
  });

  it('warns without blocking when Claude token telemetry is missing', () => {
    const result = runGuard({ prompt: 'hello' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Claude token telemetry is unavailable');
  });

  it('warns without blocking above the warning threshold', () => {
    writeTelemetry(176000);

    const result = runGuard({ prompt: 'continue' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('current context is 176k/200k');
    expect(result.stdout).toContain('/save-handoff');
  });

  it('warns strongly and saves a handoff above the compact threshold', () => {
    writeTelemetry(201000);

    const result = runGuard({ prompt: 'continue' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('current context is 201k/200k');
    expect(result.stdout).toContain('Handoff saved: .aspens/sessions/');
    expect(result.stdout).toContain('/resume-handoff-latest');
  });
});

function writeTelemetry(inputTokens) {
  const result = spawnSync(process.execPath, [SAVE_TOKENS_SCRIPT, 'statusline'], {
    cwd: TEST_DIR,
    env: {
      ...process.env,
      ASPENS_PROJECT_DIR: TEST_DIR,
    },
    input: JSON.stringify({
      context_window: {
        current_usage: {
          input_tokens: inputTokens,
        },
      },
    }),
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
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
