export type ServiceKind = 'spring' | 'vue';

export type LaunchType = 'custom' | 'maven' | 'java-main' | 'vue-preset';

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
  launchType: LaunchType;
  command: string;
  frontendScript?: string;
}

export interface SaveGroupInput extends Omit<ServiceGroup, 'id'> {
  id?: string;
}

export interface ServicePilotApi {
  getSnapshot: () => Promise<AppSnapshot>;
  listServices: () => Promise<ServiceConfig[]>;
  listGroups: () => Promise<ServiceGroup[]>;
  getLogHistory: (serviceId: string) => Promise<LogEntry[]>;
  pickDirectory: (defaultPath?: string) => Promise<string | null>;
  pickFile: (defaultPath?: string, filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>;
  setLanguage: (language: AppLanguage) => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  detectProject: (projectDir: string) => Promise<ProjectDetection>;
  importIdeaMavenConfig: (projectDir: string) => Promise<AppSettings>;
  importProject: (projectDir: string) => Promise<ServiceConfig>;
  quickStartProject: (projectDir: string) => Promise<ServiceConfig>;
  importIdeaProject: (projectDir: string) => Promise<ServiceConfig>;
  importState: () => Promise<void>;
  exportState: () => Promise<void>;
  saveService: (input: SaveServiceInput) => Promise<ServiceConfig>;
  deleteService: (serviceId: string) => Promise<void>;
  startService: (serviceId: string) => Promise<void>;
  stopService: (serviceId: string) => Promise<void>;
  restartService: (serviceId: string) => Promise<void>;
  openServiceUrl: (serviceId: string) => Promise<void>;
  saveGroup: (input: SaveGroupInput) => Promise<ServiceGroup>;
  deleteGroup: (groupId: string) => Promise<void>;
  moveGroup: (groupId: string, targetIndex: number) => Promise<void>;
  startGroup: (groupId: string) => Promise<void>;
  stopGroup: (groupId: string) => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  startWindowDrag: () => Promise<void>;
  closeWindow: () => Promise<void>;
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => () => void;
  onLogEntry: (listener: (entry: LogEntry) => void) => () => void;
}
