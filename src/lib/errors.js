/**
 * Error thrown by command handlers for expected failures (validation, missing prereqs, etc.).
 * Caught at the top level in cli.js — avoids scattered process.exit() calls.
 */
export class CliError extends Error {
  /**
   * @param {string} message
   * @param {{ exitCode?: number, logged?: boolean }} options
   *   - exitCode: process exit code (default 1)
   *   - logged: if true, the top-level handler won't re-print the message
   */
  constructor(message, { exitCode = 1, logged = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.logged = logged;
  }
}
