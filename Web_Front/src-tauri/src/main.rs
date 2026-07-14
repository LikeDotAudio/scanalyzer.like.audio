// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Scrub snap-injected environment variables before GTK and WebKit initialize.
    // This prevents WebKitNetworkProcess from crashing due to VS Code's snap glibc conflicts.
    for (k, v) in std::env::vars() {
        if k != "PATH" && v.contains("/snap/") {
            let clean: Vec<&str> = v.split(':').filter(|p| !p.contains("/snap/")).collect();
            if clean.is_empty() {
                std::env::remove_var(&k);
            } else {
                std::env::set_var(&k, clean.join(":"));
            }
        }
    }
    app_lib::run();
}
