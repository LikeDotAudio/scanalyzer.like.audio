#!/usr/bin/env bash
# Self-contained launcher for the Sample Analyzer.
# Builds the Rust crates if needed, then starts the Python GUI.
set -e

# Resolve the directory of this script so it can be run from anywhere
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
HERE="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"

echo "Launcher script path: $HERE/run.sh"
echo "Python script path: $HERE/main.py"

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
