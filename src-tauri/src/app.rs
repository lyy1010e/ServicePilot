use super::*;
use crate::commands::*;

pub(crate) fn show_main_window(app_handle: &AppHandle<Wry>) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn shutdown_and_exit(app_handle: &AppHandle<Wry>, exit_guard: &Arc<AtomicBool>) {
    if exit_guard.swap(true, Ordering::SeqCst) {
        return;
    }

    let state = app_handle.state::<AppState>().backend.clone();
    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        state.shutdown().await.ok();
        handle.exit(0);
    });
}

fn setup_tray(app: &tauri::App<Wry>, exit_guard: Arc<AtomicBool>) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "Open ServicePilot", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &separator, &quit_item])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("ServicePilot")
        .show_menu_on_left_click(false)
        .on_menu_event({
            let exit_guard = exit_guard.clone();
            move |app_handle, event| match event.id().as_ref() {
                TRAY_SHOW_ID => show_main_window(app_handle),
                TRAY_QUIT_ID => shutdown_and_exit(app_handle, &exit_guard),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

pub fn run() {
    let exit_guard = Arc::new(AtomicBool::new(false));
    let setup_exit_guard = exit_guard.clone();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    if !cfg!(debug_assertions) {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    let builder = builder
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let t0 = std::time::Instant::now();
            let backend = tauri::async_runtime::block_on(ServicePilotBackend::new(app_handle))
                .unwrap_or_else(|error| panic!("failed to initialize backend: {error}"));
            eprintln!(
                "[ServicePilot] backend::new  {}ms",
                t0.elapsed().as_millis()
            );
            let t1 = std::time::Instant::now();
            tauri::async_runtime::block_on(backend.init())
                .unwrap_or_else(|error| panic!("failed to load backend state: {error}"));
            eprintln!(
                "[ServicePilot] backend::init {}ms",
                t1.elapsed().as_millis()
            );
            let backend = Arc::new(backend);
            app.manage(AppState {
                backend: backend.clone(),
            });
            app.manage(UpdateState {
                pending: StdMutex::new(None),
            });
            setup_tray(app, setup_exit_guard.clone())?;
            let resume_backend = backend.clone();
            tauri::async_runtime::spawn(async move {
                resume_backend.restore_services_from_last_exit().await;
            });
            eprintln!("[ServicePilot] setup total  {}ms", t0.elapsed().as_millis());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_get_version,
            app_check_update,
            app_install_update,
            app_get_snapshot,
            app_show_window,
            app_exit,
            app_shutdown,
            service_list,
            service_detect_project,
            service_import_project,
            service_import_idea_project,
            service_scan_spring,
            service_batch_import,
            service_save,
            service_delete,
            service_start,
            service_stop,
            service_restart,
            service_open_url,
            group_list,
            group_save,
            group_delete,
            group_move,
            group_start,
            group_stop,
            group_set_service_membership,
            group_add_services_to_groups,
            log_history,
            log_clear,
            settings_set_language,
            settings_save,
            settings_import_idea_maven_config,
            settings_export_state,
            settings_import_state,
            dialog_pick_directory,
            dialog_pick_file,
            window_minimize,
            window_toggle_maximize,
            window_start_drag,
            window_close
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build tauri application");

    app.run({
        let exit_guard = exit_guard.clone();
        move |app_handle, event| match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.emit("close-requested", ());
                }
            }
            RunEvent::ExitRequested {
                code: Some(RESTART_EXIT_CODE),
                ..
            } => {}
            RunEvent::ExitRequested { api, .. } => {
                if exit_guard.swap(true, Ordering::SeqCst) {
                    return;
                }

                api.prevent_exit();
                let state = app_handle.state::<AppState>().backend.clone();
                let handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    state.shutdown().await.ok();
                    handle.exit(0);
                });
            }
            _ => {}
        }
    });
}
