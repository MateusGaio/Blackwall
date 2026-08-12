// MIT License — Copyright (c) 2026 Mateus Gaio
use std::{
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command},
    sync::Mutex,
};
use tauri::{path::BaseDirectory, Manager};

#[derive(Clone, serde::Serialize)]
struct RuntimeConfig {
    sidecar_url: String,
}

struct SidecarProcess(Mutex<Child>);

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        if let Ok(mut child) = self.0.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
fn runtime_config(config: tauri::State<'_, RuntimeConfig>) -> RuntimeConfig {
    config.inner().clone()
}

fn available_port() -> u16 {
    let listener =
        TcpListener::bind("127.0.0.1:0").expect("não foi possível reservar uma porta local");
    listener.local_addr().expect("porta local inválida").port()
}

fn sidecar_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/dist/index.js"));
    }
    app.path()
        .resolve("desktop-runtime/launch.js", BaseDirectory::Resource)
        .map_err(|error| format!("não foi possível localizar o sidecar empacotado: {error}"))
}

fn sidecar_node(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from("node"));
    }
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
    let port = available_port();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let script = sidecar_script(app.handle()).map_err(std::io::Error::other)?;
            let node = sidecar_node(app.handle()).map_err(std::io::Error::other)?;
            let child = Command::new(node)
                .arg(script)
                .env("BLACKWALL_SIDECAR_PORT", port.to_string())
                .spawn()
                .map_err(|error| {
                    std::io::Error::other(format!(
                        "não foi possível iniciar o sidecar do Blackwall: {error}"
                    ))
                })?;
            app.manage(RuntimeConfig {
                sidecar_url: format!("http://127.0.0.1:{port}"),
            });
            app.manage(SidecarProcess(Mutex::new(child)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![runtime_config])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let process = window.app_handle().state::<SidecarProcess>();
                if let Ok(mut child) = process.0.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar o Blackwall");
}
