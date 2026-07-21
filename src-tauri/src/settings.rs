use super::*;

impl ServicePilotBackend {
    pub(crate) async fn set_language(&self, language: AppLanguage) -> BackendResult<()> {
        {
            let mut inner = self.inner.lock().await;
            inner.settings.language = language;
        }
        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(())
    }

    pub(crate) async fn save_settings(&self, settings: AppSettings) -> BackendResult<()> {
        let resume_services_on_launch = settings.resume_services_on_launch;
        {
            let mut inner = self.inner.lock().await;
            inner.settings = settings;
        }
        self.persist_state().await?;
        if !resume_services_on_launch {
            self.clear_resume_state().await?;
        }
        self.emit_snapshot().await;
        Ok(())
    }

    pub(crate) async fn import_idea_maven_config(
        &self,
        project_dir: &str,
    ) -> BackendResult<AppSettings> {
        let workspace_file = find_idea_workspace(Path::new(project_dir)).ok_or_else(|| {
            format!("IDEA workspace file not found under or above: {project_dir}")
        })?;
        let content = fs::read_to_string(&workspace_file).await.map_err(|_| {
            format!(
                "IDEA workspace file not found: {}",
                workspace_file.display()
            )
        })?;

        let maven_settings_file = extract_xml_option_value(&content, "userSettingsFile")
            .ok_or_else(|| {
                format!(
                    "No IDEA Maven settings file found in {}",
                    workspace_file.display()
                )
            })?;
        let maven_local_repository =
            extract_xml_option_value(&content, "localRepository").unwrap_or_default();

        let settings = {
            let mut inner = self.inner.lock().await;
            inner.settings.maven_settings_file = maven_settings_file;
            inner.settings.maven_local_repository = maven_local_repository;
            inner.settings.clone()
        };

        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(settings)
    }

    pub(crate) async fn export_state_to_file(&self, file_path: &Path) -> BackendResult<()> {
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
        fs::write(file_path, content)
            .await
            .map_err(|error| error.to_string())
    }

    pub(crate) async fn import_state_from_file(&self, file_path: &Path) -> BackendResult<()> {
        let content = fs::read_to_string(file_path)
            .await
            .map_err(|error| error.to_string())?;
        let parsed =
            serde_json::from_str::<PersistedState>(&content).map_err(|error| error.to_string())?;
        self.validate_imported_state(&parsed).await?;
        self.shutdown_without_resume().await?;

        {
            let mut inner = self.inner.lock().await;
            inner.services = parsed.services.clone();
            inner.groups = parsed.groups.clone();
            inner.settings = parsed.settings.clone();
            inner.runtime.clear();
            inner.log_history.clear();
            inner.processes.clear();
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
        }

        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(())
    }

    pub(crate) async fn dialog_language(&self) -> AppLanguage {
        self.inner.lock().await.settings.language.clone()
    }
}
