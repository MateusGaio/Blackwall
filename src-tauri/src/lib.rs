// MIT License — Copyright (c) 2026 Mateus Gaio
use std::{
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command},
    sync::Mutex,
};
use tauri::Manager;

#[derive(Clone, serde::Serialize)]
struct RuntimeConfig {
    sidecar_url: String,
}

struct SidecarProcess(Mutex<Child>);

#[tauri::command]
fn runtime_config(config: tauri::State<'_, RuntimeConfig>) -> RuntimeConfig {
    config.inner().clone()
}

fn available_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("não foi possível reservar uma porta local");
    listener.local_addr().expect("porta local inválida").port()
}

fn sidecar_script() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/dist/index.js")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = available_port();
    let child = Command::new("node")
        .arg(sidecar_script())
        .env("BLACKWALL_SIDECAR_PORT", port.to_string())
        .spawn()
        .expect("não foi possível iniciar o sidecar do Blackwall; instale Node.js para desenvolvimento");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(RuntimeConfig {
            sidecar_url: format!("http://127.0.0.1:{port}"),
        })
        .manage(SidecarProcess(Mutex::new(child)))
        .invoke_handler(tauri::generate_handler![runtime_config])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let process = window.app_handle().state::<SidecarProcess>();
                let _ = process.0.lock().expect("sidecar lock indisponível").kill();
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar o Blackwall");
}
