use super::*;

#[tauri::command]
pub(crate) async fn app_get_snapshot(state: State<'_, AppState>) -> BackendResult<AppSnapshot> {
    Ok(state.backend.get_snapshot().await)
}

#[tauri::command]
pub(crate) async fn service_list(state: State<'_, AppState>) -> BackendResult<Vec<ServiceConfig>> {
    Ok(state.backend.list_services().await)
}

#[tauri::command]
pub(crate) async fn group_list(state: State<'_, AppState>) -> BackendResult<Vec<ServiceGroup>> {
    Ok(state.backend.list_groups().await)
}

#[tauri::command]
pub(crate) async fn log_history(
    state: State<'_, AppState>,
    service_id: String,
) -> BackendResult<Vec<LogEntry>> {
    state.backend.get_log_history(&service_id).await
}

#[tauri::command]
pub(crate) async fn log_clear(state: State<'_, AppState>, service_id: String) -> BackendResult<()> {
    state.backend.clear_log_history(&service_id).await
}

#[tauri::command]
pub(crate) async fn settings_set_language(
    state: State<'_, AppState>,
    language: AppLanguage,
) -> BackendResult<()> {
    state.backend.set_language(language).await
}

#[tauri::command]
pub(crate) async fn settings_save(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> BackendResult<()> {
    state.backend.save_settings(settings).await
}

#[tauri::command]
pub(crate) async fn service_detect_project(
    state: State<'_, AppState>,
    project_dir: String,
) -> BackendResult<ProjectDetection> {
    state.backend.detect_project(&project_dir).await
}

#[tauri::command]
pub(crate) async fn service_save(
    state: State<'_, AppState>,
    input: SaveServiceInput,
) -> BackendResult<ServiceConfig> {
    state.backend.save_service(input).await
}

#[tauri::command]
pub(crate) async fn service_delete(
    state: State<'_, AppState>,
    service_id: String,
) -> BackendResult<()> {
    state.backend.delete_service(&service_id).await
}

#[tauri::command]
pub(crate) async fn service_start(
    state: State<'_, AppState>,
    service_id: String,
) -> BackendResult<()> {
    state.backend.start_service(&service_id).await
}

#[tauri::command]
pub(crate) async fn service_stop(
    state: State<'_, AppState>,
    service_id: String,
) -> BackendResult<()> {
    state.backend.stop_service(&service_id).await
}

#[tauri::command]
pub(crate) async fn service_restart(
    state: State<'_, AppState>,
    service_id: String,
) -> BackendResult<()> {
    state.backend.restart_service(&service_id).await
}

#[tauri::command]
pub(crate) async fn service_open_url(
    state: State<'_, AppState>,
    service_id: String,
) -> BackendResult<()> {
    state.backend.open_service_url(&service_id).await
}

#[tauri::command]
pub(crate) async fn group_save(
    state: State<'_, AppState>,
    input: SaveGroupInput,
) -> BackendResult<ServiceGroup> {
    state.backend.save_group(input).await
}

#[tauri::command]
pub(crate) async fn group_delete(
    state: State<'_, AppState>,
    group_id: String,
) -> BackendResult<()> {
    state.backend.delete_group(&group_id).await
}

#[tauri::command]
pub(crate) async fn group_move(
    state: State<'_, AppState>,
    group_id: String,
    target_index: usize,
) -> BackendResult<()> {
    state.backend.move_group(&group_id, target_index).await
}

#[tauri::command]
pub(crate) async fn group_start(state: State<'_, AppState>, group_id: String) -> BackendResult<()> {
    state.backend.start_group(&group_id).await
}

#[tauri::command]
pub(crate) async fn group_stop(state: State<'_, AppState>, group_id: String) -> BackendResult<()> {
    state.backend.stop_group(&group_id).await
}

#[tauri::command]
pub(crate) async fn group_set_service_membership(
    state: State<'_, AppState>,
    service_id: String,
    group_ids: Vec<String>,
) -> BackendResult<()> {
    state
        .backend
        .set_service_group_membership(&service_id, group_ids)
        .await
}

#[tauri::command]
pub(crate) async fn group_add_services_to_groups(
    state: State<'_, AppState>,
    service_ids: Vec<String>,
    group_ids: Vec<String>,
) -> BackendResult<()> {
    state
        .backend
        .add_services_to_groups(service_ids, group_ids)
        .await
}

#[tauri::command]
pub(crate) async fn dialog_pick_directory(
    app: AppHandle<Wry>,
    state: State<'_, AppState>,
    default_path: Option<String>,
) -> BackendResult<Option<String>> {
    let language = state.backend.dialog_language().await;
    let title = match language {
        AppLanguage::ZhCn => "选择工作目录",
        AppLanguage::EnUs => "Select Working Directory",
    };

    let result = tokio::task::spawn_blocking(move || {
        let mut builder = app.dialog().file().set_title(title);
        if let Some(path) = default_path.filter(|value| !value.trim().is_empty()) {
            builder = builder.set_directory(path);
        }
        builder.blocking_pick_folder()
    })
    .await
    .map_err(|error| error.to_string())?;

    Ok(result.and_then(file_path_to_string))
}

#[tauri::command]
pub(crate) async fn dialog_pick_file(
    app: AppHandle<Wry>,
    state: State<'_, AppState>,
    default_path: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> BackendResult<Option<String>> {
    let language = state.backend.dialog_language().await;
    let title = match language {
        AppLanguage::ZhCn => "选择文件",
        AppLanguage::EnUs => "Select File",
    };

    let result = tokio::task::spawn_blocking(move || {
        let mut builder = app.dialog().file().set_title(title);
        if let Some(path) = default_path.filter(|value| !value.trim().is_empty()) {
            builder = builder.set_directory(path);
        }
        if let Some(items) = filters {
            for filter in items {
                let extensions = filter
                    .extensions
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                builder = builder.add_filter(&filter.name, &extensions);
            }
        }
        builder.blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;

    Ok(result.and_then(file_path_to_string))
}

#[tauri::command]
pub(crate) async fn settings_import_idea_maven_config(
    state: State<'_, AppState>,
    project_dir: String,
) -> BackendResult<AppSettings> {
    state.backend.import_idea_maven_config(&project_dir).await
}

#[tauri::command]
pub(crate) async fn service_import_idea_project(
    state: State<'_, AppState>,
    project_dir: String,
) -> BackendResult<ServiceConfig> {
    state.backend.import_idea_project(&project_dir).await
}

#[tauri::command]
pub(crate) async fn service_import_project(
    state: State<'_, AppState>,
    project_dir: String,
) -> BackendResult<ServiceConfig> {
    state.backend.import_project(&project_dir).await
}

#[tauri::command]
pub(crate) async fn settings_export_state(
    app: AppHandle<Wry>,
    state: State<'_, AppState>,
) -> BackendResult<()> {
    let language = state.backend.dialog_language().await;
    let title = match language {
        AppLanguage::ZhCn => "导出 ServicePilot 配置",
        AppLanguage::EnUs => "Export ServicePilot Config",
    };

    let result = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .set_file_name("service-pilot-config.json")
            .add_filter("JSON", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;

    if let Some(file_path) = result.and_then(file_path_to_path) {
        state.backend.export_state_to_file(&file_path).await?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn settings_import_state(
    app: AppHandle<Wry>,
    state: State<'_, AppState>,
) -> BackendResult<()> {
    let language = state.backend.dialog_language().await;
    let title = match language {
        AppLanguage::ZhCn => "导入 ServicePilot 配置",
        AppLanguage::EnUs => "Import ServicePilot Config",
    };

    let result = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;

    if let Some(file_path) = result.and_then(file_path_to_path) {
        state.backend.import_state_from_file(&file_path).await?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn app_shutdown(state: State<'_, AppState>) -> BackendResult<()> {
    state.backend.shutdown().await
}

#[tauri::command]
pub(crate) async fn service_scan_spring(
    state: State<'_, AppState>,
    root_dir: String,
) -> BackendResult<ScanResult> {
    state.backend.scan_spring_services(root_dir).await
}

#[tauri::command]
pub(crate) async fn service_batch_import(
    state: State<'_, AppState>,
    items: Vec<BatchImportItem>,
) -> BackendResult<Vec<ServiceConfig>> {
    state.backend.batch_import_services(items).await
}

#[tauri::command]
pub(crate) fn app_get_version(app: AppHandle<Wry>) -> String {
    app.package_info().version.to_string()
}

fn update_to_info(update: &Update) -> AppUpdateInfo {
    AppUpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|date| date.to_string()),
    }
}

#[tauri::command]
pub(crate) async fn app_check_update(
    app: AppHandle<Wry>,
    update_state: State<'_, UpdateState>,
) -> BackendResult<Option<AppUpdateInfo>> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    let info = update.as_ref().map(update_to_info);
    let mut pending = update_state
        .pending
        .lock()
        .map_err(|_| "Failed to lock update state.".to_string())?;
    *pending = update;
    Ok(info)
}

#[tauri::command]
pub(crate) async fn app_install_update(
    app: AppHandle<Wry>,
    state: State<'_, AppState>,
    update_state: State<'_, UpdateState>,
) -> BackendResult<()> {
    let update = {
        let mut pending = update_state
            .pending
            .lock()
            .map_err(|_| "Failed to lock update state.".to_string())?;
        pending.take()
    };
    let update = if let Some(update) = update {
        update
    } else {
        app.updater()
            .map_err(|error| error.to_string())?
            .check()
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "No verified update is available.".to_string())?
    };

    // 停止服务失败不应阻止更新
    let _ = state.backend.shutdown().await;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| {
            eprintln!("[ServicePilot] install_update download_and_install error: {error}");
            error.to_string()
        })?;
    app.restart();
}

#[tauri::command]
pub(crate) fn window_minimize(window: Window) -> BackendResult<()> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn window_toggle_maximize(window: Window) -> BackendResult<()> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub(crate) fn window_start_drag(window: Window) -> BackendResult<()> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn window_close(window: Window) -> BackendResult<()> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn app_show_window(app_handle: AppHandle<Wry>) -> BackendResult<()> {
    show_main_window(&app_handle);
    Ok(())
}

#[tauri::command]
pub(crate) fn app_exit(app_handle: AppHandle<Wry>) -> BackendResult<()> {
    app_handle.exit(0);
    Ok(())
}
