import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveTimeout } from '../src/lib/timeout.js';

describe('resolveTimeout', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = process.env.ASPENS_TIMEOUT;
    delete process.env.ASPENS_TIMEOUT;
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.ASPENS_TIMEOUT = savedEnv;
    } else {
      delete process.env.ASPENS_TIMEOUT;
    }
  });

  it('flag wins over env var', () => {
    process.env.ASPENS_TIMEOUT = '999';
    const { timeoutMs } = resolveTimeout(60, 120);
    expect(timeoutMs).toBe(60000);
  });

  it('env var wins over fallback', () => {
    process.env.ASPENS_TIMEOUT = '200';
    const { timeoutMs } = resolveTimeout(undefined, 120);
    expect(timeoutMs).toBe(200000);
  });

  it('falls back to default when neither flag nor env set', () => {
    const { timeoutMs, envWarning } = resolveTimeout(undefined, 300);
    expect(timeoutMs).toBe(300000);
    expect(envWarning).toBe(false);
  });

  it('converts seconds to milliseconds', () => {
    const { timeoutMs } = resolveTimeout(45, 120);
    expect(timeoutMs).toBe(45000);
  });

  it('returns envWarning when env var is NaN', () => {
    process.env.ASPENS_TIMEOUT = 'abc';
    const { timeoutMs, envWarning } = resolveTimeout(undefined, 120);
    expect(envWarning).toBe(true);
    expect(timeoutMs).toBe(120000);
  });

  it('returns envWarning when env var is negative', () => {
    process.env.ASPENS_TIMEOUT = '-5';
    const { timeoutMs, envWarning } = resolveTimeout(undefined, 120);
    expect(envWarning).toBe(true);
    expect(timeoutMs).toBe(120000);
  });

  it('returns envWarning when env var is zero', () => {
    process.env.ASPENS_TIMEOUT = '0';
    const { timeoutMs, envWarning } = resolveTimeout(undefined, 120);
    expect(envWarning).toBe(true);
    expect(timeoutMs).toBe(120000);
  });

  it('ignores flag when value is not a positive number', () => {
    const { timeoutMs } = resolveTimeout(0, 120);
    expect(timeoutMs).toBe(120000);
  });

  it('ignores flag when value is negative', () => {
    const { timeoutMs } = resolveTimeout(-10, 120);
    expect(timeoutMs).toBe(120000);
  });
});
