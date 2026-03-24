/**
 * Resolve timeout from multiple sources with consistent priority:
 *   --timeout flag > ASPENS_TIMEOUT env var > fallback default
 *
 * @param {number|undefined} flagValue   Value from --timeout option
 * @param {number} fallbackSeconds       Default if neither flag nor env set
 * @returns {{ timeoutMs: number, envWarning: boolean }}
 */
export function resolveTimeout(flagValue, fallbackSeconds) {
  // --timeout flag wins
  if (typeof flagValue === 'number' && flagValue > 0) {
    return { timeoutMs: flagValue * 1000, envWarning: false };
  }

  // ASPENS_TIMEOUT env var
  if (process.env.ASPENS_TIMEOUT) {
    const parsed = parseInt(process.env.ASPENS_TIMEOUT, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { timeoutMs: parsed * 1000, envWarning: false };
    }
    // Invalid env value — fall through to default, signal a warning
    return { timeoutMs: fallbackSeconds * 1000, envWarning: true };
  }

  return { timeoutMs: fallbackSeconds * 1000, envWarning: false };
}
