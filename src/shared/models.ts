export type ServiceKind = 'spring' | 'vue' | 'rust';

export type LaunchType = 'custom' | 'maven' | 'java-main' | 'vue-preset' | 'cargo-run';

export type AppLanguage = 'zh-CN' | 'en-US';

export type RuntimeStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'failed'
  | 'stopping';

export type LogSource = 'stdout' | 'stderr' | 'system';

export type FailureCategory =
  | 'dependency'
  | 'port'
  | 'plugin'
  | 'compile'
  | 'config'
  | 'process'
  | 'unknown';

export interface ServiceConfig {
  id: string;
  name: string;
  serviceKind: ServiceKind;
  framework?: string;
  launchType: LaunchType;
  workingDir: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  profiles?: string[];
  port?: number;
  url?: string;
  frontendScript?: string;
  mavenForceUpdate?: boolean;
  mavenDebugMode?: boolean;
  mavenDisableFork?: boolean;
  mainClass?: string;
  classpath?: string;
  jvmArgs?: string[];
}

export interface ServiceGroup {
  id: string;
  name: string;
  serviceIds: string[];
}

export interface RuntimeState {
  serviceId: string;
  status: RuntimeStatus;
  pid?: number;
  startedAt?: string;
  elapsedSeconds?: number;
  exitCode?: number | null;
  message?: string;
  detectedPort?: number;
  detectedUrl?: string;
  failureSummary?: string;
  failureCategory?: FailureCategory;
}

export interface LogEntry {
  id: string;
  serviceId: string;
  timestamp: string;
  source: LogSource;
  text: string;
}

export interface PersistedState {
  version: number;
  services: ServiceConfig[];
  groups: ServiceGroup[];
  settings: AppSettings;
}

export interface AppSnapshot {
  services: ServiceConfig[];
  groups: ServiceGroup[];
  runtime: Record<string, RuntimeState>;
  settings: AppSettings;
}

export interface AppSettings {
  language: AppLanguage;
  mavenSettingsFile: string;
  mavenLocalRepository: string;
  clearLogsOnRestart: boolean;
}

export interface SaveServiceInput extends Omit<ServiceConfig, 'id'> {
  id?: string;
}

export interface ProjectDetection {
  name: string;
  serviceKind: ServiceKind;
  framework?: string;
  launchType: LaunchType;
  command: string;
  frontendScript?: string;
}

export interface AppUpdateInfo {
  version: string;
  currentVersion: string;
  notes?: string | null;
  date?: string | null;
}

export interface AppUpdateProgress {
  phase: 'downloading' | 'installing';
  downloaded: number;
  total?: number | null;
}

export interface SaveGroupInput extends Omit<ServiceGroup, 'id'> {
  id?: string;
}

export interface ScannedService {
  name: string;
  workingDir: string;
  framework?: string;
  port?: number;
}

export interface ScanResult {
  services: ScannedService[];
}

export interface BatchImportItem {
  name: string;
  workingDir: string;
}

export interface ServicePilotApi {
  app: AppApi;
  services: ServiceApi;
  groups: GroupApi;
  logs: LogApi;
  settings: SettingsApi;
  dialog: DialogApi;
  window: WindowApi;
  events: EventApi;
}

export interface AppApi {
  getVersion: () => Promise<string>;
  checkUpdate: () => Promise<AppUpdateInfo | null>;
  installUpdate: () => Promise<void>;
  getSnapshot: () => Promise<AppSnapshot>;
  showWindow: () => Promise<void>;
  exit: () => Promise<void>;
}

export interface ServiceApi {
  list: () => Promise<ServiceConfig[]>;
  detectProject: (projectDir: string) => Promise<ProjectDetection>;
  importProject: (projectDir: string) => Promise<ServiceConfig>;
  importIdeaProject: (projectDir: string) => Promise<ServiceConfig>;
  scanSpring: (rootDir: string) => Promise<ScanResult>;
  batchImport: (items: BatchImportItem[]) => Promise<ServiceConfig[]>;
  save: (input: SaveServiceInput) => Promise<ServiceConfig>;
  delete: (serviceId: string) => Promise<void>;
  start: (serviceId: string) => Promise<void>;
  stop: (serviceId: string) => Promise<void>;
  restart: (serviceId: string) => Promise<void>;
  openUrl: (serviceId: string) => Promise<void>;
}

export interface GroupApi {
  list: () => Promise<ServiceGroup[]>;
  save: (input: SaveGroupInput) => Promise<ServiceGroup>;
  delete: (groupId: string) => Promise<void>;
  move: (groupId: string, targetIndex: number) => Promise<void>;
  start: (groupId: string) => Promise<void>;
  stop: (groupId: string) => Promise<void>;
  setServiceMembership: (serviceId: string, groupIds: string[]) => Promise<void>;
  addServicesToGroups: (serviceIds: string[], groupIds: string[]) => Promise<void>;
}

export interface LogApi {
  history: (serviceId: string) => Promise<LogEntry[]>;
  clear: (serviceId: string) => Promise<void>;
}

export interface SettingsApi {
  setLanguage: (language: AppLanguage) => Promise<void>;
  save: (settings: AppSettings) => Promise<void>;
  importIdeaMavenConfig: (projectDir: string) => Promise<AppSettings>;
  importState: () => Promise<void>;
  exportState: () => Promise<void>;
}

export interface DialogApi {
  pickDirectory: (defaultPath?: string) => Promise<string | null>;
  pickFile: (defaultPath?: string, filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>;
}

export interface WindowApi {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  startDrag: () => Promise<void>;
  close: () => Promise<void>;
  onCloseRequested: (listener: () => void) => () => void;
}

export interface EventApi {
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => () => void;
  onLogBatch: (listener: (entries: LogEntry[]) => void) => () => void;
  onUpdateProgress: (listener: (progress: AppUpdateProgress) => void) => () => void;
}
