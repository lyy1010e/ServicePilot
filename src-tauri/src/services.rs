use super::*;
use crate::service_detection::*;

impl ServicePilotBackend {
    pub(crate) async fn import_idea_project(
        &self,
        project_dir: &str,
    ) -> BackendResult<ServiceConfig> {
        let prepared = self.prepare_idea_project(project_dir, false).await?;
        self.save_imported_project_service(
            prepared.service,
            &prepared.imported_settings,
            RuntimeStatus::Stopped,
            None,
        )
        .await
    }

    pub(crate) async fn prepare_idea_project(
        &self,
        project_dir: &str,
        prepare_classpath: bool,
    ) -> BackendResult<PreparedIdeaProject> {
        let selected_path = Path::new(project_dir);
        let workspace_file = find_idea_workspace(selected_path).ok_or_else(|| {
            format!("IDEA workspace file not found under or above: {project_dir}")
        })?;
        let project_root = workspace_file
            .parent()
            .and_then(Path::parent)
            .ok_or_else(|| {
                format!(
                    "Failed to determine IDEA project root for {}",
                    workspace_file.display()
                )
            })?
            .to_path_buf();
        let workspace_content = fs::read_to_string(&workspace_file).await.map_err(|error| {
            format!(
                "Failed to read IDEA workspace file {}: {error}",
                workspace_file.display()
            )
        })?;

        let run_configs = extract_idea_spring_run_configs(&workspace_content);
        if run_configs.is_empty() {
            return Err(format!(
                "No Spring Boot run configuration found in {}",
                workspace_file.display()
            ));
        }

        let selected_config = select_idea_run_config(
            &run_configs,
            &workspace_content,
            selected_path,
            &project_root,
        )
        .ok_or_else(|| {
            format!("No matching Spring Boot run configuration found for {project_dir}")
        })?;

        let misc_file = project_root.join(".idea").join("misc.xml");
        let misc_content = fs::read_to_string(&misc_file).await.unwrap_or_default();
        let project_jdk_name = extract_project_jdk_name(&misc_content);
        let jdk_home = project_jdk_name
            .as_deref()
            .and_then(resolve_idea_jdk_home)
            .or_else(|| fallback_java_home(project_jdk_name.as_deref()));

        let working_dir = resolve_idea_working_dir(&project_root, selected_path, &selected_config)
            .ok_or_else(|| {
                format!(
                    "Failed to resolve module directory for {}",
                    selected_config.main_class
                )
            })?;

        let imported_settings = extract_idea_maven_settings(&workspace_content, &project_root);
        let profiles = extract_profiles_from_args(&selected_config.program_args);
        let port = extract_port_from_args(&selected_config.program_args);

        let existing_service_id = {
            let inner = self.inner.lock().await;
            inner
                .services
                .iter()
                .find(|service| {
                    service.working_dir == working_dir
                        && service.main_class.as_deref()
                            == Some(selected_config.main_class.as_str())
                })
                .map(|service| service.id.clone())
        };

        let mut env = selected_config.env.clone();
        if let Some(java_home) = jdk_home {
            env.entry("JAVA_HOME".to_string())
                .or_insert_with(|| java_home.clone());
            env.entry("JDK_HOME".to_string()).or_insert(java_home);
        }

        let prepared_settings = AppSettings {
            language: AppLanguage::ZhCn,
            maven_settings_file: if imported_settings.maven_settings_file.is_empty() {
                self.inner.lock().await.settings.maven_settings_file.clone()
            } else {
                imported_settings.maven_settings_file.clone()
            },
            maven_local_repository: if imported_settings.maven_local_repository.is_empty() {
                self.inner
                    .lock()
                    .await
                    .settings
                    .maven_local_repository
                    .clone()
            } else {
                imported_settings.maven_local_repository.clone()
            },
            clear_logs_on_restart: self.inner.lock().await.settings.clear_logs_on_restart,
        };

        let classpath = if prepare_classpath {
            self.build_idea_java_main_classpath(&working_dir, &prepared_settings, &env, None)
                .await?
        } else {
            default_java_classpath(&working_dir)
        };

        let java_command = env
            .get("JAVA_HOME")
            .map(|java_home| {
                Path::new(java_home).join("bin").join(if cfg!(windows) {
                    "java.exe"
                } else {
                    "java"
                })
            })
            .filter(|path| path.exists())
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| "java".to_string());

        // 构建 JVM 参数，确保 -Dfile.encoding=UTF-8 在最前面
        let mut jvm_args = merge_managed_jvm_args(&selected_config.jvm_args);
        if existing_service_id.is_none() {
            add_default_spring_heap_args_if_missing(&mut jvm_args);
        }

        let service = ServiceConfig {
            id: existing_service_id.unwrap_or_else(new_id),
            name: selected_config.name.clone(),
            service_kind: ServiceKind::Spring,
            framework: Some("spring-boot".to_string()),
            launch_type: LaunchType::JavaMain,
            working_dir,
            command: java_command,
            args: strip_managed_spring_args(&selected_config.program_args),
            env,
            profiles,
            port,
            url: None,
            frontend_script: None,
            maven_force_update: false,
            maven_debug_mode: false,
            maven_disable_fork: false,
            main_class: Some(selected_config.main_class.clone()),
            classpath: Some(classpath),
            jvm_args,
        };

        self.validate_service(&service).await?;

        Ok(PreparedIdeaProject {
            service,
            imported_settings,
        })
    }

    pub(crate) async fn save_imported_project_service(
        &self,
        service: ServiceConfig,
        imported_settings: &AppSettings,
        status: RuntimeStatus,
        message: Option<String>,
    ) -> BackendResult<ServiceConfig> {
        let started_at = if matches!(&status, RuntimeStatus::Starting | RuntimeStatus::Running) {
            Some(now_iso_string())
        } else {
            None
        };
        {
            let mut inner = self.inner.lock().await;
            if !imported_settings.maven_settings_file.is_empty() {
                inner.settings.maven_settings_file = imported_settings.maven_settings_file.clone();
            }
            if !imported_settings.maven_local_repository.is_empty() {
                inner.settings.maven_local_repository =
                    imported_settings.maven_local_repository.clone();
            }

            if let Some(index) = inner.services.iter().position(|item| item.id == service.id) {
                inner.services[index] = service.clone();
            } else {
                inner.services.push(service.clone());
            }

            inner.runtime.insert(
                service.id.clone(),
                RuntimeState {
                    service_id: service.id.clone(),
                    status,
                    pid: None,
                    started_at,
                    elapsed_seconds: None,
                    exit_code: None,
                    message,
                    detected_port: None,
                    detected_url: None,
                    failure_summary: None,
                    failure_category: None,
                },
            );
        }

        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(service)
    }

    pub(crate) async fn import_project(&self, project_dir: &str) -> BackendResult<ServiceConfig> {
        let has_package_json = Path::new(project_dir).join("package.json").exists();
        let has_cargo_toml = Path::new(project_dir).join("Cargo.toml").exists();

        if let Some(service) = self.import_frontend_project(project_dir).await? {
            return Ok(service);
        }

        if has_cargo_toml {
            return self.import_rust_project(project_dir).await;
        }

        match self.import_idea_project(project_dir).await {
      Ok(service) => Ok(service),
      Err(error) if has_package_json => Err(format!(
        "No frontend dev script found in package.json, and Spring Boot IDEA import also failed: {error}"
      )),
      Err(error) => Err(error),
    }
    }

    pub(crate) async fn import_rust_project(
        &self,
        project_dir: &str,
    ) -> BackendResult<ServiceConfig> {
        let project_root = PathBuf::from(project_dir);
        let cargo_file = project_root.join("Cargo.toml");
        let content = fs::read_to_string(&cargo_file).await.map_err(|error| {
            format!(
                "Failed to read Cargo.toml {}: {error}",
                cargo_file.display()
            )
        })?;
        let manifest: CargoManifest = toml::from_str(&content).map_err(|error| {
            format!(
                "Failed to parse Cargo.toml {}: {error}",
                cargo_file.display()
            )
        })?;

        let fallback_name = project_root
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "rust-service".to_string());

        let name = manifest
            .package
            .and_then(|pkg| pkg.name)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or(fallback_name);

        let service = ServiceConfig {
            id: new_id(),
            name,
            service_kind: ServiceKind::Rust,
            framework: Some("rust".to_string()),
            launch_type: LaunchType::CargoRun,
            working_dir: project_dir.to_string(),
            command: "cargo".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            port: None,
            url: None,
            profiles: Vec::new(),
            frontend_script: None,
            maven_force_update: false,
            maven_debug_mode: false,
            maven_disable_fork: false,
            main_class: None,
            classpath: None,
            jvm_args: Vec::new(),
        };

        {
            let mut inner = self.inner.lock().await;
            inner.services.push(service.clone());
            inner.runtime.insert(
                service.id.clone(),
                RuntimeState {
                    service_id: service.id.clone(),
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

        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(service)
    }

    pub(crate) async fn detect_project(
        &self,
        project_dir: &str,
    ) -> BackendResult<ProjectDetection> {
        let project_root = PathBuf::from(project_dir);
        let fallback_name = project_root
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "service".to_string());

        let package_file = project_root.join("package.json");
        if fs::metadata(&package_file).await.is_ok() {
            let content = fs::read_to_string(&package_file).await.map_err(|error| {
                format!(
                    "Failed to read package.json {}: {error}",
                    package_file.display()
                )
            })?;
            let package = serde_json::from_str::<PackageJson>(&content).map_err(|error| {
                format!(
                    "Failed to parse package.json {}: {error}",
                    package_file.display()
                )
            })?;

            if let Some(frontend_script) = select_frontend_script(&package) {
                let name = package
                    .name
                    .as_deref()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| fallback_name.clone());
                return Ok(ProjectDetection {
                    name,
                    service_kind: ServiceKind::Vue,
                    framework: detect_frontend_framework(&package, &project_root)
                        .or_else(|| detect_package_manager_framework(&project_root)),
                    launch_type: LaunchType::VuePreset,
                    command: detect_frontend_package_manager(&project_root),
                    frontend_script: Some(frontend_script),
                });
            }
        }

        let cargo_file = project_root.join("Cargo.toml");
        if fs::metadata(&cargo_file).await.is_ok() {
            let content = fs::read_to_string(&cargo_file).await.map_err(|error| {
                format!(
                    "Failed to read Cargo.toml {}: {error}",
                    cargo_file.display()
                )
            })?;
            if let Ok(manifest) = toml::from_str::<CargoManifest>(&content) {
                let name = manifest
                    .package
                    .and_then(|pkg| pkg.name)
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| fallback_name.clone());
                return Ok(ProjectDetection {
                    name,
                    service_kind: ServiceKind::Rust,
                    framework: Some("rust".to_string()),
                    launch_type: LaunchType::CargoRun,
                    command: "cargo".to_string(),
                    frontend_script: None,
                });
            }
        }

        Ok(ProjectDetection {
            name: fallback_name,
            service_kind: ServiceKind::Spring,
            framework: Some("spring-boot".to_string()),
            launch_type: LaunchType::JavaMain,
            command: String::new(),
            frontend_script: None,
        })
    }

    pub(crate) async fn import_frontend_project(
        &self,
        project_dir: &str,
    ) -> BackendResult<Option<ServiceConfig>> {
        let project_root = PathBuf::from(project_dir);
        let package_file = project_root.join("package.json");
        if fs::metadata(&package_file).await.is_err() {
            return Ok(None);
        }

        let content = fs::read_to_string(&package_file).await.map_err(|error| {
            format!(
                "Failed to read package.json {}: {error}",
                package_file.display()
            )
        })?;
        let package = serde_json::from_str::<PackageJson>(&content).map_err(|error| {
            format!(
                "Failed to parse package.json {}: {error}",
                package_file.display()
            )
        })?;

        let Some(frontend_script) = select_frontend_script(&package) else {
            return Ok(None);
        };

        let working_dir = project_root.to_string_lossy().to_string();
        let name = package
            .name
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                project_root
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(|value| value.to_string())
            })
            .unwrap_or_else(|| "frontend-service".to_string());
        let command = detect_frontend_package_manager(&project_root);
        let framework = detect_frontend_framework(&package, &project_root)
            .or_else(|| detect_package_manager_framework(&project_root))
            .or_else(|| Some("frontend".to_string()));

        let existing_service_id = {
            let inner = self.inner.lock().await;
            inner
                .services
                .iter()
                .find(|service| service.name == name || service.working_dir == working_dir)
                .map(|service| service.id.clone())
        };

        let service = ServiceConfig {
            id: existing_service_id.unwrap_or_else(new_id),
            name,
            service_kind: ServiceKind::Vue,
            framework,
            launch_type: LaunchType::VuePreset,
            working_dir,
            command,
            args: Vec::new(),
            env: HashMap::new(),
            profiles: Vec::new(),
            port: None,
            url: None,
            frontend_script: Some(frontend_script),
            maven_force_update: false,
            maven_debug_mode: false,
            maven_disable_fork: false,
            main_class: None,
            classpath: None,
            jvm_args: Vec::new(),
        };

        self.validate_service(&service).await?;

        {
            let mut inner = self.inner.lock().await;
            if let Some(index) = inner.services.iter().position(|item| item.id == service.id) {
                inner.services[index] = service.clone();
            } else {
                inner.services.push(service.clone());
            }

            inner.runtime.insert(
                service.id.clone(),
                RuntimeState {
                    service_id: service.id.clone(),
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

        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(Some(service))
    }

    pub(crate) async fn save_service(
        &self,
        input: SaveServiceInput,
    ) -> BackendResult<ServiceConfig> {
        let service = self.normalize_service(input).await?;
        self.validate_service(&service).await?;

        {
            let mut inner = self.inner.lock().await;
            if let Some(index) = inner.services.iter().position(|item| item.id == service.id) {
                inner.services[index] = service.clone();
            } else {
                inner.services.push(service.clone());
                inner.runtime.insert(
                    service.id.clone(),
                    RuntimeState {
                        service_id: service.id.clone(),
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
        Ok(service)
    }

    pub(crate) async fn delete_service(&self, service_id: &str) -> BackendResult<()> {
        self.stop_service(service_id).await.ok();
        {
            let mut inner = self.inner.lock().await;
            if !inner
                .services
                .iter()
                .any(|service| service.id == service_id)
            {
                return Err("Service not found.".to_string());
            }
            inner.services.retain(|service| service.id != service_id);
            inner.groups.iter_mut().for_each(|group| {
                group.service_ids.retain(|id| id != service_id);
            });
            inner.runtime.remove(service_id);
            inner.log_history.remove(service_id);
            inner.processes.remove(service_id);
        }
        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(())
    }

    pub(crate) async fn normalize_service(
        &self,
        input: SaveServiceInput,
    ) -> BackendResult<ServiceConfig> {
        let is_new_service = input.id.is_none();
        let working_dir = input.working_dir.trim().to_string();
        if working_dir.is_empty() {
            return Err("Working directory cannot be empty.".to_string());
        }

        fs::metadata(&working_dir)
            .await
            .map_err(|_| "Working directory does not exist. Please verify the path.".to_string())?;

        let mut env = input
            .env
            .into_iter()
            .filter_map(|(key, value)| {
                let key = key.trim().to_string();
                if key.is_empty() {
                    return None;
                }
                Some((key, value.trim().to_string()))
            })
            .collect::<HashMap<_, _>>();

        if matches!(input.service_kind, ServiceKind::Spring)
            && !has_env_key(&env, "JAVA_HOME")
            && !has_env_key(&env, "JDK_HOME")
        {
            if let Some(java_home) = infer_project_java_home(Path::new(&working_dir)) {
                env.insert("JAVA_HOME".to_string(), java_home.clone());
                env.insert("JDK_HOME".to_string(), java_home);
            }
        }

        let service_kind = input.service_kind;
        let launch_type = input.launch_type;
        let command = input.command.trim().to_string();
        let framework = if let Some(framework) = normalize_framework(input.framework) {
            Some(framework)
        } else {
            match service_kind {
                ServiceKind::Spring => Some("spring-boot".to_string()),
                ServiceKind::Vue => detect_frontend_framework_from_dir(Path::new(&working_dir))
                    .await
                    .or_else(|| infer_command_framework(&command))
                    .or_else(|| Some("frontend".to_string())),
                ServiceKind::Rust => None,
            }
        };
        let mut jvm_args = input
            .jvm_args
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>();
        if is_new_service
            && matches!(service_kind, ServiceKind::Spring)
            && matches!(launch_type, LaunchType::JavaMain | LaunchType::Maven)
            && jvm_args.is_empty()
        {
            jvm_args = default_spring_jvm_args();
        }

        Ok(ServiceConfig {
            id: input.id.unwrap_or_else(new_id),
            name: input.name.trim().to_string(),
            service_kind,
            framework,
            launch_type,
            working_dir,
            command,
            args: input
                .args
                .into_iter()
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect(),
            env,
            profiles: input
                .profiles
                .into_iter()
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect(),
            port: input.port,
            url: input
                .url
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            frontend_script: input
                .frontend_script
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            maven_force_update: input.maven_force_update.unwrap_or(false),
            maven_debug_mode: input.maven_debug_mode.unwrap_or(false),
            maven_disable_fork: input.maven_disable_fork.unwrap_or(false),
            main_class: input
                .main_class
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            classpath: input
                .classpath
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            jvm_args,
        })
    }

    pub(crate) async fn validate_service(&self, service: &ServiceConfig) -> BackendResult<()> {
        if service.name.is_empty() {
            return Err("Service name cannot be empty.".to_string());
        }
        match service.service_kind {
            ServiceKind::Spring => {
                if !matches!(
                    service.launch_type,
                    LaunchType::Custom | LaunchType::Maven | LaunchType::JavaMain
                ) {
                    return Err(
            "Spring Boot services only support custom, maven, or java-main launch types."
              .to_string(),
          );
                }
            }
            ServiceKind::Vue => {
                if !matches!(
                    service.launch_type,
                    LaunchType::Custom | LaunchType::VuePreset
                ) {
                    return Err(
                        "Vue services only support custom or vue-preset launch types.".to_string(),
                    );
                }
            }
            ServiceKind::Rust => {
                if !matches!(
                    service.launch_type,
                    LaunchType::Custom | LaunchType::CargoRun
                ) {
                    return Err(
                        "Rust services only support custom or cargo-run launch types.".to_string(),
                    );
                }
            }
        }
        if matches!(service.launch_type, LaunchType::Custom) && service.command.is_empty() {
            return Err("Custom launch requires a command.".to_string());
        }
        if matches!(service.launch_type, LaunchType::JavaMain) && service.main_class.is_none() {
            return Err("Java Main launch requires Main Class.".to_string());
        }
        validate_safe_launch_policy(service)?;

        let inner = self.inner.lock().await;
        if inner
            .services
            .iter()
            .any(|item| item.name == service.name && item.id != service.id)
        {
            return Err("Service name already exists. Please choose another name.".to_string());
        }

        Ok(())
    }

    pub(crate) async fn validate_group(&self, group: &ServiceGroup) -> BackendResult<()> {
        if group.name.is_empty() {
            return Err("Group name cannot be empty.".to_string());
        }

        let inner = self.inner.lock().await;
        if inner
            .groups
            .iter()
            .any(|item| item.name == group.name && item.id != group.id)
        {
            return Err("Group name already exists. Please choose another name.".to_string());
        }
        Ok(())
    }

    pub(crate) async fn scan_spring_services(&self, root_dir: String) -> BackendResult<ScanResult> {
        let root = PathBuf::from(&root_dir);
        if !root.is_dir() {
            return Err(format!("Directory does not exist: {root_dir}"));
        }

        let mut services = Vec::new();

        // 先检查传入目录本身是否是 Spring Boot 服务
        if let Some(scanned) = self.scan_single_spring_service(&root).await {
            services.push(scanned);
        }

        // 再扫描子目录
        let mut entries = fs::read_dir(&root)
            .await
            .map_err(|error| format!("Failed to read directory {}: {error}", root.display()))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| format!("Failed to read directory entry: {error}"))?
        {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let pom_path = path.join("pom.xml");
            if fs::metadata(&pom_path).await.is_err() {
                continue;
            }

            let pom_content = match fs::read_to_string(&pom_path).await {
                Ok(content) => content,
                Err(_) => continue,
            };

            // Check if this is a parent POM with modules
            let module_names = extract_maven_modules(&pom_content);
            if !module_names.is_empty() {
                // Scan child modules (second level)
                for module_name in &module_names {
                    let module_path = path.join(module_name);
                    if !module_path.is_dir() {
                        continue;
                    }
                    if let Some(scanned) = self.scan_single_spring_service(&module_path).await {
                        services.push(scanned);
                    }
                }
            } else {
                // This directory itself might be a Spring Boot service
                if let Some(scanned) = self.scan_single_spring_service(&path).await {
                    services.push(scanned);
                }
            }
        }

        Ok(ScanResult { services })
    }

    pub(crate) async fn scan_single_spring_service(&self, dir: &Path) -> Option<ScannedService> {
        let pom_path = dir.join("pom.xml");
        let pom_content = fs::read_to_string(&pom_path).await.ok()?;

        // Only match modules that have a Spring Boot entry point (@SpringBootApplication).
        // This excludes client/library modules even if they use spring-boot-maven-plugin.
        if !has_spring_application_entry(dir).await {
            return None;
        }

        let name = extract_maven_artifact_id(&pom_content)
            .or_else(|| {
                dir.file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "service".to_string());

        let port = extract_server_port_from_dir(dir).await;

        Some(ScannedService {
            name,
            working_dir: dir.to_string_lossy().to_string(),
            framework: Some("spring-boot".to_string()),
            port,
        })
    }

    pub(crate) async fn batch_import_services(
        &self,
        items: Vec<BatchImportItem>,
    ) -> BackendResult<Vec<ServiceConfig>> {
        let mut results = Vec::new();
        let mut errors = Vec::new();
        for item in items {
            // Skip if already imported (same working_dir)
            {
                let inner = self.inner.lock().await;
                if inner
                    .services
                    .iter()
                    .any(|s| s.working_dir == item.working_dir)
                {
                    continue;
                }
            }

            let count_before = self.inner.lock().await.services.len();
            match self.import_project(&item.working_dir).await {
                Ok(service) => {
                    let count_after = self.inner.lock().await.services.len();
                    if count_after > count_before {
                        results.push(service);
                    }
                }
                Err(error) => {
                    errors.push(format!("{}: {}", item.name, error));
                }
            }
        }
        if results.is_empty() && !errors.is_empty() {
            return Err(format!("All imports failed:\n{}", errors.join("\n")));
        }
        Ok(results)
    }
}
