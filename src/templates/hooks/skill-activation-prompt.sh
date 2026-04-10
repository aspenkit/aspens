#!/bin/bash
# Skill Activation Prompt Hook — Shell Wrapper
# Called by Claude Code on every UserPromptSubmit.
# Captures stdin, runs the Node.js matching engine, separates stdout/stderr.
# Always exits 0 — NEVER blocks the user's prompt.
#
# Note: No set -e — hook failures must not block prompts.

# ---------------------------------------------------------------------------
# Debug logging (opt-in via ASPENS_DEBUG=1 to avoid leaking prompt data)
# ---------------------------------------------------------------------------
log_debug() {
    if [ "$ASPENS_DEBUG" = "1" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "${TMPDIR:-/tmp}/claude-skill-hook-debug-$(id -u).log"
    fi
}

log_debug "HOOK SCRIPT STARTED - PID $$"

# ---------------------------------------------------------------------------
# Resolve script directory (handles symlinks — essential for hub support)
# ---------------------------------------------------------------------------
get_script_dir() {
    local source="${BASH_SOURCE[0]}"
    while [ -h "$source" ]; do
        local dir="$(cd -P "$(dirname "$source")" && pwd)"
        source="$(readlink "$source")"
        [[ $source != /* ]] && source="$dir/$source"
    done
    cd -P "$(dirname "$source")" && pwd
}

SCRIPT_DIR="$(get_script_dir)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
log_debug "SCRIPT_DIR=$SCRIPT_DIR"
log_debug "CLAUDE_PROJECT_DIR=$CLAUDE_PROJECT_DIR"
log_debug "ASPENS_PROJECT_DIR=$PROJECT_DIR"

cd "$SCRIPT_DIR" || { echo "⚡ [Skills] Failed to cd to $SCRIPT_DIR" >&2; exit 0; }

# ---------------------------------------------------------------------------
# Capture stdin
# ---------------------------------------------------------------------------
INPUT=$(cat)
log_debug "Input received: ${INPUT:0:200}..."

# ---------------------------------------------------------------------------
# Run matching engine with clean stdout/stderr separation
# ---------------------------------------------------------------------------
STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)
trap 'rm -f "$STDOUT_FILE" "$STDERR_FILE"' EXIT

printf '%s' "$INPUT" | ASPENS_PROJECT_DIR="$PROJECT_DIR" NODE_NO_WARNINGS=1 node skill-activation-prompt.mjs \
    >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?

log_debug "Exit code: $EXIT_CODE"
log_debug "Stderr: $(cat "$STDERR_FILE" 2>/dev/null | head -5)"

# ---------------------------------------------------------------------------
# Terminal status output (stderr — visible in verbose mode via Ctrl+O)
# ---------------------------------------------------------------------------
if [ $EXIT_CODE -ne 0 ]; then
    echo "⚡ [Skills] Hook error (exit $EXIT_CODE)" >&2
    log_debug "ERROR: Hook failed with exit code $EXIT_CODE"
else
    SKILL_LINE=$(grep -o '\[Skills\] Activated: [^"]*' "$STDERR_FILE" | head -1)
    if [ -n "$SKILL_LINE" ]; then
        echo "⚡ $SKILL_LINE" >&2
    else
        echo "⚡ [Skills] No skills matched" >&2
    fi
fi

# ---------------------------------------------------------------------------
# Emit pristine stdout (injected into Claude's context)
# ---------------------------------------------------------------------------
cat "$STDOUT_FILE"

exit 0
