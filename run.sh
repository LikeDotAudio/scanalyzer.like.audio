#!/usr/bin/env bash
# Self-contained launcher for the Sample Analyzer.
# Builds the Rust crates if needed, then starts the Python GUI.
set -e
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

build_crate() {
    local dir="$1" bin="$2"
    if [ ! -x "$HERE/$dir/target/release/$bin" ]; then
        echo "Building $dir (first run)…"
        ( cd "$HERE/$dir" && cargo build --release )
    fi
}

build_crate sample_analyzer_rs oa_sample_analyzer   # analyzer core
build_crate graphing_rs oa_graph_layout             # 3D-cloud placement engine

exec python3 "$HERE/main.py" "$@"
