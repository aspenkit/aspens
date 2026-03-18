#!/bin/bash
# Note: Removed set -e to prevent hook failures from blocking prompts

# Resolve the actual directory where this script lives (handling symlinks)
# This ensures we can find the TypeScript file even when the hook is symlinked
get_script_dir() {
    local source="${BASH_SOURCE[0]}"
    # Resolve symlinks
    while [ -h "$source" ]; do
        local dir="$(cd -P "$(dirname "$source")" && pwd)"
        source="$(readlink "$source")"
        # Handle relative symlinks
        [[ $source != /* ]] && source="$dir/$source"
    done
    cd -P "$(dirname "$source")" && pwd
}

SCRIPT_DIR="$(get_script_dir)"

# Change to the script directory and run the TypeScript hook
cd "$SCRIPT_DIR"

# Capture stdin (printf preserves payload shape, unlike echo which can mangle escapes)
INPUT=$(cat)

# Temp files for clean stdout/stderr separation
STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)
trap 'rm -f "$STDOUT_FILE" "$STDERR_FILE"' EXIT

# Run the TypeScript hook with stdout and stderr captured separately
printf '%s' "$INPUT" | NODE_NO_WARNINGS=1 npx tsx skill-activation-prompt.ts \
    >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?

# Parse stderr for skill activation info and relay to terminal
if [ $EXIT_CODE -ne 0 ]; then
    echo "⚡ [Skills] Hook error (exit $EXIT_CODE)" >&2
else
    SKILL_LINE=$(grep -o '\[Skills\] Activated: [^"]*' "$STDERR_FILE" | head -1)
    if [ -n "$SKILL_LINE" ]; then
        echo "⚡ $SKILL_LINE" >&2
    else
        echo "⚡ [Skills] No skills matched" >&2
    fi
fi

# Output pristine stdout only (no grep filtering needed)
cat "$STDOUT_FILE"

exit 0
