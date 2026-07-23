use super::*;

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

#[cfg(windows)]
#[derive(Clone)]
pub(crate) struct ProcessJob {
    inner: Arc<ProcessJobInner>,
}

#[cfg(windows)]
struct ProcessJobInner {
    handle: usize,
}

#[cfg(windows)]
impl Drop for ProcessJobInner {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle as HANDLE);
        }
    }
}

#[cfg(windows)]
pub(crate) fn create_process_job() -> BackendResult<ProcessJob> {
    let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if handle.is_null() {
        return Err(format!(
            "Failed to create process job: {}",
            std::io::Error::last_os_error()
        ));
    }

    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let configured = unsafe {
        SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if configured == 0 {
        let error = std::io::Error::last_os_error();
        unsafe {
            CloseHandle(handle);
        }
        return Err(format!("Failed to configure process job: {error}"));
    }

    Ok(ProcessJob {
        inner: Arc::new(ProcessJobInner {
            handle: handle as usize,
        }),
    })
}

#[cfg(windows)]
impl ProcessJob {
    pub(crate) fn assign(&self, pid: u32) -> BackendResult<()> {
        let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
        if process.is_null() {
            return Err(format!(
                "Failed to open managed process {pid}: {}",
                std::io::Error::last_os_error()
            ));
        }
        let assigned = unsafe { AssignProcessToJobObject(self.inner.handle as HANDLE, process) };
        let error = (assigned == 0).then(std::io::Error::last_os_error);
        unsafe {
            CloseHandle(process);
        }
        if let Some(error) = error {
            return Err(format!(
                "Failed to assign process {pid} to ServicePilot: {error}"
            ));
        }
        Ok(())
    }
}

pub(crate) const DEFAULT_SPRING_JVM_ARGS: [&str; 2] = ["-Xms128m", "-Xmx512m"];

pub(crate) fn default_spring_jvm_args() -> Vec<String> {
    DEFAULT_SPRING_JVM_ARGS
        .iter()
        .map(|arg| (*arg).to_string())
        .collect()
}

pub(crate) fn add_default_spring_heap_args_if_missing(args: &mut Vec<String>) {
    if !args.iter().any(|arg| is_initial_heap_arg(arg)) {
        args.insert(0, DEFAULT_SPRING_JVM_ARGS[0].to_string());
    }
    if !args.iter().any(|arg| is_max_heap_arg(arg)) {
        args.push(DEFAULT_SPRING_JVM_ARGS[1].to_string());
    }
}

pub(crate) fn is_initial_heap_arg(arg: &str) -> bool {
    arg.trim().to_ascii_lowercase().starts_with("-xms")
}

pub(crate) fn is_max_heap_arg(arg: &str) -> bool {
    let normalized = arg.trim().to_ascii_lowercase();
    normalized.starts_with("-xmx") || normalized.starts_with("-xx:maxrampercentage=")
}

pub(crate) fn resolve_runtime_url(
    service: &ServiceConfig,
    runtime: Option<&RuntimeState>,
) -> Option<String> {
    runtime
        .and_then(|item| item.detected_url.clone())
        .or_else(|| service.url.clone())
        .or_else(|| {
            runtime.and_then(|item| {
                item.detected_port
                    .map(|port| format!("http://localhost:{port}"))
            })
        })
        .or_else(|| service.port.map(|port| format!("http://localhost:{port}")))
}

pub(crate) async fn kill_process_tree(pid: u32) {
    if pid == 0 {
        return;
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/pid", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        if let Ok(mut child) = cmd.spawn() {
            let _ = child.wait().await;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(mut child) = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            let _ = child.wait().await;
        }
    }
}

pub(crate) fn to_command_line(command: &str, args: &[String]) -> String {
    std::iter::once(command.to_string())
        .chain(args.iter().cloned())
        .map(|token| {
            if token.contains(' ') {
                format!("\"{token}\"")
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn create_launch_spec(service: &ServiceConfig, settings: &AppSettings) -> LaunchSpec {
    match service.launch_type {
        LaunchType::Custom => LaunchSpec {
            command: service.command.clone(),
            args: service.args.clone(),
            env: service.env.clone(),
            command_line: to_command_line(&service.command, &service.args),
        },
        LaunchType::Maven => {
            let command = if service.command.is_empty() {
                "mvn".to_string()
            } else {
                service.command.clone()
            };

            let mut args = Vec::new();
            if !has_maven_flag(&service.args, "-s")
                && !settings.maven_settings_file.trim().is_empty()
            {
                args.push("-s".to_string());
                args.push(settings.maven_settings_file.trim().to_string());
            }
            if !has_maven_repo_override(&service.args)
                && !settings.maven_local_repository.trim().is_empty()
            {
                args.push(format!(
                    "-Dmaven.repo.local={}",
                    settings.maven_local_repository.trim()
                ));
            }
            if service.maven_force_update {
                args.push("-U".to_string());
            }
            if service.maven_debug_mode {
                args.push("-e".to_string());
                args.push("-X".to_string());
            }
            args.push("spring-boot:run".to_string());

            let should_disable_fork = service.maven_disable_fork || service.jvm_args.is_empty();
            let mut env = service.env.clone();
            let mut jvm_args = vec!["-Dfile.encoding=UTF-8".to_string()];
            jvm_args.extend(service.jvm_args.clone());
            if should_disable_fork {
                append_env_arg(&mut env, "MAVEN_OPTS", &jvm_args.join(" "));
            } else if !jvm_args.is_empty() {
                let jvm_args_str = jvm_args.join(" ");
                if jvm_args_str.contains(' ') {
                    args.push(format!(
                        "-Dspring-boot.run.jvmArguments=\"{}\"",
                        jvm_args_str
                    ));
                } else {
                    args.push(format!("-Dspring-boot.run.jvmArguments={}", jvm_args_str));
                }
            }
            if !service.profiles.is_empty() {
                args.push(format!(
                    "-Dspring-boot.run.profiles={}",
                    service.profiles.join(",")
                ));
            }
            if let Some(port) = service.port {
                args.push(format!("-Dspring-boot.run.arguments=--server.port={port}"));
            }
            if should_disable_fork {
                args.push("-Dspring-boot.run.fork=false".to_string());
            }
            args.extend(service.args.clone());
            LaunchSpec {
                command: command.clone(),
                args: args.clone(),
                env,
                command_line: to_command_line(&command, &args),
            }
        }
        LaunchType::JavaMain => {
            let command = if service.command.is_empty() {
                "java".to_string()
            } else {
                service.command.clone()
            };
            let classpath = service
                .classpath
                .clone()
                .unwrap_or_else(|| default_java_classpath(&service.working_dir));
            let mut args = Vec::new();
            args.extend(merge_managed_jvm_args(&service.jvm_args));
            if !classpath.is_empty() {
                args.push("-cp".to_string());
                args.push(classpath);
            }
            if let Some(main_class) = service.main_class.clone() {
                args.push(main_class);
            }
            if !service.profiles.is_empty() {
                args.push(format!(
                    "--spring.profiles.active={}",
                    service.profiles.join(",")
                ));
            }
            if let Some(port) = service.port {
                args.push(format!("--server.port={port}"));
            }
            args.extend(service.args.clone());
            LaunchSpec {
                command: command.clone(),
                args: args.clone(),
                env: service.env.clone(),
                command_line: to_command_line(&command, &args),
            }
        }
        LaunchType::VuePreset => {
            let command = if service.command.is_empty() {
                "npm".to_string()
            } else {
                service.command.clone()
            };
            let args = build_frontend_dev_args(service);
            let mut env = service.env.clone();
            if let Some(port) = service.port {
                if !has_env_key(&env, "PORT") {
                    env.insert("PORT".to_string(), port.to_string());
                }
            }
            LaunchSpec {
                command: command.clone(),
                args: args.clone(),
                env,
                command_line: to_command_line(&command, &args),
            }
        }
        LaunchType::CargoRun => {
            let command = if service.command.is_empty() {
                "cargo".to_string()
            } else {
                service.command.clone()
            };
            let mut args = vec!["run".to_string()];
            if let Some(port) = service.port {
                args.push("--".to_string());
                args.push(format!("--port={port}"));
            }
            args.extend(service.args.clone());
            LaunchSpec {
                command: command.clone(),
                args: args.clone(),
                env: service.env.clone(),
                command_line: to_command_line(&command, &args),
            }
        }
    }
}

pub(crate) fn has_maven_flag(args: &[String], flag: &str) -> bool {
    args.iter()
        .any(|arg| arg == flag || arg.starts_with(&format!("{flag}=")))
}

pub(crate) fn has_maven_repo_override(args: &[String]) -> bool {
    args.iter()
        .any(|arg| arg.starts_with("-Dmaven.repo.local=") || arg == "-Dmaven.repo.local")
}

pub(crate) fn append_env_arg(env: &mut HashMap<String, String>, key: &str, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    env.entry(key.to_string())
        .and_modify(|current| {
            if current.trim().is_empty() {
                *current = value.to_string();
            } else {
                current.push(' ');
                current.push_str(value);
            }
        })
        .or_insert_with(|| value.to_string());
}

pub(crate) fn extract_profiles_from_args(args: &[String]) -> Vec<String> {
    let mut profiles = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let current = args[index].as_str();
        let value = if let Some(value) = current.strip_prefix("--spring.profiles.active=") {
            Some(value)
        } else if let Some(value) = current.strip_prefix("-Dspring.profiles.active=") {
            Some(value)
        } else if current == "--spring.profiles.active" || current == "-Dspring.profiles.active" {
            args.get(index + 1).map(String::as_str)
        } else {
            None
        };

        if let Some(value) = value {
            for profile in value
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
            {
                if !profiles.iter().any(|existing| existing == profile) {
                    profiles.push(profile.to_string());
                }
            }
        }

        index += 1;
    }
    profiles
}

pub(crate) fn extract_port_from_args(args: &[String]) -> Option<u16> {
    let mut index = 0;
    while index < args.len() {
        let current = args[index].as_str();
        let value = if let Some(value) = current.strip_prefix("--server.port=") {
            Some(value)
        } else if current == "--server.port" {
            args.get(index + 1).map(String::as_str)
        } else {
            None
        };

        if let Some(value) = value {
            if let Ok(port) = value.parse::<u16>() {
                return Some(port);
            }
        }

        index += 1;
    }
    None
}

pub(crate) fn strip_managed_spring_args(args: &[String]) -> Vec<String> {
    let mut filtered = Vec::new();
    let mut skip_next = false;

    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }

        if arg == "--spring.profiles.active"
            || arg == "-Dspring.profiles.active"
            || arg == "--server.port"
        {
            skip_next = true;
            continue;
        }

        if arg.starts_with("--spring.profiles.active=")
            || arg.starts_with("-Dspring.profiles.active=")
            || arg.starts_with("--server.port=")
        {
            continue;
        }

        filtered.push(arg.clone());
    }

    filtered
}

pub(crate) fn resolve_jar_command(env: &HashMap<String, String>) -> String {
    let executable = if cfg!(windows) { "jar.exe" } else { "jar" };
    env.get("JAVA_HOME")
        .map(|java_home| Path::new(java_home).join("bin").join(executable))
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| executable.to_string())
}

pub(crate) fn path_to_file_url(path: &Path, is_dir: bool) -> String {
    let mut normalized = path.to_string_lossy().replace('\\', "/");
    if !normalized.starts_with('/') {
        normalized = format!("/{normalized}");
    }
    if is_dir && !normalized.ends_with('/') {
        normalized.push('/');
    }
    let escaped = normalized.replace(' ', "%20");
    format!("file://{escaped}")
}

pub(crate) fn build_manifest_content(classpath_entries: &[String]) -> String {
    let mut manifest = String::from("Manifest-Version: 1.0\r\n");
    let classpath_value = classpath_entries.join(" ");
    append_manifest_header(&mut manifest, "Class-Path", &classpath_value);
    manifest.push_str("Created-By: ServicePilot\r\n\r\n");
    manifest
}

pub(crate) fn append_manifest_header(output: &mut String, name: &str, value: &str) {
    let prefix = format!("{name}: ");
    let mut line = String::new();
    line.push_str(&prefix);

    for ch in value.chars() {
        if line.len() >= 70 {
            output.push_str(&line);
            output.push_str("\r\n ");
            line.clear();
        }
        line.push(ch);
    }

    output.push_str(&line);
    output.push_str("\r\n");
}

pub(crate) fn find_idea_workspace(start: &Path) -> Option<PathBuf> {
    let base = if start.is_file() {
        start.parent()?
    } else {
        start
    };
    for current in base.ancestors() {
        let candidate = current.join(".idea").join("workspace.xml");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

pub(crate) fn default_java_classpath(working_dir: &str) -> String {
    let separator = classpath_separator();
    [
        format!("{working_dir}\\target\\classes"),
        format!("{working_dir}\\target\\test-classes"),
        format!("{working_dir}\\target\\dependency\\*"),
    ]
    .join(separator)
}

pub(crate) fn merge_managed_jvm_args(configured_args: &[String]) -> Vec<String> {
    let mut args = vec!["-Dfile.encoding=UTF-8".to_string()];
    args.extend(
        configured_args
            .iter()
            .filter(|arg| !is_file_encoding_arg(arg))
            .cloned(),
    );
    args
}

pub(crate) fn is_file_encoding_arg(arg: &str) -> bool {
    arg.trim()
        .to_ascii_lowercase()
        .starts_with("-dfile.encoding=")
}

pub(crate) fn contains_servicepilot_classpath_cache(classpath: &str) -> bool {
    split_classpath_entries(classpath).into_iter().any(|entry| {
        Path::new(entry)
            .file_name()
            .and_then(|name| name.to_str())
            .map_or(false, |name| {
                name.eq_ignore_ascii_case("servicepilot-classpath.jar")
            })
    })
}

pub(crate) async fn find_local_maven_module_classes(
    working_dir: &str,
) -> BackendResult<Vec<String>> {
    let working_dir = Path::new(working_dir);
    let pom_file = working_dir.join("pom.xml");
    if fs::metadata(&pom_file).await.is_err() {
        return Ok(Vec::new());
    }

    let pom = fs::read_to_string(&pom_file).await.map_err(|error| {
        format!(
            "Failed to read Maven project file {}: {error}",
            pom_file.display()
        )
    })?;
    let referenced_artifacts = extract_maven_artifact_ids(&pom);
    if referenced_artifacts.is_empty() {
        return Ok(Vec::new());
    }

    let Some(project_root) = working_dir.parent() else {
        return Ok(Vec::new());
    };
    let mut entries = fs::read_dir(project_root).await.map_err(|error| {
        format!(
            "Failed to inspect local Maven modules {}: {error}",
            project_root.display()
        )
    })?;
    let mut class_dirs = Vec::new();

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| format!("Failed to inspect local Maven module entry: {error}"))?
    {
        let path = entry.path();
        if path == working_dir || !path.is_dir() {
            continue;
        }

        let module_pom = path.join("pom.xml");
        if fs::metadata(&module_pom).await.is_err() {
            continue;
        }
        let module_pom_content = match fs::read_to_string(&module_pom).await {
            Ok(content) => content,
            Err(_) => continue,
        };
        let Some(artifact_id) = extract_first_maven_artifact_id(&module_pom_content) else {
            continue;
        };
        if !referenced_artifacts.contains(&artifact_id) {
            continue;
        }

        let classes_dir = path.join("target").join("classes");
        if fs::metadata(&classes_dir).await.is_ok() {
            class_dirs.push(classes_dir.to_string_lossy().to_string());
        }
    }

    class_dirs.sort();
    Ok(class_dirs)
}

pub(crate) fn extract_maven_artifact_ids(pom: &str) -> HashSet<String> {
    let mut artifact_ids = HashSet::new();
    let mut remaining = pom;

    while let Some(start) = remaining.find("<artifactId>") {
        remaining = &remaining[start + "<artifactId>".len()..];
        let Some(end) = remaining.find("</artifactId>") else {
            break;
        };
        let artifact_id = remaining[..end].trim();
        if !artifact_id.is_empty() {
            artifact_ids.insert(artifact_id.to_string());
        }
        remaining = &remaining[end + "</artifactId>".len()..];
    }

    artifact_ids
}

pub(crate) fn extract_first_maven_artifact_id(pom: &str) -> Option<String> {
    let start = pom.find("<artifactId>")? + "<artifactId>".len();
    let end = pom[start..].find("</artifactId>")? + start;
    let artifact_id = pom[start..end].trim();
    (!artifact_id.is_empty()).then(|| artifact_id.to_string())
}

pub(crate) fn split_classpath_entries(classpath: &str) -> Vec<&str> {
    classpath
        .split(classpath_separator())
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .collect()
}

pub(crate) fn normalize_dependency_dir(entry: &str) -> PathBuf {
    let trimmed = entry
        .trim()
        .trim_end_matches('*')
        .trim_end_matches('\\')
        .trim_end_matches('/');
    PathBuf::from(trimmed)
}

#[cfg(windows)]
pub(crate) fn classpath_separator() -> &'static str {
    ";"
}

#[cfg(not(windows))]
pub(crate) fn classpath_separator() -> &'static str {
    ":"
}

pub(crate) fn prepare_spawn_command(launch: &LaunchSpec) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        if should_use_cmd_shell(&launch.command) {
            let mut args = Vec::with_capacity(launch.args.len() + 2);
            args.push("/C".to_string());
            args.push(launch.command.clone());
            args.extend(launch.args.clone());
            return ("cmd".to_string(), args);
        }
    }

    (launch.command.clone(), launch.args.clone())
}

#[cfg(windows)]
pub(crate) fn should_use_cmd_shell(command: &str) -> bool {
    let normalized = command.trim().trim_matches('"');
    if normalized.is_empty() {
        return false;
    }

    let lower = normalized.to_ascii_lowercase();
    if lower.ends_with(".cmd") || lower.ends_with(".bat") {
        return true;
    }

    let path = Path::new(normalized);
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension)
            if extension.eq_ignore_ascii_case("exe") || extension.eq_ignore_ascii_case("com") =>
        {
            false
        }
        Some(_) => false,
        None => matches!(
            lower.as_str(),
            "mvn" | "mvnw" | "npm" | "npx" | "pnpm" | "yarn" | "bun" | "gradlew"
        ),
    }
}

pub(crate) fn validate_safe_launch_policy(service: &ServiceConfig) -> BackendResult<()> {
    match service.launch_type {
        LaunchType::Maven => {
            if !is_maven_command(&service.command) {
                return Err("Maven launch must use mvn or mvnw.".to_string());
            }
        }
        LaunchType::JavaMain => {
            if !is_java_command(&service.command) {
                return Err("Java Main launch must use a java executable.".to_string());
            }
        }
        LaunchType::VuePreset => {
            if !is_node_package_manager_command(&service.command) {
                return Err("Vue preset launch must use npm, pnpm, yarn, or bun.".to_string());
            }
            if let Some(script) = service.frontend_script.as_deref() {
                if is_disallowed_frontend_script_name(script) {
                    return Err(
                        "Frontend preset launch may only run local development scripts."
                            .to_string(),
                    );
                }
            }
        }
        LaunchType::CargoRun => {
            if !is_cargo_command(&service.command) {
                return Err("Cargo run launch must use cargo.".to_string());
            }
        }
        LaunchType::Custom => {
            if !is_allowed_custom_launch_command(service) {
                return Err(
          "Custom launch only supports local development executables such as java, mvn/mvnw, gradle/gradlew, npm/pnpm/yarn/bun, node/npx, and vite."
            .to_string(),
        );
            }
        }
    }

    let executable = executable_stem(&service.command);
    if executable == "git" {
        return Err("Launch commands may not run git operations.".to_string());
    }
    if matches!(
        executable.as_str(),
        "ssh" | "scp" | "sftp" | "ftp" | "rsync" | "kubectl" | "helm"
    ) {
        return Err(
            "Launch commands may not perform remote deployment or file transfer operations."
                .to_string(),
        );
    }

    if is_maven_command(&service.command) {
        if let Some(goal) = service
            .args
            .iter()
            .find(|arg| is_disallowed_maven_goal(arg))
        {
            return Err(format!(
        "Blocked Maven goal `{goal}`. ServicePilot launch may not run install/deploy/release style Maven commands."
      ));
        }
    }

    if is_gradle_command(&service.command) {
        if let Some(task) = service
            .args
            .iter()
            .find(|arg| is_disallowed_gradle_task(arg))
        {
            return Err(format!(
        "Blocked Gradle task `{task}`. ServicePilot launch may not run publish/release style Gradle commands."
      ));
        }
    }

    if is_node_package_manager_command(&service.command) {
        if let Some(task) = service
            .args
            .iter()
            .find(|arg| is_disallowed_node_package_manager_action(arg))
        {
            return Err(format!(
        "Blocked package manager action `{task}`. ServicePilot launch may not run install/publish/version style package commands."
      ));
        }
    }

    if executable == "docker" {
        if let Some(action) = service
            .args
            .iter()
            .map(|arg| arg.trim().to_ascii_lowercase())
            .find(|arg| matches!(arg.as_str(), "push" | "login" | "logout"))
        {
            return Err(format!(
        "Blocked Docker action `{action}`. ServicePilot launch may not publish or authenticate against remote registries."
      ));
        }
    }

    Ok(())
}
