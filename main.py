#!/usr/bin/env python3
"""
Scanalyzer Runner Script.
This script launches the modern Tauri/Rust-based desktop application.
"""

import os
import sys
import subprocess

def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    web_front_dir = os.path.join(root_dir, "Web_Front")

    if not os.path.isdir(web_front_dir):
        print(f"Error: Could not find the Web_Front directory at {web_front_dir}")
        sys.exit(1)

    print("Launching the Scanalyzer Tauri App...")
    print("If this is your first time, it may take a few moments to compile the Rust backend.")
    
    # Scrub snap environment variables that break glibc and WebKit when launched from a snapped VS Code
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
    
    try:
        # Launch the Tauri dev server from within the Web_Front directory
        subprocess.run(
            ["npm", "run", "tauri", "dev"], 
            cwd=web_front_dir, 
            env=env,
            check=True
        )
    except subprocess.CalledProcessError as e:
        print(f"\nError: The Tauri application exited with code {e.returncode}")
        sys.exit(e.returncode)
    except FileNotFoundError:
        print("\nError: 'npm' command not found. Please ensure Node.js is installed.")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nExiting Scanalyzer.")

if __name__ == "__main__":
    main()
