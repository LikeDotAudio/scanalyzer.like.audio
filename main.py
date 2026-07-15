#!/usr/bin/env python3
"""
Scanalyzer Runner Script.
This script launches the modern Tauri/Rust-based desktop application.
"""

import os
import sys
import subprocess

def clean_env():
    """Scrub snap env vars that break glibc and WebKit when launched from a snapped VS Code."""
    env = os.environ.copy()
    keys_to_delete = []
    for k, v in env.items():
        if k != "PATH" and "/snap/" in v:
            clean_paths = [p for p in v.split(os.pathsep) if "/snap/" not in p]
            if clean_paths:
                env[k] = os.pathsep.join(clean_paths)
            else:
                keys_to_delete.append(k)
    for k in keys_to_delete:
        del env[k]
    return env


def build_analyzer(root_dir, env):
    """Rebuild the analyzer CLI the desktop app shells out to.

    The desktop app does NOT analyze in-process — start_analysis (src-tauri) runs the
    prebuilt binary at sample_analyzer_rs/target/release/oa_sample_analyzer. `tauri dev`
    recompiles the Tauri crate but never that binary, so without this step the desktop
    keeps using a stale engine: every classifier, calibration and .PEAK-schema change
    would be invisible until the CLI is rebuilt by hand. `cargo build` is a no-op when
    nothing changed, so this is cheap on the common launch.
    """
    analyzer_dir = os.path.join(root_dir, "sample_analyzer_rs")
    if not os.path.isdir(analyzer_dir):
        print(f"Error: Could not find the analyzer at {analyzer_dir}")
        sys.exit(1)

    print("Building the analyzer engine (sample_analyzer_rs, release)...")
    try:
        subprocess.run(
            ["cargo", "build", "--release"],
            cwd=analyzer_dir,
            env=env,
            check=True,
        )
    except FileNotFoundError:
        print("\nError: 'cargo' not found. Install the Rust toolchain (https://rustup.rs).")
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"\nError: the analyzer failed to compile (exit {e.returncode}). "
              "Fix the build above before launching, or the desktop app would run a stale engine.")
        sys.exit(e.returncode)

    binary = os.path.join(analyzer_dir, "target", "release", "oa_sample_analyzer")
    if not os.path.isfile(binary):
        print(f"Error: build reported success but {binary} is missing.")
        sys.exit(1)


def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    web_front_dir = os.path.join(root_dir, "Web_Front")

    if not os.path.isdir(web_front_dir):
        print(f"Error: Could not find the Web_Front directory at {web_front_dir}")
        sys.exit(1)

    env = clean_env()

    # Rebuild the engine first, so the app that launches uses current code, not a stale
    # binary from a previous session.
    build_analyzer(root_dir, env)

    print("\nLaunching the Scanalyzer Tauri App...")
    print("If this is your first time, it may take a few moments to compile the Rust backend.")

    try:
        # Launch the Tauri dev server from within the Web_Front directory
        subprocess.run(
            ["npm", "run", "tauri", "dev"], 
            cwd=web_front_dir, 
            env=env,
            check=True
        )
    except subprocess.CalledProcessError as e:
        # `tauri dev` returns a signal-death code when it's shut down rather than crashing:
        # 143 = SIGTERM (the app window was closed, or the debugger's Stop button was hit),
        # 130 = SIGINT (Ctrl-C). Those are normal exits, not failures — return cleanly so the
        # debugger doesn't surface a SystemExit "exception" on every ordinary shutdown.
        if e.returncode in (130, 143):
            print("\nScanalyzer closed.")
            return
        print(f"\nError: The Tauri application exited with code {e.returncode}")
        sys.exit(e.returncode)
    except FileNotFoundError:
        print("\nError: 'npm' command not found. Please ensure Node.js is installed.")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nExiting Scanalyzer.")

if __name__ == "__main__":
    main()
