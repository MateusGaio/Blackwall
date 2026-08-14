// MIT License — Copyright (c) 2026 Mateus Gaio
#[cfg(not(debug_assertions))]
use std::{net::TcpListener, path::PathBuf, process::Command};
use std::{process::Child, sync::Mutex};
#[cfg(not(debug_assertions))]
use tauri::path::BaseDirectory;
use tauri::Manager;

#[cfg(not(debug_assertions))]
fn argument_value(name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    std::env::args().find_map(|argument| argument.strip_prefix(&prefix).map(str::to_owned))
}

#[cfg(not(debug_assertions))]
fn has_argument(name: &str) -> bool {
    std::env::args().any(|argument| argument == name)
}

#[derive(Clone, serde::Serialize)]
struct RuntimeConfig {
    sidecar_url: String,
}

struct SidecarProcess(Mutex<Option<Child>>);

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        if let Ok(mut child) = self.0.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[tauri::command]
fn runtime_config(config: tauri::State<'_, RuntimeConfig>) -> RuntimeConfig {
    config.inner().clone()
}

#[cfg(not(debug_assertions))]
fn available_port() -> u16 {
    let listener =
        TcpListener::bind("127.0.0.1:0").expect("não foi possível reservar uma porta local");
    listener.local_addr().expect("porta local inválida").port()
}

#[cfg(not(debug_assertions))]
fn sidecar_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("desktop-runtime/launch.js", BaseDirectory::Resource)
        .map_err(|error| format!("não foi possível localizar o sidecar empacotado: {error}"))
}

#[cfg(not(debug_assertions))]
fn sidecar_node(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    app.path()
        .resolve(
            format!("desktop-runtime/{node_name}"),
            BaseDirectory::Resource,
        )
        .map_err(|error| format!("não foi possível localizar o runtime Node empacotado: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(debug_assertions))]
    let port = available_port();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            #[cfg(debug_assertions)]
            let (sidecar_url, child) = ("http://127.0.0.1:1422".to_owned(), None);

            #[cfg(not(debug_assertions))]
            let (sidecar_url, child) = {
                let script = sidecar_script(app.handle()).map_err(std::io::Error::other)?;
                let node = sidecar_node(app.handle()).map_err(std::io::Error::other)?;
                let mut command = Command::new(node);
                command
                    .arg(script)
                    .env("BLACKWALL_SIDECAR_PORT", port.to_string());
                if let Some(data_directory) = argument_value("--blackwall-data-dir") {
                    command.env("BLACKWALL_DATA_DIR", data_directory);
                }
                if has_argument("--blackwall-e2e-agent") {
                    command
                        .env("BLACKWALL_E2E", "1")
                        .env("BLACKWALL_E2E_AGENT", "1")
                        .env("BLACKWALL_E2E_MOCK", "1");
                }
                let child = command.spawn().map_err(|error| {
                    std::io::Error::other(format!(
                        "não foi possível iniciar o sidecar do Blackwall: {error}"
                    ))
                })?;
                (format!("http://127.0.0.1:{port}"), Some(child))
            };
            app.manage(RuntimeConfig { sidecar_url });
            app.manage(SidecarProcess(Mutex::new(child)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![runtime_config])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let process = window.app_handle().state::<SidecarProcess>();
                if let Ok(mut child) = process.0.lock() {
                    if let Some(child) = child.as_mut() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar o Blackwall");
}
