#!/bin/bash
# Graph Context Prompt Hook — Shell Wrapper
# Called by Claude Code on every UserPromptSubmit.
# Loads the persisted import graph, extracts a relevant subgraph based on
# file references in the prompt, and injects navigation context into Claude.
# Always exits 0 — NEVER blocks the user's prompt.
#
# Note: No set -e — hook failures must not block prompts.

# ---------------------------------------------------------------------------
# Debug logging (opt-in via ASPENS_DEBUG=1)
# ---------------------------------------------------------------------------
log_debug() {
    if [ "$ASPENS_DEBUG" = "1" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [graph] $1" >> "${TMPDIR:-/tmp}/claude-graph-hook-debug-$(id -u).log"
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
log_debug "SCRIPT_DIR=$SCRIPT_DIR"

cd "$SCRIPT_DIR" || { echo "[Graph] Failed to cd to $SCRIPT_DIR" >&2; exit 0; }

# ---------------------------------------------------------------------------
# Capture stdin
# ---------------------------------------------------------------------------
INPUT=$(cat)
log_debug "Input received: ${INPUT:0:200}..."

# ---------------------------------------------------------------------------
# Run graph context engine with clean stdout/stderr separation
# ---------------------------------------------------------------------------
STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)
trap 'rm -f "$STDOUT_FILE" "$STDERR_FILE"' EXIT

printf '%s' "$INPUT" | NODE_NO_WARNINGS=1 node graph-context-prompt.mjs \
    >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?

log_debug "Exit code: $EXIT_CODE"
log_debug "Stderr: $(cat "$STDERR_FILE" 2>/dev/null | head -5)"

# ---------------------------------------------------------------------------
# Terminal status output (stderr)
# ---------------------------------------------------------------------------
if [ $EXIT_CODE -ne 0 ]; then
    log_debug "ERROR: Hook failed with exit code $EXIT_CODE"
fi

GRAPH_LINE=$(grep -o '\[Graph\] [^"]*' "$STDERR_FILE" | head -1)
if [ -n "$GRAPH_LINE" ]; then
    echo "$GRAPH_LINE" >&2
fi

# ---------------------------------------------------------------------------
# Emit pristine stdout (injected into Claude's context)
# ---------------------------------------------------------------------------
cat "$STDOUT_FILE"

exit 0
