use super::*;

pub(crate) type BackendResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateInfo {
    pub(crate) version: String,
    pub(crate) current_version: String,
    pub(crate) notes: Option<String>,
    pub(crate) date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AppUpdatePhase {
    Downloading,
    Installing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateProgress {
    pub(crate) phase: AppUpdatePhase,
    pub(crate) downloaded: u64,
    pub(crate) total: Option<u64>,
}

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) backend: Arc<ServicePilotBackend>,
}

pub(crate) struct UpdateState {
    pub(crate) pending: StdMutex<Option<Update>>,
}

#[derive(Clone)]
pub(crate) struct ServicePilotBackend {
    pub(crate) app: AppHandle<Wry>,
    pub(crate) state_file: PathBuf,
    pub(crate) inner: Arc<Mutex<BackendState>>,
    pub(crate) last_snapshot_emitted: Arc<Mutex<std::time::Instant>>,
}

pub(crate) struct BackendState {
    pub(crate) services: Vec<ServiceConfig>,
    pub(crate) groups: Vec<ServiceGroup>,
    pub(crate) settings: AppSettings,
    pub(crate) runtime: HashMap<String, RuntimeState>,
    pub(crate) log_history: HashMap<String, Vec<LogEntry>>,
    pub(crate) processes: HashMap<String, ManagedProcess>,
}

#[derive(Clone)]
pub(crate) struct ManagedProcess {
    pub(crate) pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ServiceKind {
    Spring,
    Vue,
    Rust,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) enum LaunchType {
    #[serde(rename = "custom")]
    Custom,
    #[serde(rename = "maven")]
    Maven,
    #[serde(rename = "java-main")]
    JavaMain,
    #[serde(rename = "vue-preset")]
    VuePreset,
    #[serde(rename = "cargo-run")]
    CargoRun,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) enum AppLanguage {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en-US")]
    EnUs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RuntimeStatus {
    Stopped,
    Starting,
    Running,
    Failed,
    Stopping,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LogSource {
    Stdout,
    Stderr,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum FailureCategory {
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
pub(crate) struct ServiceConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) service_kind: ServiceKind,
    #[serde(default)]
    pub(crate) framework: Option<String>,
    pub(crate) launch_type: LaunchType,
    pub(crate) working_dir: String,
    pub(crate) command: String,
    #[serde(default)]
    pub(crate) args: Vec<String>,
    #[serde(default)]
    pub(crate) env: HashMap<String, String>,
    #[serde(default)]
    pub(crate) profiles: Vec<String>,
    pub(crate) port: Option<u16>,
    pub(crate) url: Option<String>,
    pub(crate) frontend_script: Option<String>,
    #[serde(default)]
    pub(crate) maven_force_update: bool,
    #[serde(default)]
    pub(crate) maven_debug_mode: bool,
    #[serde(default)]
    pub(crate) maven_disable_fork: bool,
    pub(crate) main_class: Option<String>,
    pub(crate) classpath: Option<String>,
    #[serde(default)]
    pub(crate) jvm_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceGroup {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) service_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeState {
    pub(crate) service_id: String,
    pub(crate) status: RuntimeStatus,
    pub(crate) pid: Option<u32>,
    pub(crate) started_at: Option<String>,
    pub(crate) elapsed_seconds: Option<u64>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) message: Option<String>,
    pub(crate) detected_port: Option<u16>,
    pub(crate) detected_url: Option<String>,
    pub(crate) failure_summary: Option<String>,
    pub(crate) failure_category: Option<FailureCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogEntry {
    pub(crate) id: String,
    pub(crate) service_id: String,
    pub(crate) timestamp: String,
    pub(crate) source: LogSource,
    pub(crate) text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettings {
    pub(crate) language: AppLanguage,
    #[serde(default)]
    pub(crate) maven_settings_file: String,
    #[serde(default)]
    pub(crate) maven_local_repository: String,
    #[serde(default = "default_true")]
    pub(crate) clear_logs_on_restart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedState {
    pub(crate) version: u8,
    #[serde(default)]
    pub(crate) services: Vec<ServiceConfig>,
    #[serde(default)]
    pub(crate) groups: Vec<ServiceGroup>,
    #[serde(default = "default_settings")]
    pub(crate) settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSnapshot {
    pub(crate) services: Vec<ServiceConfig>,
    pub(crate) groups: Vec<ServiceGroup>,
    pub(crate) runtime: HashMap<String, RuntimeState>,
    pub(crate) settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectDetection {
    pub(crate) name: String,
    pub(crate) service_kind: ServiceKind,
    pub(crate) framework: Option<String>,
    pub(crate) launch_type: LaunchType,
    pub(crate) command: String,
    pub(crate) frontend_script: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveServiceInput {
    pub(crate) id: Option<String>,
    pub(crate) name: String,
    pub(crate) service_kind: ServiceKind,
    pub(crate) framework: Option<String>,
    pub(crate) launch_type: LaunchType,
    pub(crate) working_dir: String,
    #[serde(default)]
    pub(crate) command: String,
    #[serde(default)]
    pub(crate) args: Vec<String>,
    #[serde(default)]
    pub(crate) env: HashMap<String, String>,
    #[serde(default)]
    pub(crate) profiles: Vec<String>,
    pub(crate) port: Option<u16>,
    pub(crate) url: Option<String>,
    pub(crate) frontend_script: Option<String>,
    pub(crate) maven_force_update: Option<bool>,
    pub(crate) maven_debug_mode: Option<bool>,
    pub(crate) maven_disable_fork: Option<bool>,
    pub(crate) main_class: Option<String>,
    pub(crate) classpath: Option<String>,
    #[serde(default)]
    pub(crate) jvm_args: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PackageJson {
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) scripts: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub(crate) dependencies: HashMap<String, serde_json::Value>,
    #[serde(default, rename = "devDependencies")]
    pub(crate) dev_dependencies: HashMap<String, serde_json::Value>,
    #[serde(default, rename = "peerDependencies")]
    pub(crate) peer_dependencies: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CargoManifest {
    pub(crate) package: Option<CargoPackage>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CargoPackage {
    pub(crate) name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveGroupInput {
    pub(crate) id: Option<String>,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) service_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DialogFilter {
    pub(crate) name: String,
    pub(crate) extensions: Vec<String>,
}

#[derive(Clone)]
pub(crate) struct LaunchSpec {
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    pub(crate) env: HashMap<String, String>,
    pub(crate) command_line: String,
}

#[derive(Clone)]
pub(crate) struct FailureInsight {
    pub(crate) category: FailureCategory,
    pub(crate) summary: String,
    pub(crate) score: u8,
}

#[derive(Debug, Clone)]
pub(crate) struct IdeaSpringRunConfig {
    pub(crate) name: String,
    pub(crate) module_name: Option<String>,
    pub(crate) main_class: String,
    pub(crate) working_directory: Option<String>,
    pub(crate) jvm_args: Vec<String>,
    pub(crate) program_args: Vec<String>,
    pub(crate) env: HashMap<String, String>,
}

pub(crate) struct PreparedIdeaProject {
    pub(crate) service: ServiceConfig,
    pub(crate) imported_settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScannedService {
    pub(crate) name: String,
    pub(crate) working_dir: String,
    pub(crate) framework: Option<String>,
    pub(crate) port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanResult {
    pub(crate) services: Vec<ScannedService>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchImportItem {
    pub(crate) name: String,
    pub(crate) working_dir: String,
}
