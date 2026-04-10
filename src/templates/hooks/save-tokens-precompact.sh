#!/bin/bash

get_script_dir() {
    local source="${BASH_SOURCE[0]}"
    while [ -h "$source" ]; do
        local dir
        dir="$(cd -P "$(dirname "$source")" && pwd)" || return 1
        source="$(readlink "$source")"
        [[ $source != /* ]] && source="$dir/$source"
    done
    cd -P "$(dirname "$source")" && pwd
}

SCRIPT_DIR="$(get_script_dir)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

ASPENS_PROJECT_DIR="$PROJECT_DIR" NODE_NO_WARNINGS=1 node "$SCRIPT_DIR/save-tokens.mjs" precompact <&0
exit 0
