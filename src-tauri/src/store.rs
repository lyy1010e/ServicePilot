use super::*;

impl ServicePilotBackend {
    pub(crate) async fn new(app: AppHandle<Wry>) -> BackendResult<Self> {
        let user_data_path = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

        let state_file = user_data_path.join(DATA_FILE);
        Ok(Self {
            app,
            state_file,
            last_snapshot_emitted: Arc::new(Mutex::new(std::time::Instant::now())),
            inner: Arc::new(Mutex::new(BackendState {
                services: Vec::new(),
                groups: Vec::new(),
                settings: AppSettings {
                    language: AppLanguage::ZhCn,
                    maven_settings_file: String::new(),
                    maven_local_repository: String::new(),
                    clear_logs_on_restart: true,
                },
                runtime: HashMap::new(),
                log_history: HashMap::new(),
                processes: HashMap::new(),
            })),
        })
    }

    pub(crate) async fn init(&self) -> BackendResult<()> {
        let persisted = self.read_state().await?;
        let mut inner = self.inner.lock().await;
        inner.services = persisted.services;
        inner.groups = persisted.groups;
        inner.settings = persisted.settings;
        inner.runtime.clear();
        let services = inner.services.clone();
        for service in services {
            inner.runtime.insert(
                service.id.clone(),
                RuntimeState {
                    service_id: service.id,
                    status: RuntimeStatus::Stopped,
                    pid: None,
                    started_at: None,
                    elapsed_seconds: None,
                    exit_code: None,
                    message: None,
                    detected_port: None,
                    detected_url: None,
                    failure_summary: None,
                    failure_category: None,
                },
            );
        }
        drop(inner);
        self.emit_snapshot().await;
        Ok(())
    }

    pub(crate) async fn get_snapshot(&self) -> AppSnapshot {
        let inner = self.inner.lock().await;
        AppSnapshot {
            services: inner.services.clone(),
            groups: inner.groups.clone(),
            runtime: inner.runtime.clone(),
            settings: inner.settings.clone(),
        }
    }

    pub(crate) async fn list_services(&self) -> Vec<ServiceConfig> {
        self.inner.lock().await.services.clone()
    }

    pub(crate) async fn list_groups(&self) -> Vec<ServiceGroup> {
        self.inner.lock().await.groups.clone()
    }

    pub(crate) async fn persist_state(&self) -> BackendResult<()> {
        if let Some(parent) = self.state_file.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|error| error.to_string())?;
        }

        let snapshot = {
            let inner = self.inner.lock().await;
            PersistedState {
                version: 1,
                services: inner.services.clone(),
                groups: inner.groups.clone(),
                settings: inner.settings.clone(),
            }
        };

        let content = serde_json::to_string_pretty(&snapshot).map_err(|error| error.to_string())?;
        fs::write(&self.state_file, content)
            .await
            .map_err(|error| error.to_string())
    }

    pub(crate) async fn read_state(&self) -> BackendResult<PersistedState> {
        match fs::read_to_string(&self.state_file).await {
            Ok(content) => {
                let sanitized = content.trim_start_matches('\u{feff}');
                serde_json::from_str(sanitized).map_err(|error| error.to_string())
            }
            Err(_) => Ok(PersistedState {
                version: 1,
                services: Vec::new(),
                groups: Vec::new(),
                settings: default_settings(),
            }),
        }
    }

    pub(crate) async fn emit_snapshot(&self) {
        let now = std::time::Instant::now();
        let last = *self.last_snapshot_emitted.lock().await;
        if now.duration_since(last).as_millis() < 50 {
            return;
        }
        *self.last_snapshot_emitted.lock().await = now;
        let snapshot = self.get_snapshot().await;
        let _ = self.app.emit("snapshot:update", snapshot);
    }

    pub(crate) async fn validate_imported_state(
        &self,
        state: &PersistedState,
    ) -> BackendResult<()> {
        let mut ids = HashSet::new();
        let mut names = HashSet::new();
        let mut service_ids = HashSet::new();

        for service in &state.services {
            if service.id.trim().is_empty() || !ids.insert(service.id.clone()) {
                return Err("导入失败：服务 ID 非法或重复。".to_string());
            }
            if service.name.trim().is_empty() || !names.insert(service.name.clone()) {
                return Err("导入失败：存在重复的服务名称。".to_string());
            }
            service_ids.insert(service.id.clone());
        }

        let mut group_ids = HashSet::new();
        let mut group_names = HashSet::new();
        for group in &state.groups {
            if group.id.trim().is_empty() || !group_ids.insert(group.id.clone()) {
                return Err("导入失败：分组 ID 非法或重复。".to_string());
            }
            if group.name.trim().is_empty() || !group_names.insert(group.name.clone()) {
                return Err("导入失败：分组名称为空或重复。".to_string());
            }
            if let Some(invalid) = group
                .service_ids
                .iter()
                .find(|service_id| !service_ids.contains(*service_id))
            {
                return Err(format!(
                    "导入失败：分组 {} 引用了不存在的服务 {}。",
                    group.name, invalid
                ));
            }
        }

        Ok(())
    }
}
