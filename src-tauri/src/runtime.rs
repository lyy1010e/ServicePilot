use super::*;

impl ServicePilotBackend {
    pub(crate) async fn build_idea_java_main_classpath(
        &self,
        working_dir: &str,
        settings: &AppSettings,
        env: &HashMap<String, String>,
        service_id: Option<&str>,
    ) -> BackendResult<String> {
        let launch_support_dir = self.launch_support_dir(working_dir)?;
        let classpath_file = launch_support_dir.join("servicepilot.classpath");
        let classes_dir = Path::new(working_dir).join("target").join("classes");
        let output_file = classpath_file.to_string_lossy().to_string();

        let mut args = Vec::new();
        if !settings.maven_settings_file.trim().is_empty() {
            args.push("-s".to_string());
            args.push(settings.maven_settings_file.trim().to_string());
        }
        if !settings.maven_local_repository.trim().is_empty() {
            args.push(format!(
                "-Dmaven.repo.local={}",
                settings.maven_local_repository.trim()
            ));
        }
        args.push("-DskipTests".to_string());
        args.push("dependency:build-classpath".to_string());
        args.push(format!("-Dmdep.outputFile={output_file}"));
        args.push(format!("-Dmdep.pathSeparator={}", classpath_separator()));
        args.push("-Dmdep.outputAbsoluteArtifactFilename=true".to_string());

        let launch = LaunchSpec {
            command: "mvn".to_string(),
            args,
            env: env.clone(),
            command_line: String::new(),
        };
        let (process_command, process_args) = prepare_spawn_command(&launch);

        let mut classpath_cmd = Command::new(&process_command);
        classpath_cmd
            .args(&process_args)
            .current_dir(working_dir)
            .envs(env)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        classpath_cmd.creation_flags(CREATE_NO_WINDOW);
        let output = self
            .run_startup_helper_command(
                service_id,
                classpath_cmd,
                "Failed to prepare Java Main classpath",
            )
            .await?;

        if !output.status.success() {
            let stdout = decode_process_output(&output.stdout);
            let stderr = decode_process_output(&output.stderr);
            let details = [stdout.trim(), stderr.trim()]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            return Err(if details.is_empty() {
                "Failed to build Java dependency classpath with Maven.".to_string()
            } else {
                format!("Failed to build Java dependency classpath with Maven.\n{details}")
            });
        }

        let dependency_classpath = fs::read_to_string(&classpath_file).await.map_err(|error| {
            format!(
                "Failed to read generated classpath file {}: {error}",
                classpath_file.display()
            )
        })?;

        let mut dependency_entries = Vec::new();
        dependency_entries.extend(
            dependency_classpath
                .split(classpath_separator())
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(ToOwned::to_owned),
        );
        let local_module_classes = find_local_maven_module_classes(working_dir).await?;

        let bootstrap_jar = launch_support_dir.join("servicepilot-classpath.jar");
        self.write_java_classpath_manifest_jar(
            &bootstrap_jar,
            &classes_dir,
            &dependency_entries,
            env,
            service_id,
        )
        .await?;

        let mut classpath_entries = vec![classes_dir.to_string_lossy().to_string()];
        classpath_entries.extend(local_module_classes);
        classpath_entries.push(bootstrap_jar.to_string_lossy().to_string());

        Ok(classpath_entries.join(classpath_separator()))
    }

    pub(crate) fn launch_support_dir(&self, working_dir: &str) -> BackendResult<PathBuf> {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        working_dir.hash(&mut hasher);
        let key = format!("{:016x}", hasher.finish());

        let base_dir = self
            .app
            .path()
            .app_cache_dir()
            .or_else(|_| self.app.path().app_data_dir())
            .map_err(|error| format!("Failed to resolve launch cache directory: {error}"))?;

        Ok(base_dir.join("launch-cache").join(key))
    }

    pub(crate) async fn run_startup_helper_command(
        &self,
        service_id: Option<&str>,
        mut command: Command,
        error_context: &str,
    ) -> BackendResult<std::process::Output> {
        let mut child = command
            .spawn()
            .map_err(|error| format!("{error_context}: {error}"))?;
        let pid = child.id().unwrap_or_default();

        if let Some(service_id) = service_id {
            if !self.track_startup_helper_process(service_id, pid).await {
                kill_process_tree(pid).await;
                let _ = child.wait().await;
                return Err("Startup canceled.".to_string());
            }
        }

        let output = child
            .wait_with_output()
            .await
            .map_err(|error| format!("{error_context}: {error}"));

        if let Some(service_id) = service_id {
            self.untrack_startup_helper_process(service_id, pid).await;
        }

        output
    }

    pub(crate) async fn write_java_classpath_manifest_jar(
        &self,
        bootstrap_jar: &Path,
        classes_dir: &Path,
        dependency_entries: &[String],
        env: &HashMap<String, String>,
        service_id: Option<&str>,
    ) -> BackendResult<()> {
        let manifest_file = bootstrap_jar.with_extension("mf");
        let mut manifest_entries = Vec::with_capacity(dependency_entries.len() + 1);
        manifest_entries.push(path_to_file_url(classes_dir, true));
        manifest_entries.extend(
            dependency_entries
                .iter()
                .map(|entry| path_to_file_url(Path::new(entry), false)),
        );

        if let Some(parent) = bootstrap_jar.parent() {
            fs::create_dir_all(parent).await.map_err(|error| {
                format!("Failed to create directory {}: {error}", parent.display())
            })?;
        }

        let manifest = build_manifest_content(&manifest_entries);
        fs::write(&manifest_file, manifest).await.map_err(|error| {
            format!(
                "Failed to write manifest file {}: {error}",
                manifest_file.display()
            )
        })?;

        let jar_command = resolve_jar_command(env);
        let launch = LaunchSpec {
            command: jar_command.clone(),
            args: vec![
                "cfm".to_string(),
                bootstrap_jar.to_string_lossy().to_string(),
                manifest_file.to_string_lossy().to_string(),
            ],
            env: env.clone(),
            command_line: String::new(),
        };
        let (process_command, process_args) = prepare_spawn_command(&launch);
        let mut jar_cmd = Command::new(&process_command);
        jar_cmd
            .args(&process_args)
            .envs(env)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        jar_cmd.creation_flags(CREATE_NO_WINDOW);
        let output = self
            .run_startup_helper_command(
                service_id,
                jar_cmd,
                "Failed to build classpath manifest jar",
            )
            .await?;

        if !output.status.success() {
            let stdout = decode_process_output(&output.stdout);
            let stderr = decode_process_output(&output.stderr);
            let details = [stdout.trim(), stderr.trim()]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            return Err(if details.is_empty() {
                "Failed to build classpath manifest jar.".to_string()
            } else {
                format!("Failed to build classpath manifest jar.\n{details}")
            });
        }

        Ok(())
    }

    pub(crate) async fn start_service(&self, service_id: &str) -> BackendResult<()> {
        let (service, settings, clear_logs_on_start) = {
            let mut inner = self.inner.lock().await;
            let service = inner
                .services
                .iter()
                .find(|item| item.id == service_id)
                .cloned()
                .ok_or_else(|| "Service not found.".to_string())?;
            if let Some(runtime) = inner.runtime.get(service_id) {
                if matches!(
                    runtime.status,
                    RuntimeStatus::Running | RuntimeStatus::Starting
                ) {
                    return Ok(());
                }
            }
            let clear_logs_on_start = inner.settings.clear_logs_on_restart;
            if clear_logs_on_start {
                inner.log_history.remove(service_id);
            }
            (service, inner.settings.clone(), clear_logs_on_start)
        };
        if clear_logs_on_start {
            self.emit_snapshot().await;
        }

        let mut service = service;
        if self.should_prepare_java_main_classpath(&service).await {
            self.mark_project_preparing(service_id, "Preparing Java classpath...".to_string())
                .await;
            let classpath = match self
                .build_idea_java_main_classpath(
                    &service.working_dir,
                    &settings,
                    &service.env,
                    Some(service_id),
                )
                .await
            {
                Ok(classpath) => classpath,
                Err(error) => {
                    if self.startup_was_canceled(service_id).await {
                        self.log_startup_canceled(service_id).await;
                        return Ok(());
                    }
                    self.append_log(service_id, LogSource::System, error).await;
                    let message = classpath_preparation_failed_message();
                    self.mark_process_failed(service_id, message.clone(), FailureCategory::Compile)
                        .await;
                    return Err(message);
                }
            };
            if self.startup_was_canceled(service_id).await {
                self.log_startup_canceled(service_id).await;
                return Ok(());
            }
            self.update_service_classpath(service_id, classpath.clone())
                .await?;
            if self.startup_was_canceled(service_id).await {
                self.log_startup_canceled(service_id).await;
                return Ok(());
            }
            service.classpath = Some(classpath);
        }

        self.validate_launch_readiness(&service).await?;

        let launch = self.build_launch_spec(&service, &settings);
        let started_at = now_iso_string();

        {
            let mut inner = self.inner.lock().await;
            inner.runtime.insert(
                service_id.to_string(),
                RuntimeState {
                    service_id: service_id.to_string(),
                    status: RuntimeStatus::Starting,
                    pid: None,
                    started_at: Some(started_at.clone()),
                    elapsed_seconds: None,
                    exit_code: None,
                    message: Some(launch.command_line.clone()),
                    detected_port: None,
                    detected_url: None,
                    failure_summary: None,
                    failure_category: None,
                },
            );
        }
        self.emit_snapshot().await;
        self.append_log(
            service_id,
            LogSource::System,
            format!("Launching: {}", launch.command_line),
        )
        .await;
        if self.startup_was_canceled(service_id).await {
            self.log_startup_canceled(service_id).await;
            return Ok(());
        }

        let (process_command, process_args) = prepare_spawn_command(&launch);
        let mut command = Command::new(&process_command);
        command
            .args(&process_args)
            .current_dir(&service.working_dir)
            .envs(std::env::vars())
            .envs(&launch.env)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null())
            .kill_on_drop(false);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                if self.startup_was_canceled(service_id).await {
                    self.log_startup_canceled(service_id).await;
                    return Ok(());
                }
                self.mark_process_failed(service_id, error.to_string(), FailureCategory::Process)
                    .await;
                return Err(error.to_string());
            }
        };

        let pid = child.id().unwrap_or_default();

        let should_keep_process = {
            let mut inner = self.inner.lock().await;
            let startup_active = inner
                .runtime
                .get(service_id)
                .map(|runtime| matches!(runtime.status, RuntimeStatus::Starting))
                .unwrap_or(false);
            if startup_active {
                inner
                    .processes
                    .insert(service_id.to_string(), ManagedProcess { pid });
                if let Some(runtime) = inner.runtime.get_mut(service_id) {
                    // Spring Boot 服务保持 Starting 状态，直到检测到启动完成日志
                    if matches!(service.service_kind, ServiceKind::Spring) {
                        runtime.status = RuntimeStatus::Starting;
                    } else {
                        runtime.status = RuntimeStatus::Running;
                    }
                    runtime.pid = Some(pid);
                    runtime.started_at = Some(started_at);
                    runtime.elapsed_seconds = None;
                    // 不显示完整命令行，使用简洁的启动提示
                    runtime.message = None;
                }
            }
            startup_active
        };
        if !should_keep_process {
            kill_process_tree(pid).await;
            self.log_startup_canceled(service_id).await;
            return Ok(());
        }
        self.emit_snapshot().await;
        self.append_log(
            service_id,
            LogSource::System,
            format!("Started with PID {}.", pid),
        )
        .await;

        let service_kind = service.service_kind.clone();
        let service_name = service.name.clone();
        let main_class = service.main_class.clone();
        if let Some(stdout) = child.stdout.take() {
            let backend = self.clone();
            let service_id = service_id.to_string();
            let service_kind = service_kind.clone();
            let service_name = service_name.clone();
            let main_class = main_class.clone();
            tauri::async_runtime::spawn(async move {
                let mut reader = BufReader::new(stdout);
                let mut bytes = Vec::new();
                while let Ok(read) = reader.read_until(b'\n', &mut bytes).await {
                    if read == 0 {
                        break;
                    }
                    let line = decode_process_line(&bytes);
                    bytes.clear();
                    // 检测 Spring Boot 启动完成标志
                    if matches!(service_kind, ServiceKind::Spring)
                        && is_spring_started_line(&line, &service_name, main_class.as_deref())
                    {
                        backend.mark_service_running(&service_id).await;
                    }
                    backend
                        .append_log(&service_id, LogSource::Stdout, line)
                        .await;
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let backend = self.clone();
            let service_id = service_id.to_string();
            let service_kind = service_kind.clone();
            let service_name = service_name.clone();
            let main_class = main_class.clone();
            tauri::async_runtime::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut bytes = Vec::new();
                while let Ok(read) = reader.read_until(b'\n', &mut bytes).await {
                    if read == 0 {
                        break;
                    }
                    let line = decode_process_line(&bytes);
                    bytes.clear();
                    if matches!(service_kind, ServiceKind::Spring)
                        && is_spring_started_line(&line, &service_name, main_class.as_deref())
                    {
                        backend.mark_service_running(&service_id).await;
                    }
                    backend
                        .append_log(&service_id, LogSource::Stderr, line)
                        .await;
                }
            });
        }

        let backend = self.clone();
        let service_id = service_id.to_string();
        tauri::async_runtime::spawn(async move {
            let status = child.wait().await.ok();
            backend.handle_process_exit(&service_id, status).await;
        });

        Ok(())
    }

    pub(crate) async fn validate_launch_readiness(
        &self,
        service: &ServiceConfig,
    ) -> BackendResult<()> {
        if !matches!(service.launch_type, LaunchType::JavaMain) {
            return Ok(());
        }

        let classes_dir = Path::new(&service.working_dir)
            .join("target")
            .join("classes");
        if fs::metadata(&classes_dir).await.is_err() {
            return Err(format!(
        "Java Main launch requires compiled classes. Missing: {}. Compile the project in IDEA or run mvn compile first.",
        classes_dir.display()
      ));
        }

        let classpath = service
            .classpath
            .clone()
            .unwrap_or_else(|| default_java_classpath(&service.working_dir));

        let dependency_entry = split_classpath_entries(&classpath)
            .into_iter()
            .find(|entry| {
                let normalized = entry.replace('\\', "/");
                normalized.contains("target/dependency/") && normalized.ends_with('*')
            });

        if let Some(entry) = dependency_entry {
            let dependency_dir = normalize_dependency_dir(entry);
            if fs::metadata(&dependency_dir).await.is_err() {
                return Err(format!(
          "Java Main launch did not find dependency jars. Missing: {}. Run mvn dependency:copy-dependencies first.",
          dependency_dir.display()
        ));
            }
        }

        Ok(())
    }

    pub(crate) async fn should_prepare_java_main_classpath(&self, service: &ServiceConfig) -> bool {
        if !matches!(service.launch_type, LaunchType::JavaMain) {
            return false;
        }

        let classpath = service
            .classpath
            .clone()
            .unwrap_or_else(|| default_java_classpath(&service.working_dir));

        if contains_servicepilot_classpath_cache(&classpath) {
            return true;
        }

        let uses_dependency_wildcard =
            split_classpath_entries(&classpath)
                .into_iter()
                .any(|entry| {
                    let normalized = entry.replace('\\', "/");
                    normalized.contains("target/dependency/") && normalized.ends_with('*')
                });
        if !uses_dependency_wildcard {
            return false;
        }

        let classes_dir = Path::new(&service.working_dir)
            .join("target")
            .join("classes");
        if fs::metadata(&classes_dir).await.is_err() {
            return false;
        }

        split_classpath_entries(&classpath)
            .into_iter()
            .any(|entry| {
                let normalized = entry.replace('\\', "/");
                normalized.contains("target/dependency/")
                    && normalized.ends_with('*')
                    && !normalize_dependency_dir(entry).exists()
            })
    }

    pub(crate) async fn stop_service(&self, service_id: &str) -> BackendResult<()> {
        let pid = {
            let mut inner = self.inner.lock().await;
            let Some(process) = inner.processes.get(service_id).cloned() else {
                if let Some(runtime) = inner.runtime.get_mut(service_id) {
                    runtime.status = RuntimeStatus::Stopped;
                    runtime.failure_summary = None;
                    runtime.failure_category = None;
                    runtime.pid = None;
                    runtime.elapsed_seconds = None;
                }
                drop(inner);
                self.emit_snapshot().await;
                return Ok(());
            };

            if let Some(runtime) = inner.runtime.get_mut(service_id) {
                runtime.status = RuntimeStatus::Stopping;
                runtime.pid = Some(process.pid);
            }
            process.pid
        };

        self.emit_snapshot().await;
        self.append_log(
            service_id,
            LogSource::System,
            "Stopping service...".to_string(),
        )
        .await;
        kill_process_tree(pid).await;
        Ok(())
    }

    pub(crate) async fn restart_service(&self, service_id: &str) -> BackendResult<()> {
        let clear_logs = {
            let mut inner = self.inner.lock().await;
            let clear_logs = inner.settings.clear_logs_on_restart;
            if clear_logs {
                inner.log_history.remove(service_id);
            }
            clear_logs
        };
        if clear_logs {
            self.emit_snapshot().await;
        }
        self.stop_service(service_id).await?;
        sleep(Duration::from_millis(400)).await;
        self.start_service(service_id).await
    }

    pub(crate) async fn open_service_url(&self, service_id: &str) -> BackendResult<()> {
        let (service, runtime) = {
            let inner = self.inner.lock().await;
            let service = inner
                .services
                .iter()
                .find(|item| item.id == service_id)
                .cloned()
                .ok_or_else(|| "Service not found.".to_string())?;
            let runtime = inner.runtime.get(service_id).cloned();
            (service, runtime)
        };

        let url = resolve_runtime_url(&service, runtime.as_ref())
            .ok_or_else(|| "The current service does not have an openable URL.".to_string())?;
        self.app
            .opener()
            .open_url(url, None::<String>)
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) async fn shutdown(&self) -> BackendResult<()> {
        let running_ids = {
            let inner = self.inner.lock().await;
            inner.processes.keys().cloned().collect::<Vec<_>>()
        };
        for service_id in running_ids {
            self.stop_service(&service_id).await.ok();
        }
        sleep(Duration::from_millis(250)).await;
        // 清理 launch-cache
        if let Ok(cache_dir) = self.app.path().app_cache_dir() {
            let launch_cache = cache_dir.join("launch-cache");
            let _ = fs::remove_dir_all(&launch_cache).await;
        }
        Ok(())
    }

    pub(crate) fn build_launch_spec(
        &self,
        service: &ServiceConfig,
        settings: &AppSettings,
    ) -> LaunchSpec {
        create_launch_spec(service, settings)
    }

    pub(crate) async fn mark_service_running(&self, service_id: &str) {
        let mut inner = self.inner.lock().await;
        if let Some(runtime) = inner.runtime.get_mut(service_id) {
            if matches!(runtime.status, RuntimeStatus::Starting) {
                runtime.status = RuntimeStatus::Running;
            }
        }
        drop(inner);
        self.emit_snapshot().await;
    }

    pub(crate) async fn handle_process_exit(
        &self,
        service_id: &str,
        status: Option<std::process::ExitStatus>,
    ) {
        let previous = {
            let mut inner = self.inner.lock().await;
            let previous = inner.runtime.get(service_id).cloned();
            inner.processes.remove(service_id);
            previous
        };

        let elapsed_seconds = previous
            .as_ref()
            .and_then(|runtime| runtime.started_at.as_deref())
            .and_then(compute_elapsed_seconds);

        let stopping = previous
            .as_ref()
            .map(|runtime| matches!(runtime.status, RuntimeStatus::Stopping))
            .unwrap_or(false);
        let code = status.and_then(|value| value.code());
        let next_status = if stopping || code == Some(0) {
            RuntimeStatus::Stopped
        } else {
            RuntimeStatus::Failed
        };

        {
            let mut inner = self.inner.lock().await;
            if let Some(runtime) = inner.runtime.get_mut(service_id) {
                runtime.status = next_status.clone();
                runtime.exit_code = code;
                runtime.pid = None;
                runtime.elapsed_seconds = elapsed_seconds;
                runtime.message = Some(match code {
                    Some(value) => format!("Exited with code {value}"),
                    None => "Process exited.".to_string(),
                });
                if matches!(next_status, RuntimeStatus::Stopped) {
                    runtime.failure_summary = None;
                    runtime.failure_category = None;
                } else if runtime.failure_summary.is_none() {
                    runtime.failure_summary = Some(match code {
                        Some(value) => format!("Process exited with code {value}"),
                        None => "Process exited.".to_string(),
                    });
                    runtime.failure_category = Some(FailureCategory::Process);
                }
            }
        }

        self.emit_snapshot().await;
        let log_line = match code {
            Some(value) => format!("Process exited with code {value}."),
            None => "Process exited.".to_string(),
        };
        self.append_log(service_id, LogSource::System, log_line)
            .await;
    }

    pub(crate) async fn mark_process_failed(
        &self,
        service_id: &str,
        message: String,
        category: FailureCategory,
    ) {
        {
            let mut inner = self.inner.lock().await;
            if let Some(runtime) = inner.runtime.get_mut(service_id) {
                runtime.status = RuntimeStatus::Failed;
                runtime.exit_code = None;
                runtime.message = Some(message.clone());
                runtime.failure_summary = Some(message.clone());
                runtime.failure_category = Some(category);
            }
        }
        self.emit_snapshot().await;
        self.append_log(
            service_id,
            LogSource::System,
            format!("Failed to start: {message}"),
        )
        .await;
    }

    pub(crate) async fn mark_project_preparing(&self, service_id: &str, message: String) {
        {
            let mut inner = self.inner.lock().await;
            if let Some(runtime) = inner.runtime.get_mut(service_id) {
                runtime.status = RuntimeStatus::Starting;
                runtime.started_at = Some(now_iso_string());
                runtime.elapsed_seconds = None;
                runtime.exit_code = None;
                runtime.message = Some(message.clone());
                runtime.failure_summary = None;
                runtime.failure_category = None;
            }
        }
        self.emit_snapshot().await;
        self.append_log(service_id, LogSource::System, message)
            .await;
    }

    pub(crate) async fn startup_was_canceled(&self, service_id: &str) -> bool {
        let inner = self.inner.lock().await;
        !matches!(
            inner.runtime.get(service_id).map(|runtime| &runtime.status),
            Some(RuntimeStatus::Starting)
        )
    }

    pub(crate) async fn log_startup_canceled(&self, service_id: &str) {
        {
            let mut inner = self.inner.lock().await;
            if let Some(runtime) = inner.runtime.get_mut(service_id) {
                runtime.status = RuntimeStatus::Stopped;
                runtime.pid = None;
                runtime.elapsed_seconds = None;
                runtime.failure_summary = None;
                runtime.failure_category = None;
            }
        }
        self.emit_snapshot().await;
        self.append_log(
            service_id,
            LogSource::System,
            "Startup canceled.".to_string(),
        )
        .await;
    }

    pub(crate) async fn track_startup_helper_process(&self, service_id: &str, pid: u32) -> bool {
        let mut inner = self.inner.lock().await;
        let startup_active = inner
            .runtime
            .get(service_id)
            .map(|runtime| matches!(runtime.status, RuntimeStatus::Starting))
            .unwrap_or(false);
        if startup_active {
            inner
                .processes
                .insert(service_id.to_string(), ManagedProcess { pid });
            if let Some(runtime) = inner.runtime.get_mut(service_id) {
                runtime.pid = Some(pid);
            }
        }
        startup_active
    }

    pub(crate) async fn untrack_startup_helper_process(&self, service_id: &str, pid: u32) {
        let mut inner = self.inner.lock().await;
        let tracked_pid = inner.processes.get(service_id).map(|process| process.pid);
        if tracked_pid == Some(pid) {
            inner.processes.remove(service_id);
            if let Some(runtime) = inner.runtime.get_mut(service_id) {
                if matches!(runtime.status, RuntimeStatus::Starting) {
                    runtime.pid = None;
                }
            }
        }
    }

    pub(crate) async fn update_service_classpath(
        &self,
        service_id: &str,
        classpath: String,
    ) -> BackendResult<()> {
        {
            let mut inner = self.inner.lock().await;
            let Some(service) = inner.services.iter_mut().find(|item| item.id == service_id) else {
                return Err("Service not found.".to_string());
            };
            service.classpath = Some(classpath);
        }
        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(())
    }
}
