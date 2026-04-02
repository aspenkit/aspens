/**
 * Generation backend abstraction — detects and manages LLM backends.
 *
 * Backend = what generates the content (claude CLI, codex CLI)
 * Target  = where the output goes (claude, codex, all)
 *
 * Default: backend matches target. Users can override with --backend.
 */

import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Backend definitions
// ---------------------------------------------------------------------------

export const BACKENDS = {
  claude: {
    id: 'claude',
    label: 'Claude CLI',
    command: 'claude',
    detectArgs: '--version',
    installUrl: 'https://docs.anthropic.com/claude-code',
  },
  codex: {
    id: 'codex',
    label: 'Codex CLI',
    command: 'codex',
    detectArgs: '--version',
    installUrl: 'https://github.com/openai/codex',
  },
};

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Check if a CLI command is available on the system.
 * @param {string} command
 * @param {string} args
 * @returns {boolean}
 */
function isCommandAvailable(command, args) {
  try {
    execSync(`${command} ${args}`, { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect which backends are installed.
 * @returns {{ claude: boolean, codex: boolean }}
 */
export function detectAvailableBackends() {
  return {
    claude: isCommandAvailable(BACKENDS.claude.command, BACKENDS.claude.detectArgs),
    codex: isCommandAvailable(BACKENDS.codex.command, BACKENDS.codex.detectArgs),
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve which backend to use.
 *
 * Priority:
 * 1. Explicit --backend flag
 * 2. Match target (claude target → claude backend, codex target → codex backend)
 * 3. Whatever is available
 *
 * @param {object} options
 * @param {string} [options.backendFlag] — explicit --backend value
 * @param {string} [options.targetId] — the chosen target id
 * @param {{ claude: boolean, codex: boolean }} options.available — detection result
 * @returns {{ backend: object, warning: string|null }}
 */
export function resolveBackend({ backendFlag, targetId, available }) {
  // Explicit flag wins
  if (backendFlag) {
    const backend = BACKENDS[backendFlag];
    if (!backend) {
      throw new Error(`Unknown backend: "${backendFlag}". Valid backends: ${Object.keys(BACKENDS).join(', ')}`);
    }
    if (!available[backendFlag]) {
      throw new Error(
        `${backend.label} is not installed. Install it: ${backend.installUrl}`
      );
    }
    return { backend, warning: null };
  }

  // Match target
  if (targetId && targetId !== 'all') {
    const matchingBackend = BACKENDS[targetId];
    if (matchingBackend && available[targetId]) {
      return { backend: matchingBackend, warning: null };
    }

    // Matching backend not available — fall back to the other
    const fallbackId = targetId === 'claude' ? 'codex' : 'claude';
    if (available[fallbackId]) {
      const fallback = BACKENDS[fallbackId];
      const missing = BACKENDS[targetId];
      return {
        backend: fallback,
        warning: `${missing.label} not found. Using ${fallback.label} to generate ${targetId} output. For best results, install ${missing.label}: ${missing.installUrl}`,
      };
    }
  }

  // No target preference or target is 'all' — use whatever is available
  if (available.claude) return { backend: BACKENDS.claude, warning: null };
  if (available.codex) return { backend: BACKENDS.codex, warning: null };

  // Neither available
  throw new Error(
    'aspens requires either Claude CLI or Codex CLI.\n' +
    `  Install Claude CLI: ${BACKENDS.claude.installUrl}\n` +
    `  Install Codex CLI: ${BACKENDS.codex.installUrl}`
  );
}
