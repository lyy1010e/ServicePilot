use std::{
  collections::{HashMap, HashSet},
  hash::{Hash, Hasher},
  path::{Path, PathBuf},
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
  },
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, Window, Wry};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use tokio::{
  fs,
  io::{AsyncBufReadExt, BufReader},
  process::Command,
  sync::Mutex,
  time::{sleep, Duration},
};

const DATA_FILE: &str = "service-pilot-state.json";
const MAX_LOG_ENTRIES: usize = 2000;

type BackendResult<T> = Result<T, String>;

#[derive(Clone)]
struct AppState {
  backend: Arc<ServicePilotBackend>,
}

#[derive(Clone)]
struct ServicePilotBackend {
  app: AppHandle<Wry>,
  state_file: PathBuf,
  inner: Arc<Mutex<BackendState>>,
}

struct BackendState {
  services: Vec<ServiceConfig>,
  groups: Vec<ServiceGroup>,
  settings: AppSettings,
  runtime: HashMap<String, RuntimeState>,
  log_history: HashMap<String, Vec<LogEntry>>,
  processes: HashMap<String, ManagedProcess>,
}

#[derive(Clone)]
struct ManagedProcess {
  pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ServiceKind {
  Spring,
  Vue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum LaunchType {
  #[serde(rename = "custom")]
  Custom,
  #[serde(rename = "maven")]
  Maven,
  #[serde(rename = "java-main")]
  JavaMain,
  #[serde(rename = "vue-preset")]
  VuePreset,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum AppLanguage {
  #[serde(rename = "zh-CN")]
  ZhCn,
  #[serde(rename = "en-US")]
  EnUs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum RuntimeStatus {
  Stopped,
  Starting,
  Running,
  Failed,
  Stopping,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum LogSource {
  Stdout,
  Stderr,
  System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum FailureCategory {
  Dependency,
  Port,
  Plugin,
  Compile,
  Config,
  Process,
  Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceConfig {
  id: String,
  name: String,
  service_kind: ServiceKind,
  launch_type: LaunchType,
  working_dir: String,
  command: String,
  #[serde(default)]
  args: Vec<String>,
  #[serde(default)]
  env: HashMap<String, String>,
  #[serde(default)]
  profiles: Vec<String>,
  port: Option<u16>,
  url: Option<String>,
  frontend_script: Option<String>,
  #[serde(default)]
  maven_force_update: bool,
  #[serde(default)]
  maven_debug_mode: bool,
  #[serde(default)]
  maven_disable_fork: bool,
  main_class: Option<String>,
  classpath: Option<String>,
  #[serde(default)]
  jvm_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceGroup {
  id: String,
  name: String,
  #[serde(default)]
  service_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeState {
  service_id: String,
  status: RuntimeStatus,
  pid: Option<u32>,
  started_at: Option<String>,
  elapsed_seconds: Option<u64>,
  exit_code: Option<i32>,
  message: Option<String>,
  detected_port: Option<u16>,
  detected_url: Option<String>,
  failure_summary: Option<String>,
  failure_category: Option<FailureCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogEntry {
  id: String,
  service_id: String,
  timestamp: String,
  source: LogSource,
  text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
  language: AppLanguage,
  #[serde(default)]
  maven_settings_file: String,
  #[serde(default)]
  maven_local_repository: String,
  #[serde(default = "default_true")]
  clear_logs_on_restart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
  version: u8,
  #[serde(default)]
  services: Vec<ServiceConfig>,
  #[serde(default)]
  groups: Vec<ServiceGroup>,
  #[serde(default = "default_settings")]
  settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSnapshot {
  services: Vec<ServiceConfig>,
  groups: Vec<ServiceGroup>,
  runtime: HashMap<String, RuntimeState>,
  settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDetection {
  name: String,
  service_kind: ServiceKind,
  launch_type: LaunchType,
  command: String,
  frontend_script: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveServiceInput {
  id: Option<String>,
  name: String,
  service_kind: ServiceKind,
  launch_type: LaunchType,
  working_dir: String,
  #[serde(default)]
  command: String,
  #[serde(default)]
  args: Vec<String>,
  #[serde(default)]
  env: HashMap<String, String>,
  #[serde(default)]
  profiles: Vec<String>,
  port: Option<u16>,
  url: Option<String>,
  frontend_script: Option<String>,
  maven_force_update: Option<bool>,
  maven_debug_mode: Option<bool>,
  maven_disable_fork: Option<bool>,
  main_class: Option<String>,
  classpath: Option<String>,
  #[serde(default)]
  jvm_args: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PackageJson {
  name: Option<String>,
  #[serde(default)]
  scripts: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveGroupInput {
  id: Option<String>,
  name: String,
  #[serde(default)]
  service_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogFilter {
  name: String,
  extensions: Vec<String>,
}

#[derive(Clone)]
struct LaunchSpec {
  command: String,
  args: Vec<String>,
  env: HashMap<String, String>,
  command_line: String,
}

#[derive(Clone)]
struct FailureInsight {
  category: FailureCategory,
  summary: String,
  score: u8,
}

#[derive(Debug, Clone)]
struct IdeaSpringRunConfig {
  name: String,
  module_name: Option<String>,
  main_class: String,
  working_directory: Option<String>,
  jvm_args: Vec<String>,
  program_args: Vec<String>,
  env: HashMap<String, String>,
}

struct PreparedIdeaProject {
  service: ServiceConfig,
  imported_settings: AppSettings,
  prepared_settings: AppSettings,
}

impl ServicePilotBackend {
  async fn new(app: AppHandle<Wry>) -> BackendResult<Self> {
    let user_data_path = app
      .path()
      .app_data_dir()
      .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    let state_file = user_data_path.join(DATA_FILE);
    Ok(Self {
      app,
      state_file,
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

  async fn init(&self) -> BackendResult<()> {
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

  async fn get_snapshot(&self) -> AppSnapshot {
    let inner = self.inner.lock().await;
    AppSnapshot {
      services: inner.services.clone(),
      groups: inner.groups.clone(),
      runtime: inner.runtime.clone(),
      settings: inner.settings.clone(),
    }
  }

  async fn list_services(&self) -> Vec<ServiceConfig> {
    self.inner.lock().await.services.clone()
  }

  async fn list_groups(&self) -> Vec<ServiceGroup> {
    self.inner.lock().await.groups.clone()
  }

  async fn set_language(&self, language: AppLanguage) -> BackendResult<()> {
    {
      let mut inner = self.inner.lock().await;
      inner.settings.language = language;
    }
    self.persist_state().await?;
    self.emit_snapshot().await;
    Ok(())
  }

  async fn save_settings(&self, settings: AppSettings) -> BackendResult<()> {
    {
      let mut inner = self.inner.lock().await;
      inner.settings = settings;
    }
    self.persist_state().await?;
    self.emit_snapshot().await;
    Ok(())
  }

  async fn import_idea_maven_config(&self, project_dir: &str) -> BackendResult<AppSettings> {
    let workspace_file = find_idea_workspace(Path::new(project_dir))
      .ok_or_else(|| format!("IDEA workspace file not found under or above: {project_dir}"))?;
    let content = fs::read_to_string(&workspace_file).await.map_err(|_| {
      format!(
        "IDEA workspace file not found: {}",
        workspace_file.display()
      )
    })?;

    let maven_settings_file =
      extract_xml_option_value(&content, "userSettingsFile").ok_or_else(|| {
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

  async fn import_idea_project(&self, project_dir: &str) -> BackendResult<ServiceConfig> {
    let prepared = self.prepare_idea_project(project_dir, false).await?;
    self
      .save_imported_project_service(
        prepared.service,
        &prepared.imported_settings,
        RuntimeStatus::Stopped,
        None,
      )
      .await
  }

  async fn prepare_idea_project(
    &self,
    project_dir: &str,
    prepare_classpath: bool,
  ) -> BackendResult<PreparedIdeaProject> {
    let selected_path = Path::new(project_dir);
    let workspace_file = find_idea_workspace(selected_path)
      .ok_or_else(|| format!("IDEA workspace file not found under or above: {project_dir}"))?;
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
    .ok_or_else(|| format!("No matching Spring Boot run configuration found for {project_dir}"))?;

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
          service.name == selected_config.name
            || (service.working_dir == working_dir
              && service.main_class.as_deref() == Some(selected_config.main_class.as_str()))
        })
        .map(|service| service.id.clone())
    };

    let mut env = selected_config.env.clone();
    if let Some(java_home) = jdk_home {
      env
        .entry("JAVA_HOME".to_string())
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
        self
          .inner
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
      self
        .build_idea_java_main_classpath(&working_dir, &prepared_settings, &env)
        .await?
    } else {
      default_java_classpath(&working_dir)
    };

    let java_command = env
      .get("JAVA_HOME")
      .map(|java_home| {
        Path::new(java_home)
          .join("bin")
          .join(if cfg!(windows) { "java.exe" } else { "java" })
      })
      .filter(|path| path.exists())
      .map(|path| path.to_string_lossy().to_string())
      .unwrap_or_else(|| "java".to_string());

    // 构建 JVM 参数，确保 -Dfile.encoding=UTF-8 在最前面
    let jvm_args = merge_managed_jvm_args(&selected_config.jvm_args);

    let service = ServiceConfig {
      id: existing_service_id.unwrap_or_else(new_id),
      name: selected_config.name.clone(),
      service_kind: ServiceKind::Spring,
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
      prepared_settings,
    })
  }

  async fn save_imported_project_service(
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
        inner.settings.maven_local_repository = imported_settings.maven_local_repository.clone();
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

  async fn import_project(&self, project_dir: &str) -> BackendResult<ServiceConfig> {
    let has_package_json = Path::new(project_dir).join("package.json").exists();

    if let Some(service) = self.import_frontend_project(project_dir).await? {
      return Ok(service);
    }

    match self.import_idea_project(project_dir).await {
      Ok(service) => Ok(service),
      Err(error) if has_package_json => Err(format!(
        "No frontend dev script found in package.json, and Spring Boot IDEA import also failed: {error}"
      )),
      Err(error) => Err(error),
    }
  }

  async fn detect_project(&self, project_dir: &str) -> BackendResult<ProjectDetection> {
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
          .map(|value| value.trim().to_string())
          .filter(|value| !value.is_empty())
          .unwrap_or_else(|| fallback_name.clone());
        return Ok(ProjectDetection {
          name,
          service_kind: ServiceKind::Vue,
          launch_type: LaunchType::VuePreset,
          command: detect_frontend_package_manager(&project_root),
          frontend_script: Some(frontend_script),
        });
      }
    }

    Ok(ProjectDetection {
      name: fallback_name,
      service_kind: ServiceKind::Spring,
      launch_type: LaunchType::JavaMain,
      command: String::new(),
      frontend_script: None,
    })
  }

  async fn quick_start_project(&self, project_dir: &str) -> BackendResult<ServiceConfig> {
    let has_package_json = Path::new(project_dir).join("package.json").exists();

    if let Some(service) = self.import_frontend_project(project_dir).await? {
      self
        .mark_project_preparing(&service.id, "Preparing project startup...".to_string())
        .await;
      let backend = self.clone();
      let service_id = service.id.clone();
      tauri::async_runtime::spawn(async move {
        if let Err(error) = backend.start_service(&service_id).await {
          backend
            .mark_process_failed(&service_id, error, FailureCategory::Process)
            .await;
        }
      });
      return Ok(service);
    }

    let prepared = match self.prepare_idea_project(project_dir, false).await {
      Ok(prepared) => prepared,
      Err(error) if has_package_json => {
        return Err(format!(
          "No frontend dev script found in package.json, and Spring Boot IDEA import also failed: {error}"
        ));
      }
      Err(error) => return Err(error),
    };

    let service = self
      .save_imported_project_service(
        prepared.service.clone(),
        &prepared.imported_settings,
        RuntimeStatus::Starting,
        Some("Preparing project startup...".to_string()),
      )
      .await?;
    self
      .append_log(
        &service.id,
        LogSource::System,
        "Preparing Java classpath in the background...".to_string(),
      )
      .await;

    let backend = self.clone();
    let service_id = service.id.clone();
    let working_dir = service.working_dir.clone();
    let env = service.env.clone();
    let settings = prepared.prepared_settings.clone();
    tauri::async_runtime::spawn(async move {
      let result = async {
        let classpath = backend
          .build_idea_java_main_classpath(&working_dir, &settings, &env)
          .await?;
        if !backend.should_continue_background_start(&service_id).await {
          return Ok(());
        }
        backend
          .update_service_classpath(&service_id, classpath)
          .await?;
        backend
          .append_log(
            &service_id,
            LogSource::System,
            "Java classpath prepared. Launching service...".to_string(),
          )
          .await;
        backend.start_service(&service_id).await
      }
      .await;

      if let Err(error) = result {
        backend
          .append_log(&service_id, LogSource::System, error)
          .await;
        backend
          .mark_process_failed(
            &service_id,
            classpath_preparation_failed_message(),
            FailureCategory::Compile,
          )
          .await;
      }
    });

    Ok(service)
  }

  async fn import_frontend_project(
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

  async fn build_idea_java_main_classpath(
    &self,
    working_dir: &str,
    settings: &AppSettings,
    env: &HashMap<String, String>,
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

    let output = Command::new(&process_command)
      .args(&process_args)
      .current_dir(working_dir)
      .envs(env)
      .output()
      .await
      .map_err(|error| format!("Failed to prepare Java Main classpath: {error}"))?;

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
    self
      .write_java_classpath_manifest_jar(&bootstrap_jar, &classes_dir, &dependency_entries, env)
      .await?;

    let mut classpath_entries = vec![classes_dir.to_string_lossy().to_string()];
    classpath_entries.extend(local_module_classes);
    classpath_entries.push(bootstrap_jar.to_string_lossy().to_string());

    Ok(classpath_entries.join(classpath_separator()))
  }

  fn launch_support_dir(&self, working_dir: &str) -> BackendResult<PathBuf> {
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

  async fn write_java_classpath_manifest_jar(
    &self,
    bootstrap_jar: &Path,
    classes_dir: &Path,
    dependency_entries: &[String],
    env: &HashMap<String, String>,
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
      fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("Failed to create directory {}: {error}", parent.display()))?;
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
    let output = Command::new(&process_command)
      .args(&process_args)
      .envs(env)
      .output()
      .await
      .map_err(|error| format!("Failed to build classpath manifest jar: {error}"))?;

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

  async fn get_log_history(&self, service_id: &str) -> BackendResult<Vec<LogEntry>> {
    let inner = self.inner.lock().await;
    if !inner
      .services
      .iter()
      .any(|service| service.id == service_id)
    {
      return Err("Service not found.".to_string());
    }
    Ok(
      inner
        .log_history
        .get(service_id)
        .cloned()
        .unwrap_or_default(),
    )
  }

  async fn save_service(&self, input: SaveServiceInput) -> BackendResult<ServiceConfig> {
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

  async fn delete_service(&self, service_id: &str) -> BackendResult<()> {
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

  async fn save_group(&self, input: SaveGroupInput) -> BackendResult<ServiceGroup> {
    let mut ids = Vec::new();
    let services = self.list_services().await;
    let service_set: HashSet<String> = services.into_iter().map(|service| service.id).collect();
    for service_id in input.service_ids {
      if service_set.contains(&service_id) && !ids.contains(&service_id) {
        ids.push(service_id);
      }
    }

    let group = ServiceGroup {
      id: input.id.unwrap_or_else(new_id),
      name: input.name.trim().to_string(),
      service_ids: ids,
    };

    self.validate_group(&group).await?;

    {
      let mut inner = self.inner.lock().await;
      if let Some(index) = inner.groups.iter().position(|item| item.id == group.id) {
        inner.groups[index] = group.clone();
      } else {
        inner.groups.push(group.clone());
      }
    }

    self.persist_state().await?;
    self.emit_snapshot().await;
    Ok(group)
  }

  async fn delete_group(&self, group_id: &str) -> BackendResult<()> {
    {
      let mut inner = self.inner.lock().await;
      if !inner.groups.iter().any(|group| group.id == group_id) {
        return Err("分组不存在。".to_string());
      }
      inner.groups.retain(|group| group.id != group_id);
    }
    self.persist_state().await?;
    self.emit_snapshot().await;
    Ok(())
  }

  async fn move_group(&self, group_id: &str, target_index: usize) -> BackendResult<()> {
    {
      let mut inner = self.inner.lock().await;
      let current_index = inner
        .groups
        .iter()
        .position(|group| group.id == group_id)
        .ok_or_else(|| "Group not found.".to_string())?;

      if inner.groups.len() <= 1 {
        return Ok(());
      }

      let bounded_index = target_index.min(inner.groups.len() - 1);
      if bounded_index == current_index {
        return Ok(());
      }

      let group = inner.groups.remove(current_index);
      inner.groups.insert(bounded_index, group);
    }
    self.persist_state().await?;
    self.emit_snapshot().await;
    Ok(())
  }

  async fn start_service(&self, service_id: &str) -> BackendResult<()> {
    let (service, settings) = {
      let inner = self.inner.lock().await;
      let service = inner
        .services
        .iter()
        .find(|item| item.id == service_id)
        .cloned()
        .ok_or_else(|| "Service not found.".to_string())?;
      if let Some(runtime) = inner.runtime.get(service_id) {
        if matches!(runtime.status, RuntimeStatus::Running)
          || (matches!(runtime.status, RuntimeStatus::Starting)
            && inner.processes.contains_key(service_id))
        {
          return Ok(());
        }
      }
      (service, inner.settings.clone())
    };

    let mut service = service;
    if self.should_prepare_java_main_classpath(&service).await {
      self
        .mark_project_preparing(service_id, "Preparing Java classpath...".to_string())
        .await;
      let classpath = match self
        .build_idea_java_main_classpath(&service.working_dir, &settings, &service.env)
        .await
      {
        Ok(classpath) => classpath,
        Err(error) => {
          self.append_log(service_id, LogSource::System, error).await;
          let message = classpath_preparation_failed_message();
          self
            .mark_process_failed(service_id, message.clone(), FailureCategory::Compile)
            .await;
          return Err(message);
        }
      };
      self
        .update_service_classpath(service_id, classpath.clone())
        .await?;
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
    self
      .append_log(
        service_id,
        LogSource::System,
        format!("Launching: {}", launch.command_line),
      )
      .await;

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

    let mut child = match command.spawn() {
      Ok(child) => child,
      Err(error) => {
        self
          .mark_process_failed(service_id, error.to_string(), FailureCategory::Process)
          .await;
        return Err(error.to_string());
      }
    };

    let pid = child.id().unwrap_or_default();

    {
      let mut inner = self.inner.lock().await;
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
    self.emit_snapshot().await;
    self
      .append_log(
        service_id,
        LogSource::System,
        format!("Started with PID {}.", pid),
      )
      .await;

    let service_kind = service.service_kind.clone();
    if let Some(stdout) = child.stdout.take() {
      let backend = self.clone();
      let service_id = service_id.to_string();
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
          if matches!(service_kind, ServiceKind::Spring) {
            let line_lower = line.to_lowercase();
            if (line_lower.contains("started") && line_lower.contains("application"))
              || (line_lower.contains("started") && line_lower.contains("umsp"))
              || (line_lower.contains("started") && line_lower.contains("in"))
            {
              backend.mark_service_running(&service_id).await;
            }
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
      tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut bytes = Vec::new();
        while let Ok(read) = reader.read_until(b'\n', &mut bytes).await {
          if read == 0 {
            break;
          }
          let line = decode_process_line(&bytes);
          bytes.clear();
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

  async fn validate_launch_readiness(&self, service: &ServiceConfig) -> BackendResult<()> {
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

  async fn should_prepare_java_main_classpath(&self, service: &ServiceConfig) -> bool {
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

    let uses_dependency_wildcard = split_classpath_entries(&classpath)
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

  async fn stop_service(&self, service_id: &str) -> BackendResult<()> {
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
    self
      .append_log(
        service_id,
        LogSource::System,
        "Stopping service...".to_string(),
      )
      .await;
    kill_process_tree(pid).await;
    Ok(())
  }

  async fn restart_service(&self, service_id: &str) -> BackendResult<()> {
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

  async fn start_group(&self, group_id: &str) -> BackendResult<()> {
    let group = self.require_group(group_id).await?;
    for service_id in group.service_ids {
      self.start_service(&service_id).await?;
      sleep(Duration::from_millis(300)).await;
    }
    Ok(())
  }

  async fn stop_group(&self, group_id: &str) -> BackendResult<()> {
    let group = self.require_group(group_id).await?;
    for service_id in group.service_ids.into_iter().rev() {
      self.stop_service(&service_id).await?;
      sleep(Duration::from_millis(200)).await;
    }
    Ok(())
  }

  async fn open_service_url(&self, service_id: &str) -> BackendResult<()> {
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
    self
      .app
      .opener()
      .open_url(url, None::<String>)
      .map_err(|error| error.to_string())?;
    Ok(())
  }

  async fn shutdown(&self) -> BackendResult<()> {
    let running_ids = {
      let inner = self.inner.lock().await;
      inner.processes.keys().cloned().collect::<Vec<_>>()
    };
    for service_id in running_ids {
      self.stop_service(&service_id).await.ok();
    }
    sleep(Duration::from_millis(250)).await;
    Ok(())
  }

  async fn export_state_to_file(&self, file_path: &Path) -> BackendResult<()> {
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

  async fn import_state_from_file(&self, file_path: &Path) -> BackendResult<()> {
    let content = fs::read_to_string(file_path)
      .await
      .map_err(|error| error.to_string())?;
    let parsed =
      serde_json::from_str::<PersistedState>(&content).map_err(|error| error.to_string())?;
    self.validate_imported_state(&parsed).await?;
    self.shutdown().await?;

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

  async fn dialog_language(&self) -> AppLanguage {
    self.inner.lock().await.settings.language.clone()
  }

  async fn normalize_service(&self, input: SaveServiceInput) -> BackendResult<ServiceConfig> {
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

    Ok(ServiceConfig {
      id: input.id.unwrap_or_else(new_id),
      name: input.name.trim().to_string(),
      service_kind: input.service_kind,
      launch_type: input.launch_type,
      working_dir,
      command: input.command.trim().to_string(),
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
      jvm_args: input
        .jvm_args
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect(),
    })
  }

  async fn validate_service(&self, service: &ServiceConfig) -> BackendResult<()> {
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
          return Err("Vue services only support custom or vue-preset launch types.".to_string());
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

  async fn validate_group(&self, group: &ServiceGroup) -> BackendResult<()> {
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

  fn build_launch_spec(&self, service: &ServiceConfig, settings: &AppSettings) -> LaunchSpec {
    create_launch_spec(service, settings)
  }

  async fn persist_state(&self) -> BackendResult<()> {
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

  async fn read_state(&self) -> BackendResult<PersistedState> {
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

  async fn emit_snapshot(&self) {
    let snapshot = self.get_snapshot().await;
    let _ = self.app.emit("snapshot:update", snapshot);
  }

  async fn append_log(&self, service_id: &str, source: LogSource, raw_text: String) {
    let parts = raw_text
      .replace('\r', "")
      .split('\n')
      .map(str::trim_end)
      .filter(|line| !line.is_empty())
      .map(ToOwned::to_owned)
      .collect::<Vec<_>>();

    if parts.is_empty() {
      return;
    }

    for text in parts {
      let text = strip_ansi_sequences(&text);
      if text.is_empty() {
        continue;
      }
      let entry = LogEntry {
        id: new_id(),
        service_id: service_id.to_string(),
        timestamp: now_iso_string(),
        source: source.clone(),
        text: text.clone(),
      };

      {
        let mut inner = self.inner.lock().await;
        let history = inner.log_history.entry(service_id.to_string()).or_default();
        if let Some(previous) = history.last_mut() {
          if should_merge_log_line(previous, &entry) {
            previous.text.push('\n');
            previous.text.push_str(&entry.text);
            let merged = previous.clone();
            drop(inner);
            let _ = self.app.emit("log:entry", merged);
            self.detect_access_info(service_id, &text).await;
            self
              .detect_failure_summary(service_id, &source, &text)
              .await;
            continue;
          }
        }
        history.push(entry.clone());
        if history.len() > MAX_LOG_ENTRIES {
          let remove = history.len() - MAX_LOG_ENTRIES;
          history.drain(0..remove);
        }
      }

      let _ = self.app.emit("log:entry", entry.clone());
      self.detect_access_info(service_id, &text).await;
      self
        .detect_failure_summary(service_id, &source, &text)
        .await;
    }
  }

  async fn append_log_entry(&self, service_id: &str, source: LogSource, text: String) {
    let text = strip_ansi_sequences(&text);
    if text.is_empty() {
      return;
    }
    let entry = LogEntry {
      id: new_id(),
      service_id: service_id.to_string(),
      timestamp: now_iso_string(),
      source,
      text,
    };

    {
      let mut inner = self.inner.lock().await;
      let history = inner.log_history.entry(service_id.to_string()).or_default();
      history.push(entry.clone());
      if history.len() > MAX_LOG_ENTRIES {
        let remove = history.len() - MAX_LOG_ENTRIES;
        history.drain(0..remove);
      }
    }

    let _ = self.app.emit("log:entry", entry);
  }

  async fn detect_access_info(&self, service_id: &str, text: &str) {
    let mut notice = None;
    let mut changed = false;
    {
      let mut inner = self.inner.lock().await;
      let Some(runtime) = inner.runtime.get_mut(service_id) else {
        return;
      };

      let detected_url = extract_url(text);
      let detected_port = extract_port(text);

      if detected_url.is_some() && runtime.detected_url != detected_url {
        runtime.detected_url = detected_url.clone();
        changed = true;
      }

      if detected_port.is_some() && runtime.detected_port != detected_port {
        runtime.detected_port = detected_port;
        changed = true;
      }

      if let Some(url) = detected_url {
        notice = Some(format!("Detected access URL: {url}"));
      } else if let Some(port) = detected_port {
        notice = Some(format!("Detected access URL: http://localhost:{port}"));
      }
    }

    if changed {
      self.emit_snapshot().await;
    }

    if let Some(message) = notice {
      self.append_system_notice_once(service_id, &message).await;
    }
  }

  async fn append_system_notice_once(&self, service_id: &str, text: &str) {
    let exists = {
      let inner = self.inner.lock().await;
      inner
        .log_history
        .get(service_id)
        .map(|entries| {
          entries
            .iter()
            .any(|entry| matches!(entry.source, LogSource::System) && entry.text == text)
        })
        .unwrap_or(false)
    };
    if !exists {
      self
        .append_log_entry(service_id, LogSource::System, text.to_string())
        .await;
    }
  }

  async fn detect_failure_summary(&self, service_id: &str, source: &LogSource, text: &str) {
    if matches!(source, LogSource::System) {
      return;
    }

    let Some(summary) = extract_failure_summary(text) else {
      return;
    };

    let should_update = {
      let inner = self.inner.lock().await;
      let current = inner.runtime.get(service_id);
      let current_score = current
        .and_then(|item| item.failure_summary.clone())
        .map(|message| classify_failure_insight(&message).score)
        .unwrap_or(0);
      summary.score >= current_score
    };

    if !should_update {
      return;
    }

    {
      let mut inner = self.inner.lock().await;
      if let Some(runtime) = inner.runtime.get_mut(service_id) {
        runtime.failure_summary = Some(summary.summary);
        runtime.failure_category = Some(summary.category);
      }
    }
    self.emit_snapshot().await;
  }

  async fn mark_service_running(&self, service_id: &str) {
    let mut inner = self.inner.lock().await;
    if let Some(runtime) = inner.runtime.get_mut(service_id) {
      if matches!(runtime.status, RuntimeStatus::Starting) {
        runtime.status = RuntimeStatus::Running;
      }
    }
    drop(inner);
    self.emit_snapshot().await;
  }

  async fn handle_process_exit(&self, service_id: &str, status: Option<std::process::ExitStatus>) {
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
    self
      .append_log(service_id, LogSource::System, log_line)
      .await;
  }

  async fn mark_process_failed(
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
    self
      .append_log(
        service_id,
        LogSource::System,
        format!("Failed to start: {message}"),
      )
      .await;
  }

  async fn mark_project_preparing(&self, service_id: &str, message: String) {
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
    self
      .append_log(service_id, LogSource::System, message)
      .await;
  }

  async fn update_service_classpath(
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

  async fn should_continue_background_start(&self, service_id: &str) -> bool {
    let inner = self.inner.lock().await;
    inner
      .runtime
      .get(service_id)
      .map(|runtime| {
        matches!(runtime.status, RuntimeStatus::Starting)
          && !inner.processes.contains_key(service_id)
      })
      .unwrap_or(false)
  }

  async fn validate_imported_state(&self, state: &PersistedState) -> BackendResult<()> {
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

  async fn require_group(&self, group_id: &str) -> BackendResult<ServiceGroup> {
    let inner = self.inner.lock().await;
    inner
      .groups
      .iter()
      .find(|group| group.id == group_id)
      .cloned()
      .ok_or_else(|| "分组不存在。".to_string())
  }
}

#[tauri::command]
async fn get_snapshot(state: State<'_, AppState>) -> BackendResult<AppSnapshot> {
  Ok(state.backend.get_snapshot().await)
}

#[tauri::command]
async fn list_services(state: State<'_, AppState>) -> BackendResult<Vec<ServiceConfig>> {
  Ok(state.backend.list_services().await)
}

#[tauri::command]
async fn list_groups(state: State<'_, AppState>) -> BackendResult<Vec<ServiceGroup>> {
  Ok(state.backend.list_groups().await)
}

#[tauri::command]
async fn get_log_history(
  state: State<'_, AppState>,
  service_id: String,
) -> BackendResult<Vec<LogEntry>> {
  state.backend.get_log_history(&service_id).await
}

#[tauri::command]
async fn set_language(state: State<'_, AppState>, language: AppLanguage) -> BackendResult<()> {
  state.backend.set_language(language).await
}

#[tauri::command]
async fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> BackendResult<()> {
  state.backend.save_settings(settings).await
}

#[tauri::command]
async fn detect_project(
  state: State<'_, AppState>,
  project_dir: String,
) -> BackendResult<ProjectDetection> {
  state.backend.detect_project(&project_dir).await
}

#[tauri::command]
async fn save_service(
  state: State<'_, AppState>,
  input: SaveServiceInput,
) -> BackendResult<ServiceConfig> {
  state.backend.save_service(input).await
}

#[tauri::command]
async fn delete_service(state: State<'_, AppState>, service_id: String) -> BackendResult<()> {
  state.backend.delete_service(&service_id).await
}

#[tauri::command]
async fn start_service(state: State<'_, AppState>, service_id: String) -> BackendResult<()> {
  state.backend.start_service(&service_id).await
}

#[tauri::command]
async fn stop_service(state: State<'_, AppState>, service_id: String) -> BackendResult<()> {
  state.backend.stop_service(&service_id).await
}

#[tauri::command]
async fn restart_service(state: State<'_, AppState>, service_id: String) -> BackendResult<()> {
  state.backend.restart_service(&service_id).await
}

#[tauri::command]
async fn open_service_url(state: State<'_, AppState>, service_id: String) -> BackendResult<()> {
  state.backend.open_service_url(&service_id).await
}

#[tauri::command]
async fn save_group(
  state: State<'_, AppState>,
  input: SaveGroupInput,
) -> BackendResult<ServiceGroup> {
  state.backend.save_group(input).await
}

#[tauri::command]
async fn delete_group(state: State<'_, AppState>, group_id: String) -> BackendResult<()> {
  state.backend.delete_group(&group_id).await
}

#[tauri::command]
async fn move_group(
  state: State<'_, AppState>,
  group_id: String,
  target_index: usize,
) -> BackendResult<()> {
  state.backend.move_group(&group_id, target_index).await
}

#[tauri::command]
async fn start_group(state: State<'_, AppState>, group_id: String) -> BackendResult<()> {
  state.backend.start_group(&group_id).await
}

#[tauri::command]
async fn stop_group(state: State<'_, AppState>, group_id: String) -> BackendResult<()> {
  state.backend.stop_group(&group_id).await
}

#[tauri::command]
async fn pick_directory(
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
async fn pick_file(
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
async fn import_idea_maven_config(
  state: State<'_, AppState>,
  project_dir: String,
) -> BackendResult<AppSettings> {
  state.backend.import_idea_maven_config(&project_dir).await
}

#[tauri::command]
async fn import_idea_project(
  state: State<'_, AppState>,
  project_dir: String,
) -> BackendResult<ServiceConfig> {
  state.backend.import_idea_project(&project_dir).await
}

#[tauri::command]
async fn import_project(
  state: State<'_, AppState>,
  project_dir: String,
) -> BackendResult<ServiceConfig> {
  state.backend.import_project(&project_dir).await
}

#[tauri::command]
async fn quick_start_project(
  state: State<'_, AppState>,
  project_dir: String,
) -> BackendResult<ServiceConfig> {
  state.backend.quick_start_project(&project_dir).await
}

#[tauri::command]
async fn export_state(app: AppHandle<Wry>, state: State<'_, AppState>) -> BackendResult<()> {
  let language = state.backend.dialog_language().await;
  let title = match language {
    AppLanguage::ZhCn => "导出 ServicePilot 配置",
    AppLanguage::EnUs => "Export ServicePilot Config",
  };

  let result = tokio::task::spawn_blocking(move || {
    app
      .dialog()
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
async fn import_state(app: AppHandle<Wry>, state: State<'_, AppState>) -> BackendResult<()> {
  let language = state.backend.dialog_language().await;
  let title = match language {
    AppLanguage::ZhCn => "导入 ServicePilot 配置",
    AppLanguage::EnUs => "Import ServicePilot Config",
  };

  let result = tokio::task::spawn_blocking(move || {
    app
      .dialog()
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
async fn shutdown(state: State<'_, AppState>) -> BackendResult<()> {
  state.backend.shutdown().await
}

#[tauri::command]
fn minimize_window(window: Window) -> BackendResult<()> {
  window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_maximize_window(window: Window) -> BackendResult<()> {
  if window.is_maximized().map_err(|error| error.to_string())? {
    window.unmaximize().map_err(|error| error.to_string())
  } else {
    window.maximize().map_err(|error| error.to_string())
  }
}

#[tauri::command]
fn start_window_drag(window: Window) -> BackendResult<()> {
  window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn close_window(window: Window) -> BackendResult<()> {
  window.close().map_err(|error| error.to_string())
}

pub fn run() {
  let exit_guard = Arc::new(AtomicBool::new(false));

  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      let app_handle = app.handle().clone();
      let backend = tauri::async_runtime::block_on(ServicePilotBackend::new(app_handle))
        .unwrap_or_else(|error| panic!("failed to initialize backend: {error}"));
      tauri::async_runtime::block_on(backend.init())
        .unwrap_or_else(|error| panic!("failed to load backend state: {error}"));
      app.manage(AppState {
        backend: Arc::new(backend),
      });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_snapshot,
      list_services,
      list_groups,
      get_log_history,
      set_language,
      save_settings,
      detect_project,
      save_service,
      delete_service,
      start_service,
      stop_service,
      restart_service,
      open_service_url,
      save_group,
      delete_group,
      move_group,
      start_group,
      stop_group,
      pick_directory,
      pick_file,
      import_idea_maven_config,
      import_project,
      quick_start_project,
      import_idea_project,
      export_state,
      import_state,
      minimize_window,
      toggle_maximize_window,
      start_window_drag,
      close_window,
      shutdown
    ]);

  let app = builder
    .build(tauri::generate_context!())
    .expect("failed to build tauri application");

  app.run({
    let exit_guard = exit_guard.clone();
    move |app_handle, event| {
      if let RunEvent::ExitRequested { api, .. } = event {
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
    }
  });
}

fn resolve_runtime_url(service: &ServiceConfig, runtime: Option<&RuntimeState>) -> Option<String> {
  runtime
    .and_then(|item| item.detected_url.clone())
    .or_else(|| service.url.clone())
    .or_else(|| {
      runtime.and_then(|item| {
        item
          .detected_port
          .map(|port| format!("http://localhost:{port}"))
      })
    })
    .or_else(|| service.port.map(|port| format!("http://localhost:{port}")))
}

fn extract_url(text: &str) -> Option<String> {
  let cleaned = strip_ansi_sequences(text);
  if let Some(url) = extract_local_url(&cleaned) {
    return Some(url);
  }

  if !should_detect_url_from_line(&cleaned) {
    return None;
  }

  extract_local_url(&cleaned)
}

fn extract_local_url(text: &str) -> Option<String> {
  let prefixes = [
    "http://localhost:",
    "https://localhost:",
    "http://127.0.0.1:",
    "https://127.0.0.1:",
    "http://0.0.0.0:",
    "https://0.0.0.0:",
  ];
  let lower = text.to_ascii_lowercase();
  prefixes.iter().find_map(|prefix| {
    lower.find(prefix).map(|start| {
      text[start..]
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_end_matches(|ch: char| matches!(ch, '"' | '\'' | ',' | ';' | ')' | '/'))
        .to_string()
    })
  })
}

fn should_detect_url_from_line(text: &str) -> bool {
  let cleaned = strip_ansi_sequences(text);
  let trimmed = cleaned.trim();
  let lower = trimmed.to_ascii_lowercase();

  let allow_markers = [
    "tomcat started on port",
    "netty started on port",
    "started on port",
    "listening on 0.0.0.0 port",
    "listening on port",
    "local: http://",
    "local: https://",
    "access url",
    "available at",
    "open your browser",
  ];

  if allow_markers.iter().any(|marker| lower.contains(marker)) {
    return true;
  }

  let deny_markers = [
    "url:",
    "-url:",
    "_url:",
    "dataid:",
    "parse data from nacos error",
  ];

  if deny_markers.iter().any(|marker| lower.contains(marker)) {
    return false;
  }

  false
}

fn extract_port(text: &str) -> Option<u16> {
  let cleaned = strip_ansi_sequences(text);
  if let Some(port) = extract_port_from_local_url(&cleaned) {
    return Some(port);
  }

  if !should_detect_port_from_line(&cleaned) {
    return None;
  }

  let patterns = [
    "Tomcat started on port(s):",
    "Tomcat started on port ",
    "Netty started on port ",
    "started on port:",
    "started on port ",
    "Local: http://localhost:",
    "Local: https://localhost:",
    "listening on 0.0.0.0 port ",
    "listening on port ",
  ];

  for pattern in patterns {
    if let Some(index) = cleaned.find(pattern) {
      let remainder = &cleaned[index + pattern.len()..];
      let digits = remainder
        .chars()
        .skip_while(|char| !char.is_ascii_digit())
        .take_while(|char| char.is_ascii_digit())
        .collect::<String>();
      if let Ok(port) = digits.parse::<u16>() {
        if port > 0 {
          return Some(port);
        }
      }
    }
  }
  None
}

fn extract_port_from_local_url(text: &str) -> Option<u16> {
  let prefixes = [
    "http://localhost:",
    "https://localhost:",
    "http://127.0.0.1:",
    "https://127.0.0.1:",
    "http://0.0.0.0:",
    "https://0.0.0.0:",
  ];

  let lower = text.to_ascii_lowercase();
  prefixes.iter().find_map(|prefix| {
    lower.find(prefix).and_then(|start| {
      let port_start = start + prefix.len();
      let digits = lower[port_start..]
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
      digits.parse::<u16>().ok().filter(|port| *port > 0)
    })
  })
}

fn extract_failure_summary(text: &str) -> Option<FailureInsight> {
  if text.contains("MalformedInputException") {
    return Some(FailureInsight {
      category: FailureCategory::Config,
      summary: "Nacos配置编码错误：请检查Nacos控制台中umsp-dev.yml、umsp.yml、share-module.yml等配置文件，确保使用UTF-8编码，无GBK/中文特殊字符".to_string(),
      score: 10,
    });
  }

  if text.contains("parse data from Nacos error") {
    return Some(FailureInsight {
      category: FailureCategory::Config,
      summary: "Nacos配置解析失败：请检查Nacos控制台中的YAML配置文件格式是否正确".to_string(),
      score: 9,
    });
  }

  if text.contains("Failed to determine a suitable driver class") {
    return Some(FailureInsight {
      category: FailureCategory::Config,
      summary: "Datasource configuration was not loaded successfully".to_string(),
      score: 7,
    });
  }

  if text.contains("Failed to configure a DataSource") {
    return Some(FailureInsight {
      category: FailureCategory::Config,
      summary: "Datasource configuration is missing or invalid".to_string(),
      score: 6,
    });
  }

  if !text.contains("[ERROR]") && !text.contains("BUILD FAILURE") {
    return None;
  }

  if text.contains("BUILD FAILURE") {
    return Some(FailureInsight {
      category: FailureCategory::Process,
      summary: "Build failure".to_string(),
      score: 1,
    });
  }

  let cleaned = text.trim_start_matches("[ERROR]").trim().to_string();
  if cleaned.is_empty()
    || cleaned.starts_with("To see the full stack trace")
    || cleaned.starts_with("Re-run Maven")
    || cleaned.starts_with("For more information")
    || cleaned.starts_with("[Help")
  {
    return None;
  }

  Some(classify_failure_insight(&cleaned))
}

fn classify_failure_insight(summary: &str) -> FailureInsight {
  let checks: &[(FailureCategory, u8, &[&str])] = &[
    (
      FailureCategory::Port,
      6,
      &[
        "Port ",
        "already in use",
        "Address already in use",
        "BindException",
        "Failed to bind",
      ],
    ),
    (
      FailureCategory::Plugin,
      6,
      &["No plugin found for prefix", "spring-boot-maven-plugin"],
    ),
    (
      FailureCategory::Dependency,
      6,
      &[
        "Could not resolve dependencies",
        "Failed to collect dependencies",
        "Failed to read artifact descriptor",
        "was not found",
        "Could not find artifact",
        "The POM for",
      ],
    ),
    (
      FailureCategory::Compile,
      6,
      &[
        "COMPILATION ERROR",
        "Compilation failure",
        "cannot find symbol",
        "package ",
      ],
    ),
    (
      FailureCategory::Config,
      5,
      &[
        "BeanCreationException",
        "ApplicationContextException",
        "UnsatisfiedDependencyException",
        "Failed to bind properties",
        "Invalid configuration",
        "Error creating bean",
      ],
    ),
  ];

  for (category, score, tokens) in checks {
    if tokens.iter().all(|token| summary.contains(token))
      || tokens.iter().any(|token| summary.contains(token))
    {
      return FailureInsight {
        category: category.clone(),
        summary: summary.to_string(),
        score: *score,
      };
    }
  }

  FailureInsight {
    category: FailureCategory::Unknown,
    summary: summary.to_string(),
    score: 3,
  }
}

async fn kill_process_tree(pid: u32) {
  if pid == 0 {
    return;
  }

  #[cfg(target_os = "windows")]
  {
    if let Ok(mut child) = Command::new("taskkill")
      .args(["/pid", &pid.to_string(), "/T", "/F"])
      .stdout(std::process::Stdio::null())
      .stderr(std::process::Stdio::null())
      .spawn()
    {
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

fn file_path_to_string(file_path: FilePath) -> Option<String> {
  file_path_to_path(file_path).map(|path| path.to_string_lossy().to_string())
}

fn file_path_to_path(file_path: FilePath) -> Option<PathBuf> {
  file_path.into_path().ok()
}

fn to_command_line(command: &str, args: &[String]) -> String {
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

fn create_launch_spec(service: &ServiceConfig, settings: &AppSettings) -> LaunchSpec {
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
      if !has_maven_flag(&service.args, "-s") && !settings.maven_settings_file.trim().is_empty() {
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
      args.push("-Dfile.encoding=UTF-8".to_string());
      args.extend(service.jvm_args.clone());
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
  }
}

fn has_maven_flag(args: &[String], flag: &str) -> bool {
  args
    .iter()
    .any(|arg| arg == flag || arg.starts_with(&format!("{flag}=")))
}

fn has_maven_repo_override(args: &[String]) -> bool {
  args
    .iter()
    .any(|arg| arg.starts_with("-Dmaven.repo.local=") || arg == "-Dmaven.repo.local")
}

fn append_env_arg(env: &mut HashMap<String, String>, key: &str, value: &str) {
  let value = value.trim();
  if value.is_empty() {
    return;
  }
  env
    .entry(key.to_string())
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

fn should_merge_log_line(previous: &LogEntry, entry: &LogEntry) -> bool {
  if previous.service_id != entry.service_id || matches!(previous.source, LogSource::System) {
    return false;
  }
  if log_level(&previous.text, &previous.source) != "ERROR"
    && !matches!(previous.source, LogSource::Stderr)
  {
    return false;
  }

  let text = entry.text.trim_start();
  is_exception_start(text)
    || text.starts_with("at ")
    || text.starts_with("... ")
    || text.starts_with("Caused by:")
    || text.starts_with("Suppressed:")
}

fn strip_ansi_sequences(text: &str) -> String {
  let mut cleaned = String::with_capacity(text.len());
  let mut chars = text.chars().peekable();

  while let Some(ch) = chars.next() {
    if ch != '\u{1b}' {
      cleaned.push(ch);
      continue;
    }

    match chars.peek().copied() {
      Some('[') => {
        chars.next();
        for next in chars.by_ref() {
          if ('@'..='~').contains(&next) {
            break;
          }
        }
      }
      Some(']') => {
        chars.next();
        while let Some(next) = chars.next() {
          if next == '\u{7}' {
            break;
          }
          if next == '\u{1b}' && matches!(chars.peek(), Some('\\')) {
            chars.next();
            break;
          }
        }
      }
      Some('@'..='Z') | Some('\\') | Some(']'..='_') => {
        chars.next();
      }
      _ => {}
    }
  }

  cleaned.trim_end().to_string()
}

fn log_level(text: &str, source: &LogSource) -> &'static str {
  if matches!(source, LogSource::Stderr) {
    return "ERROR";
  }
  if matches!(source, LogSource::System) {
    return "SYSTEM";
  }
  for level in ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"] {
    if text
      .split(|ch: char| !ch.is_ascii_alphabetic())
      .any(|part| part == level)
    {
      return level;
    }
  }
  "INFO"
}

fn is_exception_start(text: &str) -> bool {
  let Some(first) = text.split_whitespace().next() else {
    return false;
  };
  let class_name = first.trim_end_matches(':');
  class_name.ends_with("Exception") || class_name.ends_with("Error")
}

fn extract_xml_option_value(content: &str, option_name: &str) -> Option<String> {
  let marker = format!(r#"name="{option_name}""#);
  let index = content.find(&marker)?;
  let remainder = &content[index..];
  let value_marker = r#"value=""#;
  let value_index = remainder.find(value_marker)?;
  let value_start = value_index + value_marker.len();
  let value_end = remainder[value_start..].find('"')?;
  let value = &remainder[value_start..value_start + value_end];
  Some(decode_xml_value(value))
}

fn extract_xml_attribute(content: &str, attribute_name: &str) -> Option<String> {
  let marker = format!(r#"{attribute_name}=""#);
  let index = content.find(&marker)?;
  let remainder = &content[index + marker.len()..];
  let value_end = remainder.find('"')?;
  Some(decode_xml_value(&remainder[..value_end]))
}

fn decode_xml_value(value: &str) -> String {
  value
    .replace("&quot;", "\"")
    .replace("&amp;", "&")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&apos;", "'")
}

fn extract_component_block(content: &str, component_name: &str) -> Option<String> {
  let marker = format!(r#"<component name="{component_name}""#);
  let start = content.find(&marker)?;
  let remainder = &content[start..];
  let end = remainder.find("</component>")?;
  Some(remainder[..end + "</component>".len()].to_string())
}

fn extract_idea_spring_run_configs(content: &str) -> Vec<IdeaSpringRunConfig> {
  let Some(run_manager) = extract_component_block(content, "RunManager") else {
    return Vec::new();
  };

  let mut configs = Vec::new();
  let mut offset = 0;
  while let Some(relative_start) = run_manager[offset..].find("<configuration ") {
    let start = offset + relative_start;
    let remainder = &run_manager[start..];
    let Some(header_end) = remainder.find('>') else {
      break;
    };
    let header = &remainder[..header_end + 1];
    let Some(block_end) = remainder.find("</configuration>") else {
      break;
    };
    let block = &remainder[..block_end + "</configuration>".len()];
    offset = start + block_end + "</configuration>".len();

    if extract_xml_attribute(header, "type").as_deref()
      != Some("SpringBootApplicationConfigurationType")
    {
      continue;
    }
    if extract_xml_attribute(header, "default").as_deref() == Some("true") {
      continue;
    }

    let Some(name) = extract_xml_attribute(header, "name") else {
      continue;
    };
    let Some(main_class) = extract_xml_option_value(block, "SPRING_BOOT_MAIN_CLASS") else {
      continue;
    };

    configs.push(IdeaSpringRunConfig {
      name,
      module_name: extract_module_name(block),
      main_class,
      working_directory: extract_named_option_value(block, &["WORKING_DIRECTORY"]),
      jvm_args: extract_named_option_value(block, &["VM_PARAMETERS"])
        .map(|value| split_command_line_args(&value))
        .unwrap_or_default(),
      program_args: extract_named_option_value(block, &["PROGRAM_PARAMETERS"])
        .map(|value| split_command_line_args(&value))
        .unwrap_or_default(),
      env: extract_env_map(block),
    });
  }

  configs
}

fn select_idea_run_config(
  configs: &[IdeaSpringRunConfig],
  workspace_content: &str,
  selected_path: &Path,
  project_root: &Path,
) -> Option<IdeaSpringRunConfig> {
  let selected_name = extract_component_selection(workspace_content);

  configs.iter().cloned().max_by_key(|config| {
    score_idea_run_config(
      config,
      selected_name.as_deref(),
      selected_path,
      project_root,
    )
  })
}

fn extract_component_selection(content: &str) -> Option<String> {
  let run_manager = extract_component_block(content, "RunManager")?;
  extract_xml_attribute(&run_manager, "selected")
}

fn score_idea_run_config(
  config: &IdeaSpringRunConfig,
  selected_name: Option<&str>,
  selected_path: &Path,
  project_root: &Path,
) -> u16 {
  let mut score = 0;

  if let Some(selected) = selected_name {
    let expected = format!("Spring Boot.{}", config.name);
    if selected == config.name || selected == expected {
      score += 100;
    }
  }

  if let Some(module_dir) =
    resolve_idea_working_dir_lightweight(project_root, selected_path, config)
  {
    if selected_path == module_dir {
      score += 300;
    } else if selected_path.starts_with(&module_dir) || module_dir.starts_with(selected_path) {
      score += 150;
    }
  }

  if let Some(module_name) = &config.module_name {
    let selected_text = selected_path.to_string_lossy();
    if selected_text.ends_with(module_name) {
      score += 80;
    }
  }

  score
}

fn resolve_idea_working_dir_lightweight(
  project_root: &Path,
  selected_path: &Path,
  config: &IdeaSpringRunConfig,
) -> Option<PathBuf> {
  if let Some(explicit) = config
    .working_directory
    .as_ref()
    .map(|value| PathBuf::from(expand_idea_path(value, Some(project_root))))
    .filter(|path| path.exists())
  {
    return Some(explicit);
  }

  if selected_path.join("pom.xml").exists() {
    return Some(selected_path.to_path_buf());
  }

  config
    .module_name
    .as_ref()
    .map(|module_name| project_root.join(module_name))
    .filter(|path| path.join("pom.xml").exists())
    .or_else(|| {
      project_root
        .join("pom.xml")
        .exists()
        .then(|| project_root.to_path_buf())
    })
}

fn extract_module_name(content: &str) -> Option<String> {
  let marker = "<module ";
  let index = content.find(marker)?;
  let remainder = &content[index..];
  let end = remainder.find('>')?;
  extract_xml_attribute(&remainder[..end + 1], "name")
}

fn extract_named_option_value(content: &str, names: &[&str]) -> Option<String> {
  names
    .iter()
    .find_map(|name| extract_xml_option_value(content, name))
}

fn extract_env_map(content: &str) -> HashMap<String, String> {
  let Some(start) = content.find("<envs>") else {
    return HashMap::new();
  };
  let remainder = &content[start..];
  let Some(end) = remainder.find("</envs>") else {
    return HashMap::new();
  };
  let envs_block = &remainder[..end];
  let mut env = HashMap::new();
  let mut offset = 0;

  while let Some(relative_start) = envs_block[offset..].find("<env ") {
    let start_index = offset + relative_start;
    let fragment = &envs_block[start_index..];
    let Some(end_index) = fragment.find("/>") else {
      break;
    };
    let item = &fragment[..end_index + 2];
    offset = start_index + end_index + 2;

    let Some(name) = extract_xml_attribute(item, "name") else {
      continue;
    };
    let value = extract_xml_attribute(item, "value").unwrap_or_default();
    env.insert(name, value);
  }

  env
}

fn split_command_line_args(input: &str) -> Vec<String> {
  let mut args = Vec::new();
  let mut current = String::new();
  let mut quote: Option<char> = None;

  for ch in input.chars() {
    match quote {
      Some(active) if ch == active => quote = None,
      Some(_) => current.push(ch),
      None if ch == '"' || ch == '\'' => quote = Some(ch),
      None if ch.is_whitespace() => {
        if !current.is_empty() {
          args.push(current.clone());
          current.clear();
        }
      }
      None => current.push(ch),
    }
  }

  if !current.is_empty() {
    args.push(current);
  }

  args
}

fn extract_project_jdk_name(content: &str) -> Option<String> {
  let marker = r#"<component name="ProjectRootManager""#;
  let start = content.find(marker)?;
  let remainder = &content[start..];
  let end = remainder.find('>')?;
  extract_xml_attribute(&remainder[..end + 1], "project-jdk-name")
}

fn resolve_idea_jdk_home(jdk_name: &str) -> Option<String> {
  let app_data = std::env::var("APPDATA").ok()?;
  let jetbrains_dir = PathBuf::from(app_data).join("JetBrains");
  let entries = std::fs::read_dir(jetbrains_dir).ok()?;

  for entry in entries.flatten() {
    let candidate = entry.path().join("options").join("jdk.table.xml");
    if !candidate.exists() {
      continue;
    }

    let Ok(content) = std::fs::read_to_string(&candidate) else {
      continue;
    };
    if let Some(home_path) = extract_jdk_home_from_table(&content, jdk_name) {
      return Some(home_path);
    }
  }

  None
}

fn infer_project_java_home(start: &Path) -> Option<String> {
  let workspace_file = find_idea_workspace(start)?;
  let project_root = workspace_file.parent()?.parent()?;
  let misc_file = project_root.join(".idea").join("misc.xml");
  let misc_content = std::fs::read_to_string(misc_file).ok()?;
  let jdk_name = extract_project_jdk_name(&misc_content);
  jdk_name
    .as_deref()
    .and_then(resolve_idea_jdk_home)
    .or_else(|| fallback_java_home(jdk_name.as_deref()))
}

fn has_env_key(env: &HashMap<String, String>, target: &str) -> bool {
  env.keys().any(|key| key.eq_ignore_ascii_case(target))
}

fn should_detect_port_from_line(text: &str) -> bool {
  let cleaned = strip_ansi_sequences(text);
  let lower = cleaned.trim().to_ascii_lowercase();
  [
    "tomcat started on port",
    "netty started on port",
    "started on port",
    "listening on 0.0.0.0 port",
    "listening on port",
    "local: http://",
    "local: https://",
  ]
  .iter()
  .any(|marker| lower.contains(marker))
}

fn extract_jdk_home_from_table(content: &str, jdk_name: &str) -> Option<String> {
  let mut offset = 0;
  while let Some(relative_start) = content[offset..].find("<jdk ") {
    let start = offset + relative_start;
    let remainder = &content[start..];
    let end = remainder.find("</jdk>")?;
    let block = &remainder[..end + "</jdk>".len()];
    offset = start + end + "</jdk>".len();

    let Some(name_index) = block.find(r#"<name value=""#) else {
      continue;
    };
    let name_fragment = &block[name_index..];
    let Some(name_value_end) = name_fragment[r#"<name value=""#.len()..].find('"') else {
      continue;
    };
    let configured_name = decode_xml_value(
      &name_fragment[r#"<name value=""#.len()..r#"<name value=""#.len() + name_value_end],
    );
    if configured_name != jdk_name {
      continue;
    }

    let home_index = block.find(r#"<homePath value=""#)?;
    let home_fragment = &block[home_index..];
    let home_value_start = r#"<homePath value=""#.len();
    let home_value_end = home_fragment[home_value_start..].find('"')?;
    let home_value = &home_fragment[home_value_start..home_value_start + home_value_end];
    return Some(expand_idea_path(home_value, None));
  }

  None
}

fn fallback_java_home(jdk_name: Option<&str>) -> Option<String> {
  let prefers_java8 = jdk_name
    .map(|value| value.contains("1.8") || value.contains("8"))
    .unwrap_or(false);

  if prefers_java8 {
    std::env::var("JAVA_HOME8")
      .ok()
      .filter(|value| !value.trim().is_empty())
      .or_else(|| {
        std::env::var("JAVA_HOME")
          .ok()
          .filter(|value| !value.trim().is_empty())
      })
  } else {
    std::env::var("JAVA_HOME")
      .ok()
      .filter(|value| !value.trim().is_empty())
  }
}

fn extract_idea_maven_settings(content: &str, project_root: &Path) -> AppSettings {
  AppSettings {
    language: AppLanguage::ZhCn,
    maven_settings_file: extract_xml_option_value(content, "userSettingsFile")
      .map(|value| expand_idea_path(&value, Some(project_root)))
      .unwrap_or_default(),
    maven_local_repository: extract_xml_option_value(content, "localRepository")
      .map(|value| expand_idea_path(&value, Some(project_root)))
      .unwrap_or_default(),
    clear_logs_on_restart: true,
  }
}

fn expand_idea_path(value: &str, project_root: Option<&Path>) -> String {
  let mut expanded = value.to_string();
  if let Some(user_home) = std::env::var("USERPROFILE")
    .ok()
    .or_else(|| std::env::var("HOME").ok())
  {
    expanded = expanded.replace("$USER_HOME$", &user_home);
  }
  if let Some(root) = project_root {
    expanded = expanded.replace("$PROJECT_DIR$", &root.to_string_lossy());
  }
  expanded.replace('/', "\\")
}

fn resolve_idea_working_dir(
  project_root: &Path,
  selected_path: &Path,
  config: &IdeaSpringRunConfig,
) -> Option<String> {
  if let Some(explicit) = config
    .working_directory
    .as_ref()
    .map(|value| PathBuf::from(expand_idea_path(value, Some(project_root))))
    .filter(|path| path.exists())
  {
    return Some(explicit.to_string_lossy().to_string());
  }

  if let Some(found) = find_module_dir_by_main_class(project_root, &config.main_class) {
    return Some(found.to_string_lossy().to_string());
  }

  if selected_path.join("pom.xml").exists() {
    return Some(selected_path.to_string_lossy().to_string());
  }

  config
    .module_name
    .as_ref()
    .map(|module_name| project_root.join(module_name))
    .filter(|path| path.join("pom.xml").exists())
    .map(|path| path.to_string_lossy().to_string())
    .or_else(|| {
      project_root
        .join("pom.xml")
        .exists()
        .then(|| project_root.to_string_lossy().to_string())
    })
}

fn find_module_dir_by_main_class(project_root: &Path, main_class: &str) -> Option<PathBuf> {
  let mut relative_source = PathBuf::from("src");
  relative_source.push("main");
  relative_source.push("java");
  for segment in main_class.split('.') {
    relative_source.push(segment);
  }
  relative_source.set_extension("java");

  find_source_file(project_root, &relative_source).and_then(find_ancestor_with_pom)
}

fn find_source_file(root: &Path, expected_suffix: &Path) -> Option<PathBuf> {
  let entries = std::fs::read_dir(root).ok()?;
  for entry in entries.flatten() {
    let path = entry.path();
    if path.is_dir() {
      if let Some(found) = find_source_file(&path, expected_suffix) {
        return Some(found);
      }
      continue;
    }
    if path.ends_with(expected_suffix) {
      return Some(path);
    }
  }
  None
}

fn find_ancestor_with_pom(path: PathBuf) -> Option<PathBuf> {
  for current in path.ancestors() {
    if current.join("pom.xml").exists() {
      return Some(current.to_path_buf());
    }
  }
  None
}

fn extract_profiles_from_args(args: &[String]) -> Vec<String> {
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

fn extract_port_from_args(args: &[String]) -> Option<u16> {
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

fn strip_managed_spring_args(args: &[String]) -> Vec<String> {
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

fn resolve_jar_command(env: &HashMap<String, String>) -> String {
  let executable = if cfg!(windows) { "jar.exe" } else { "jar" };
  env
    .get("JAVA_HOME")
    .map(|java_home| Path::new(java_home).join("bin").join(executable))
    .filter(|path| path.exists())
    .map(|path| path.to_string_lossy().to_string())
    .unwrap_or_else(|| executable.to_string())
}

fn path_to_file_url(path: &Path, is_dir: bool) -> String {
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

fn build_manifest_content(classpath_entries: &[String]) -> String {
  let mut manifest = String::from("Manifest-Version: 1.0\r\n");
  let classpath_value = classpath_entries.join(" ");
  append_manifest_header(&mut manifest, "Class-Path", &classpath_value);
  manifest.push_str("Created-By: ServicePilot\r\n\r\n");
  manifest
}

fn append_manifest_header(output: &mut String, name: &str, value: &str) {
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

fn find_idea_workspace(start: &Path) -> Option<PathBuf> {
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

fn default_java_classpath(working_dir: &str) -> String {
  let separator = classpath_separator();
  [
    format!("{working_dir}\\target\\classes"),
    format!("{working_dir}\\target\\test-classes"),
    format!("{working_dir}\\target\\dependency\\*"),
  ]
  .join(separator)
}

fn merge_managed_jvm_args(configured_args: &[String]) -> Vec<String> {
  let mut args = vec!["-Dfile.encoding=UTF-8".to_string()];
  args.extend(
    configured_args
      .iter()
      .filter(|arg| !is_file_encoding_arg(arg))
      .cloned(),
  );
  args
}

fn is_file_encoding_arg(arg: &str) -> bool {
  arg
    .trim()
    .to_ascii_lowercase()
    .starts_with("-dfile.encoding=")
}

fn contains_servicepilot_classpath_cache(classpath: &str) -> bool {
  split_classpath_entries(classpath).into_iter().any(|entry| {
    Path::new(entry)
      .file_name()
      .and_then(|name| name.to_str())
      .map_or(false, |name| {
        name.eq_ignore_ascii_case("servicepilot-classpath.jar")
      })
  })
}

async fn find_local_maven_module_classes(working_dir: &str) -> BackendResult<Vec<String>> {
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

fn extract_maven_artifact_ids(pom: &str) -> HashSet<String> {
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

fn extract_first_maven_artifact_id(pom: &str) -> Option<String> {
  let start = pom.find("<artifactId>")? + "<artifactId>".len();
  let end = pom[start..].find("</artifactId>")? + start;
  let artifact_id = pom[start..end].trim();
  (!artifact_id.is_empty()).then(|| artifact_id.to_string())
}

fn split_classpath_entries(classpath: &str) -> Vec<&str> {
  classpath
    .split(classpath_separator())
    .map(str::trim)
    .filter(|entry| !entry.is_empty())
    .collect()
}

fn normalize_dependency_dir(entry: &str) -> PathBuf {
  let trimmed = entry
    .trim()
    .trim_end_matches('*')
    .trim_end_matches('\\')
    .trim_end_matches('/');
  PathBuf::from(trimmed)
}

#[cfg(windows)]
fn classpath_separator() -> &'static str {
  ";"
}

#[cfg(not(windows))]
fn classpath_separator() -> &'static str {
  ":"
}

fn prepare_spawn_command(launch: &LaunchSpec) -> (String, Vec<String>) {
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
fn should_use_cmd_shell(command: &str) -> bool {
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

fn validate_safe_launch_policy(service: &ServiceConfig) -> BackendResult<()> {
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
          return Err("Frontend preset launch may only run local development scripts.".to_string());
        }
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
      "Launch commands may not perform remote deployment or file transfer operations.".to_string(),
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

fn is_disallowed_frontend_script_name(script_name: &str) -> bool {
  matches!(
    script_name.trim().to_ascii_lowercase().as_str(),
    "install" | "postinstall" | "preinstall" | "publish" | "deploy" | "release" | "build"
  )
}

fn executable_stem(command: &str) -> String {
  let trimmed = command.trim().trim_matches('"');
  if trimmed.is_empty() {
    return String::new();
  }

  Path::new(trimmed)
    .file_stem()
    .and_then(|value| value.to_str())
    .unwrap_or(trimmed)
    .to_ascii_lowercase()
}

fn is_java_command(command: &str) -> bool {
  executable_stem(command) == "java"
}

fn is_maven_command(command: &str) -> bool {
  matches!(executable_stem(command).as_str(), "mvn" | "mvnw")
}

fn is_gradle_command(command: &str) -> bool {
  matches!(executable_stem(command).as_str(), "gradle" | "gradlew")
}

fn is_node_package_manager_command(command: &str) -> bool {
  matches!(
    executable_stem(command).as_str(),
    "npm" | "pnpm" | "yarn" | "bun"
  )
}

fn is_node_dev_command(command: &str) -> bool {
  matches!(executable_stem(command).as_str(), "node" | "npx" | "vite")
}

fn detect_frontend_package_manager(project_root: &Path) -> String {
  if project_root.join("pnpm-lock.yaml").exists() {
    return "pnpm".to_string();
  }
  if project_root.join("yarn.lock").exists() {
    return "yarn".to_string();
  }
  if project_root.join("bun.lock").exists() || project_root.join("bun.lockb").exists() {
    return "bun".to_string();
  }
  "npm".to_string()
}

fn build_frontend_dev_args(service: &ServiceConfig) -> Vec<String> {
  let script = service.frontend_script.as_deref().unwrap_or("dev");
  let mut script_args = normalize_frontend_script_args(&service.args);
  if let Some(port) = service.port {
    if !has_frontend_port_arg(&script_args) {
      script_args.push("--port".to_string());
      script_args.push(port.to_string());
    }
  }

  let mut args = vec!["run".to_string(), script.to_string()];
  if !script_args.is_empty() {
    args.push("--".to_string());
    args.extend(script_args);
  }
  args
}

fn select_frontend_script(package: &PackageJson) -> Option<String> {
  ["dev", "start", "serve", "storybook"]
    .iter()
    .find_map(|script_name| {
      package
        .scripts
        .get(*script_name)
        .filter(|script_value| is_allowed_frontend_script(script_name, script_value))
        .map(|_| (*script_name).to_string())
    })
    .or_else(|| {
      package
        .scripts
        .iter()
        .find_map(|(script_name, script_value)| {
          if is_allowed_frontend_script(script_name, script_value) {
            Some(script_name.clone())
          } else {
            None
          }
        })
    })
}

fn is_allowed_frontend_script(script_name: &str, script_value: &serde_json::Value) -> bool {
  let name = script_name.trim().to_ascii_lowercase();
  if is_disallowed_frontend_script_name(&name) {
    return false;
  }

  let Some(command) = script_value.as_str() else {
    return false;
  };
  let command = command.trim().to_ascii_lowercase();
  if command.is_empty() || contains_disallowed_frontend_script_action(&command) {
    return false;
  }

  matches!(name.as_str(), "dev" | "serve" | "storybook") || is_known_frontend_dev_script(&command)
}

fn is_known_frontend_dev_script(command: &str) -> bool {
  [
    "vite",
    "next dev",
    "nuxt dev",
    "nuxi dev",
    "ng serve",
    "astro dev",
    "svelte-kit dev",
    "react-scripts start",
    "remix dev",
    "storybook",
    "vitepress dev",
    "vuepress dev",
  ]
  .iter()
  .any(|token| command.contains(token))
}

fn contains_disallowed_frontend_script_action(command: &str) -> bool {
  [
    "git ",
    "git\t",
    "git.exe",
    "npm install",
    "npm publish",
    "npm version",
    "pnpm add",
    "pnpm install",
    "yarn add",
    "yarn install",
    "yarn publish",
    "bun install",
    "kubectl",
    "helm",
    "ssh ",
    "scp ",
    "sftp ",
    "rsync",
    "docker push",
    "docker login",
    "mvn deploy",
    "mvn install",
    "gradle publish",
    "gradlew publish",
  ]
  .iter()
  .any(|token| command.contains(token))
}

fn normalize_frontend_script_args(args: &[String]) -> Vec<String> {
  args
    .iter()
    .filter(|arg| arg.trim() != "--")
    .cloned()
    .collect()
}

fn has_frontend_port_arg(args: &[String]) -> bool {
  args.iter().any(|arg| {
    let normalized = arg.trim().to_ascii_lowercase();
    normalized == "--port" || normalized.starts_with("--port=") || normalized == "-p"
  })
}

fn is_allowed_custom_launch_command(service: &ServiceConfig) -> bool {
  match service.service_kind {
    ServiceKind::Spring => {
      is_java_command(&service.command)
        || is_maven_command(&service.command)
        || is_gradle_command(&service.command)
    }
    ServiceKind::Vue => {
      is_node_package_manager_command(&service.command) || is_node_dev_command(&service.command)
    }
  }
}

fn is_disallowed_maven_goal(arg: &str) -> bool {
  matches!(
    arg.trim().to_ascii_lowercase().as_str(),
    "install"
      | "deploy"
      | "deploy:deploy-file"
      | "release:prepare"
      | "release:perform"
      | "site-deploy"
      | "gpg:sign-and-deploy-file"
  )
}

fn is_disallowed_gradle_task(arg: &str) -> bool {
  matches!(
    arg.trim().to_ascii_lowercase().as_str(),
    "publish" | "publishtomavenlocal" | "uploadarchives" | "artifactorypublish" | "release"
  )
}

fn is_disallowed_node_package_manager_action(arg: &str) -> bool {
  matches!(
    arg.trim().to_ascii_lowercase().as_str(),
    "install"
      | "i"
      | "add"
      | "remove"
      | "rm"
      | "update"
      | "upgrade"
      | "publish"
      | "version"
      | "login"
      | "logout"
      | "link"
      | "unlink"
  )
}

fn now_iso_string() -> String {
  Utc::now().to_rfc3339()
}

fn decode_process_line(bytes: &[u8]) -> String {
  let bytes = trim_line_end(bytes);
  decode_process_output(bytes)
}

fn decode_process_output(bytes: &[u8]) -> String {
  if let Ok(text) = std::str::from_utf8(bytes) {
    return text.to_string();
  }
  decode_platform_ansi(bytes).unwrap_or_else(|| String::from_utf8_lossy(bytes).to_string())
}

fn classpath_preparation_failed_message() -> String {
  "Failed to prepare Java classpath. See service logs for details.".to_string()
}

fn trim_line_end(mut bytes: &[u8]) -> &[u8] {
  if bytes.ends_with(b"\n") {
    bytes = &bytes[..bytes.len() - 1];
  }
  if bytes.ends_with(b"\r") {
    bytes = &bytes[..bytes.len() - 1];
  }
  bytes
}

#[cfg(windows)]
fn decode_platform_ansi(bytes: &[u8]) -> Option<String> {
  use windows_sys::Win32::Globalization::{MultiByteToWideChar, CP_ACP};

  if bytes.is_empty() {
    return Some(String::new());
  }

  let input_len = i32::try_from(bytes.len()).ok()?;
  let required = unsafe {
    MultiByteToWideChar(
      CP_ACP,
      0,
      bytes.as_ptr(),
      input_len,
      std::ptr::null_mut(),
      0,
    )
  };
  if required <= 0 {
    return None;
  }

  let mut wide = vec![0u16; required as usize];
  let written = unsafe {
    MultiByteToWideChar(
      CP_ACP,
      0,
      bytes.as_ptr(),
      input_len,
      wide.as_mut_ptr(),
      required,
    )
  };
  if written <= 0 {
    return None;
  }

  Some(String::from_utf16_lossy(&wide[..written as usize]))
}

#[cfg(not(windows))]
fn decode_platform_ansi(_bytes: &[u8]) -> Option<String> {
  None
}

fn compute_elapsed_seconds(started_at: &str) -> Option<u64> {
  let started = chrono::DateTime::parse_from_rfc3339(started_at).ok()?;
  let elapsed = Utc::now().signed_duration_since(started.with_timezone(&Utc));
  Some(elapsed.num_seconds().max(0) as u64)
}

fn new_id() -> String {
  uuid::Uuid::new_v4().to_string()
}

fn default_settings() -> AppSettings {
  AppSettings {
    language: AppLanguage::ZhCn,
    maven_settings_file: String::new(),
    maven_local_repository: String::new(),
    clear_logs_on_restart: true,
  }
}

fn default_true() -> bool {
  true
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn service(
    launch_type: LaunchType,
    service_kind: ServiceKind,
    command: &str,
    args: &[&str],
  ) -> ServiceConfig {
    ServiceConfig {
      id: "service-1".to_string(),
      name: "service".to_string(),
      service_kind,
      launch_type,
      working_dir: "D:\\workspace\\service".to_string(),
      command: command.to_string(),
      args: args.iter().map(|arg| (*arg).to_string()).collect(),
      env: HashMap::new(),
      profiles: Vec::new(),
      port: None,
      url: None,
      frontend_script: None,
      maven_force_update: false,
      maven_debug_mode: false,
      maven_disable_fork: false,
      main_class: None,
      classpath: None,
      jvm_args: Vec::new(),
    }
  }

  fn package_with_scripts(scripts: &[(&str, serde_json::Value)]) -> PackageJson {
    PackageJson {
      name: Some("fixture".to_string()),
      scripts: scripts
        .iter()
        .map(|(name, value)| ((*name).to_string(), value.clone()))
        .collect(),
    }
  }

  #[test]
  fn safe_launch_policy_allows_local_development_commands() {
    let maven = service(
      LaunchType::Maven,
      ServiceKind::Spring,
      "mvn",
      &["spring-boot:run"],
    );
    assert!(validate_safe_launch_policy(&maven).is_ok());

    let java = service(
      LaunchType::JavaMain,
      ServiceKind::Spring,
      "java",
      &["-cp", "target/classes", "com.example.Application"],
    );
    assert!(validate_safe_launch_policy(&java).is_ok());

    let mut npm = service(
      LaunchType::VuePreset,
      ServiceKind::Vue,
      "npm",
      &["run", "dev"],
    );
    npm.frontend_script = Some("dev".to_string());
    assert!(validate_safe_launch_policy(&npm).is_ok());

    let mut pnpm = service(
      LaunchType::VuePreset,
      ServiceKind::Vue,
      "pnpm",
      &["run", "dev"],
    );
    pnpm.frontend_script = Some("dev".to_string());
    assert!(validate_safe_launch_policy(&pnpm).is_ok());
  }

  #[test]
  fn safe_launch_policy_blocks_dangerous_commands() {
    let cases = [
      service(LaunchType::Custom, ServiceKind::Spring, "git", &["push"]),
      service(LaunchType::Maven, ServiceKind::Spring, "mvn", &["install"]),
      service(LaunchType::Maven, ServiceKind::Spring, "mvn", &["deploy"]),
      service(
        LaunchType::Custom,
        ServiceKind::Spring,
        "gradle",
        &["publish"],
      ),
      service(LaunchType::VuePreset, ServiceKind::Vue, "npm", &["install"]),
      service(LaunchType::VuePreset, ServiceKind::Vue, "npm", &["publish"]),
      service(LaunchType::Custom, ServiceKind::Vue, "kubectl", &["apply"]),
      service(LaunchType::Custom, ServiceKind::Vue, "ssh", &["host"]),
      service(
        LaunchType::Custom,
        ServiceKind::Vue,
        "docker",
        &["push", "repo/image"],
      ),
      service(LaunchType::Custom, ServiceKind::Vue, "docker", &["login"]),
    ];

    for case in cases {
      assert!(
        validate_safe_launch_policy(&case).is_err(),
        "expected command to be blocked: {} {:?}",
        case.command,
        case.args
      );
    }
  }

  #[test]
  fn maven_launch_spec_includes_managed_local_startup_args() {
    let mut maven = service(LaunchType::Maven, ServiceKind::Spring, "", &["-DskipTests"]);
    maven.maven_force_update = true;
    maven.profiles = vec!["dev".to_string(), "local".to_string()];
    maven.port = Some(8080);

    let settings = AppSettings {
      language: AppLanguage::ZhCn,
      maven_settings_file: "D:\\environment\\settings.xml".to_string(),
      maven_local_repository: "D:\\environment\\repository".to_string(),
      clear_logs_on_restart: true,
    };
    let launch = create_launch_spec(&maven, &settings);

    assert_eq!(launch.command, "mvn");
    assert!(launch.args.contains(&"-s".to_string()));
    assert!(launch
      .args
      .contains(&"D:\\environment\\settings.xml".to_string()));
    assert!(launch
      .args
      .contains(&"-Dmaven.repo.local=D:\\environment\\repository".to_string()));
    assert!(launch.args.contains(&"-U".to_string()));
    assert!(launch.args.contains(&"spring-boot:run".to_string()));
    assert!(launch
      .args
      .contains(&"-Dspring-boot.run.profiles=dev,local".to_string()));
    assert!(launch
      .args
      .contains(&"-Dspring-boot.run.arguments=--server.port=8080".to_string()));
    assert!(launch
      .args
      .contains(&"-Dspring-boot.run.fork=false".to_string()));
    assert_eq!(
      launch.env.get("MAVEN_OPTS"),
      Some(&"-Dfile.encoding=UTF-8".to_string())
    );
  }

  #[test]
  fn java_main_launch_spec_includes_classpath_main_class_profiles_and_port() {
    let mut java = service(LaunchType::JavaMain, ServiceKind::Spring, "", &["--debug"]);
    java.main_class = Some("com.example.Application".to_string());
    java.classpath = Some("target/classes;target/dependency/*".to_string());
    java.jvm_args = vec!["-Xmx512m".to_string()];
    java.profiles = vec!["dev".to_string()];
    java.port = Some(9090);

    let launch = create_launch_spec(&java, &default_settings());

    assert_eq!(launch.command, "java");
    assert_eq!(
      launch.args,
      vec![
        "-Dfile.encoding=UTF-8",
        "-Xmx512m",
        "-cp",
        "target/classes;target/dependency/*",
        "com.example.Application",
        "--spring.profiles.active=dev",
        "--server.port=9090",
        "--debug"
      ]
    );
  }

  #[test]
  fn vue_preset_launch_spec_adds_script_args_and_port_env() {
    let mut vue = service(
      LaunchType::VuePreset,
      ServiceKind::Vue,
      "pnpm",
      &["--", "--host", "127.0.0.1"],
    );
    vue.frontend_script = Some("dev".to_string());
    vue.port = Some(5173);

    let launch = create_launch_spec(&vue, &default_settings());

    assert_eq!(launch.command, "pnpm");
    assert_eq!(
      launch.args,
      vec!["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"]
    );
    assert_eq!(launch.env.get("PORT"), Some(&"5173".to_string()));
    assert!(launch.command_line.contains("pnpm run dev"));
  }

  #[test]
  fn frontend_script_selection_prefers_safe_development_scripts() {
    let package = package_with_scripts(&[
      ("build", json!("vite build")),
      ("dev", json!("vite --host 127.0.0.1")),
      ("serve", json!("vite preview")),
    ]);
    assert_eq!(select_frontend_script(&package), Some("dev".to_string()));

    let package = package_with_scripts(&[
      ("start", json!("next dev")),
      ("storybook", json!("storybook dev -p 6006")),
    ]);
    assert_eq!(select_frontend_script(&package), Some("start".to_string()));
  }

  #[test]
  fn frontend_script_selection_rejects_mutating_or_publish_scripts() {
    let package = package_with_scripts(&[
      ("install", json!("npm install")),
      ("build", json!("vite build")),
      ("deploy", json!("kubectl apply -f deployment.yaml")),
      ("publish", json!("npm publish")),
    ]);
    assert_eq!(select_frontend_script(&package), None);
  }

  #[test]
  fn frontend_package_manager_detection_uses_lockfiles() {
    let root = std::env::temp_dir().join(format!("service-pilot-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("create temp project");
    assert_eq!(detect_frontend_package_manager(&root), "npm");

    std::fs::write(root.join("pnpm-lock.yaml"), "").expect("write pnpm lock");
    assert_eq!(detect_frontend_package_manager(&root), "pnpm");
  }

  #[test]
  fn log_parsing_extracts_local_urls_and_ports() {
    assert_eq!(
      extract_url("  Local:   http://localhost:5173/  "),
      Some("http://localhost:5173".to_string())
    );
    assert_eq!(
      extract_url(
        "Tomcat started on port(s): 8080 (http) with context path '' http://127.0.0.1:8080/api"
      ),
      Some("http://127.0.0.1:8080/api".to_string())
    );
    assert_eq!(
      extract_port("Tomcat started on port(s): 8080 (http)"),
      Some(8080)
    );
    assert_eq!(extract_port("Local: http://localhost:5173/"), Some(5173));
  }

  #[test]
  fn log_parsing_ignores_unrelated_urls_and_ports() {
    assert_eq!(
      extract_url("remote api available at https://example.com/service"),
      None
    );
    assert_eq!(extract_port("management.server.port=9001"), None);
  }
}
