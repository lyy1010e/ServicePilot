import { memo, startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type {
  AppSettings,
  AppLanguage,
  AppSnapshot,
  LogEntry,
  RuntimeState,
  SaveGroupInput,
  SaveServiceInput,
  ServiceConfig,
  ServiceGroup,
  ServiceKind
} from '@shared/models';
import {
  buildDefaultClasspath,
  buildRuntimeSummary,
  formatDuration,
  parseArgs,
  parseEnv,
  parseProfiles,
  toggleValue
} from './app-utils';

const VERSION = 'v1.0.0';

const EMPTY_SNAPSHOT: AppSnapshot = {
  services: [],
  groups: [],
  runtime: {},
  settings: {
    language: 'zh-CN',
    mavenSettingsFile: '',
    mavenLocalRepository: '',
    clearLogsOnRestart: true
  }
};

type GroupSelection = 'all' | string;
type NavKey = 'services' | 'groups' | 'settings';
type LogLevel = 'SYSTEM' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';
type LogLevelFilter = 'ALL' | LogLevel;

const LOG_LEVELS: LogLevel[] = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'SYSTEM'];
const LOG_LEVEL_FILTERS: LogLevelFilter[] = ['ALL', ...LOG_LEVELS];

type IconName =
  | 'menuService'
  | 'menuGroup'
  | 'menuEnv'
  | 'menuTemplate'
  | 'menuLogs'
  | 'menuSettings'
  | 'refresh'
  | 'batchStart'
  | 'batchStop'
  | 'addService'
  | 'search'
  | 'language'
  | 'close'
  | 'minimize'
  | 'maximize'
  | 'grid'
  | 'list'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'starting'
  | 'log'
  | 'restart'
  | 'start'
  | 'stop'
  | 'delete'
  | 'more'
  | 'external'
  | 'star'
  | 'clearLogs'
  | 'autoScroll'
  | 'spring'
  | 'serviceMark'
  | 'gear'
  | 'chevronDown'
  | 'arrowUp'
  | 'arrowDown';

type Copy = {
  appName: string;
  pageTitle: string;
  pageSubtitle: string;
  languageLabel: string;
  theme: string;
  settings: string;
  serviceManager: string;
  groupManager: string;
  envManager: string;
  templateManager: string;
  logCenter: string;
  systemSettings: string;
  serviceOverview: string;
  totalServices: string;
  running: string;
  stopped: string;
  starting: string;
  failed: string;
  allGroups: string;
  searchPlaceholder: string;
  refresh: string;
  batchStart: string;
  batchStop: string;
  addService: string;
  serviceName: string;
  group: string;
  status: string;
  port: string;
  runtime: string;
  lastStart: string;
  actions: string;
  healthy: string;
  exited: string;
  launchFailed: string;
  logs: string;
  restart: string;
  start: string;
  stop: string;
  delete: string;
  more: string;
  edit: string;
  open: string;
  ungrouped: string;
  serviceLogs: string;
  searchLogs: string;
  autoScroll: string;
  clearLogs: string;
  importConfig: string;
  exportConfig: string;
  manageGroups: string;
  noServices: string;
  noLogService: string;
  noLogs: string;
  noLogsDesc: string;
  deleteConfirm: (name: string) => string;
  quitConfirm: string;
  statusLabel: Record<RuntimeState['status'], string>;
  statusHint: Record<RuntimeState['status'], string>;
  createService: string;
  updateService: string;
  serviceModalDesc: string;
  createGroup: string;
  updateGroup: string;
  groupModalDesc: string;
  name: string;
  workingDirectory: string;
  browse: string;
  chooseFile: string;
  serviceKind: string;
  launchType: string;
  command: string;
  args: string;
  profiles: string;
  envVars: string;
  accessUrl: string;
  saveService: string;
  cancel: string;
  groupName: string;
  groupServices: string;
  saveGroup: string;
  deleteGroup: string;
  springBoot: string;
  vue: string;
  maven: string;
  javaMain: string;
  custom: string;
  vuePreset: string;
  mainClass: string;
  mainClassPlaceholder: string;
  classpath: string;
  classpathPlaceholder: string;
  jvmArgs: string;
  jvmArgsPlaceholder: string;
  generateClasspath: string;
  workingDirPlaceholder: string;
  serviceNamePlaceholder: string;
  profilesPlaceholder: string;
  portPlaceholder: string;
  urlPlaceholder: string;
  envPlaceholder: string;
  mavenForceUpdate: string;
  mavenForceUpdateHint: string;
  mavenDebugMode: string;
  mavenDebugModeHint: string;
  mavenDisableFork: string;
  mavenDisableForkHint: string;
  mavenConfig: string;
  mavenConfigDesc: string;
  logConfig: string;
  clearLogsOnRestart: string;
  clearLogsOnRestartHint: string;
  otherConfig: string;
  otherConfigHint: string;
  advancedConfigManual: string;
  resetSettings: string;
  mavenSettingsFile: string;
  mavenSettingsFileHint: string;
  mavenLocalRepository: string;
  mavenLocalRepositoryHint: string;
  importIdeaConfig: string;
  quickStartIdeaProject: string;
  ideaProject: string;
  rootCause?: string;
  settingsSaved: string;
  settingsSave: string;
  ideaConfigImported: string;
  ideaProjectStarted: string;
  initFailed: string;
  actionFailed: string;
  logLoadFailed: string;
};

const COPY: Record<AppLanguage, Copy> = {
  'zh-CN': {
    appName: 'ServicePilot',
    pageTitle: '全部服务',
    pageSubtitle: '统一管理 Spring Boot 与 Vue 本地联调服务',
    languageLabel: '中文',
    theme: '主题',
    settings: '设置',
    serviceManager: '服务管理',
    groupManager: '分组管理',
    envManager: '环境管理',
    templateManager: '命令模版',
    logCenter: '日志中心',
    systemSettings: '系统设置',
    serviceOverview: '服务概览',
    totalServices: '总服务数',
    running: '运行中',
    stopped: '已停止',
    starting: '启动中',
    failed: '失败',
    allGroups: '全部分组',
    searchPlaceholder: '搜索服务名称或关键词',
    refresh: '刷新',
    batchStart: '批量启动',
    batchStop: '批量停止',
    addService: '新增服务',
    serviceName: '服务名称',
    group: '分组',
    status: '状态',
    port: '端口',
    runtime: '运行时长',
    lastStart: '最近启动',
    actions: '操作',
    healthy: '健康',
    exited: '已退出',
    launchFailed: '启动失败',
    logs: '日志',
    restart: '重启',
    start: '启动',
    stop: '停止',
    delete: '删除',
    more: '更多',
    edit: '编辑',
    open: '打开',
    ungrouped: '未分组',
    serviceLogs: '服务日志',
    searchLogs: '搜索日志内容...',
    autoScroll: '自动滚动',
    clearLogs: '清空日志',
    importConfig: '导入配置',
    exportConfig: '导出配置',
    manageGroups: '管理分组',
    noServices: '当前没有符合筛选条件的服务。',
    noLogService: '未选择日志服务',
    noLogs: '暂无日志',
    noLogsDesc: '服务启动后将在这里实时显示日志',
    deleteConfirm: (name) => `确认删除服务"${name}"吗？此操作不可恢复。`,
    quitConfirm: '退出后将停掉所有正在运行的服务，确认退出吗？',
    statusLabel: {
      running: '运行中',
      stopped: '已停止',
      starting: '启动中',
      failed: '失败',
      stopping: '停止中'
    },
    statusHint: {
      running: '健康',
      stopped: '已退出',
      starting: '正在启动',
      failed: '启动失败',
      stopping: '停止中'
    },
    createService: '新建服务',
    updateService: '编辑服务',
    serviceModalDesc: '配置本地 Spring Boot 或 Vue 服务。',
    createGroup: '新建分组',
    updateGroup: '编辑分组',
    groupModalDesc: '保存一个常用联调服务组合。',
    name: '名称',
    workingDirectory: '打开项目',
    browse: '选择文件夹',
    chooseFile: '选择文件',
    serviceKind: '服务类型',
    launchType: '启动方式',
    command: '命令',
    args: '参数',
    profiles: 'Profiles',
    envVars: '环境变量',
    accessUrl: '访问地址',
    saveService: '保存服务',
    cancel: '取消',
    groupName: '分组名称',
    groupServices: '分组服务',
    saveGroup: '保存分组',
    deleteGroup: '删除分组',
    springBoot: 'Spring Boot',
    vue: 'Vue',
    maven: 'Maven 预设',
    javaMain: 'Java Main',
    custom: '自定义命令',
    vuePreset: 'Vue 预设',
    mainClass: 'Main Class',
    mainClassPlaceholder: '例如：com.example.Application',
    classpath: 'Classpath',
    classpathPlaceholder: '默认：target/classes;target/dependency/*',
    jvmArgs: 'JVM 参数',
    jvmArgsPlaceholder: '例如：-Xms256m -Xmx1024m',
    generateClasspath: '生成默认',
    workingDirPlaceholder: '请选择项目目录',
    serviceNamePlaceholder: '例如：gateway / user-service',
    profilesPlaceholder: '例如：dev, local',
    portPlaceholder: '可不填，默认读取项目配置',
    urlPlaceholder: '例如：http://localhost:5173',
    envPlaceholder: '例如：\nJAVA_HOME=D:\\environment\\jdk17\nSPRING_PROFILES_ACTIVE=dev',
    mavenForceUpdate: '强制更新依赖',
    mavenForceUpdateHint: '追加 -U，强制 Maven 重新检查远端依赖',
    mavenDebugMode: '调试模式',
    mavenDebugModeHint: '追加 -e -X，输出完整异常栈和调试日志',
    mavenDisableFork: '关闭 Fork',
    mavenDisableForkHint: '追加 -Dspring-boot.run.fork=false，让应用异常直接输出到当前日志',
    mavenConfig: 'Maven 全局配置',
    mavenConfigDesc: '统一设置 Maven 的 settings.xml 和本地仓库路径，供所有 Maven 预设服务复用。',
    logConfig: '日志配置',
    clearLogsOnRestart: '重启服务时清空旧日志',
    clearLogsOnRestartHint: '开启后点击重启会先清空该服务旧日志，再写入新的停止和启动日志。',
    otherConfig: '其他',
    otherConfigHint: '其他系统相关设置（更多配置项将陆续支持）',
    advancedConfigManual: '更多高级配置，请在配置文件中手动修改。',
    resetSettings: '重置',
    mavenSettingsFile: 'Maven Settings',
    mavenSettingsFileHint: '例如：D:\\environment\\settings.xml',
    mavenLocalRepository: '本地仓库',
    mavenLocalRepositoryHint: '例如：D:\\environment\\repository',
    importIdeaConfig: '从 IDEA 项目读取',
    quickStartIdeaProject: '选择项目并启动',
    ideaProject: 'IDEA 项目',
    settingsSaved: '设置已保存。',
    settingsSave: '保存',
    ideaConfigImported: '已读取 IDEA Maven 配置。',
    ideaProjectStarted: '已添加项目，正在后台准备并启动。',
    initFailed: '初始化失败。',
    actionFailed: '操作失败。',
    logLoadFailed: '读取日志失败。'
  },
  'en-US': {
    appName: 'ServicePilot',
    pageTitle: 'All Services',
    pageSubtitle: 'Manage local Spring Boot and Vue development services in one place',
    languageLabel: 'English',
    theme: 'Theme',
    settings: 'Settings',
    serviceManager: 'Service Manager',
    groupManager: 'Group Manager',
    envManager: 'Environment',
    templateManager: 'Command Templates',
    logCenter: 'Log Center',
    systemSettings: 'System Settings',
    serviceOverview: 'Service Overview',
    totalServices: 'Total Services',
    running: 'Running',
    stopped: 'Stopped',
    starting: 'Starting',
    failed: 'Failed',
    allGroups: 'All Groups',
    searchPlaceholder: 'Search services or keywords',
    refresh: 'Refresh',
    batchStart: 'Batch Start',
    batchStop: 'Batch Stop',
    addService: 'Add Service',
    serviceName: 'Service Name',
    group: 'Group',
    status: 'Status',
    port: 'Port',
    runtime: 'Runtime',
    lastStart: 'Last Started',
    actions: 'Actions',
    healthy: 'Healthy',
    exited: 'Exited',
    launchFailed: 'Launch Failed',
    logs: 'Logs',
    restart: 'Restart',
    start: 'Start',
    stop: 'Stop',
    delete: 'Delete',
    more: 'More',
    edit: 'Edit',
    open: 'Open',
    ungrouped: 'Ungrouped',
    serviceLogs: 'Service Logs',
    searchLogs: 'Search log content...',
    autoScroll: 'Auto Scroll',
    clearLogs: 'Clear Logs',
    importConfig: 'Import Config',
    exportConfig: 'Export Config',
    manageGroups: 'Manage Groups',
    noServices: 'No services match the current filter.',
    noLogService: 'No log service selected',
    noLogs: 'No logs yet',
    noLogsDesc: 'Service logs will stream here in real time after startup.',
    deleteConfirm: (name) => `Delete service "${name}"? This action cannot be undone.`,
    quitConfirm: 'All running services will be stopped on quit. Continue?',
    statusLabel: {
      running: 'Running',
      stopped: 'Stopped',
      starting: 'Starting',
      failed: 'Failed',
      stopping: 'Stopping'
    },
    statusHint: {
      running: 'Healthy',
      stopped: 'Exited',
      starting: 'Launching',
      failed: 'Launch failed',
      stopping: 'Stopping'
    },
    createService: 'Create Service',
    updateService: 'Edit Service',
    serviceModalDesc: 'Configure a local Spring Boot or Vue service.',
    createGroup: 'Create Group',
    updateGroup: 'Edit Group',
    groupModalDesc: 'Save a reusable service group.',
    name: 'Name',
    workingDirectory: 'Open Project',
    browse: 'Choose Folder',
    chooseFile: 'Choose File',
    serviceKind: 'Service Kind',
    launchType: 'Launch Type',
    command: 'Command',
    args: 'Arguments',
    profiles: 'Profiles',
    envVars: 'Environment Variables',
    accessUrl: 'Access URL',
    saveService: 'Save Service',
    cancel: 'Cancel',
    groupName: 'Group Name',
    groupServices: 'Services',
    saveGroup: 'Save Group',
    deleteGroup: 'Delete Group',
    springBoot: 'Spring Boot',
    vue: 'Vue',
    maven: 'Maven Preset',
    javaMain: 'Java Main',
    custom: 'Custom Command',
    vuePreset: 'Vue Preset',
    mainClass: 'Main Class',
    mainClassPlaceholder: 'For example: com.example.Application',
    classpath: 'Classpath',
    classpathPlaceholder: 'Default: target/classes;target/dependency/*',
    jvmArgs: 'JVM Args',
    jvmArgsPlaceholder: 'For example: -Xms256m -Xmx1024m',
    generateClasspath: 'Use Default',
    workingDirPlaceholder: 'Choose the project folder',
    serviceNamePlaceholder: 'For example: gateway / user-service',
    profilesPlaceholder: 'For example: dev, local',
    portPlaceholder: 'Optional, reads project config by default',
    urlPlaceholder: 'For example: http://localhost:5173',
    envPlaceholder: 'For example:\nJAVA_HOME=D:\\environment\\jdk17\nSPRING_PROFILES_ACTIVE=dev',
    mavenForceUpdate: 'Force dependency refresh',
    mavenForceUpdateHint: 'Add -U so Maven rechecks remote dependencies',
    mavenDebugMode: 'Debug Mode',
    mavenDebugModeHint: 'Add -e -X for full stack traces and Maven debug logs',
    mavenDisableFork: 'Disable Fork',
    mavenDisableForkHint: 'Add -Dspring-boot.run.fork=false so app exceptions print directly in the current log',
    mavenConfig: 'Global Maven Config',
    mavenConfigDesc: 'Reuse one Maven settings.xml and local repository across all Maven preset services.',
    logConfig: 'Log Config',
    clearLogsOnRestart: 'Clear old logs when restarting a service',
    clearLogsOnRestartHint: 'When enabled, Restart clears that service log before writing the new stop and launch output.',
    otherConfig: 'Other',
    otherConfigHint: 'Other system settings. More options will be supported later.',
    advancedConfigManual: 'More advanced options can be edited manually in the config file.',
    resetSettings: 'Reset',
    mavenSettingsFile: 'Maven Settings',
    mavenSettingsFileHint: 'For example: D:\\environment\\settings.xml',
    mavenLocalRepository: 'Local Repository',
    mavenLocalRepositoryHint: 'For example: D:\\environment\\repository',
    importIdeaConfig: 'Read From IDEA Project',
    quickStartIdeaProject: 'Select Project & Start',
    ideaProject: 'IDEA Project',
    rootCause: 'Root Cause',
    settingsSaved: 'Settings saved.',
    settingsSave: 'Save',
    ideaConfigImported: 'IDEA Maven config imported.',
    ideaProjectStarted: 'Project added. Preparing and starting in the background.',
    initFailed: 'Initialization failed.',
    actionFailed: 'Action failed.',
    logLoadFailed: 'Failed to load logs.'
  }
};

const NAV_ITEMS: Array<{ key: NavKey; icon: IconName; copyKey: keyof Copy }> = [
  { key: 'services', icon: 'menuService', copyKey: 'serviceManager' },
  { key: 'groups', icon: 'menuGroup', copyKey: 'groupManager' },
  { key: 'settings', icon: 'menuSettings', copyKey: 'systemSettings' }
];

type ServiceFormState = {
  id?: string;
  name: string;
  serviceKind: ServiceKind;
  launchType: ServiceConfig['launchType'];
  workingDir: string;
  command: string;
  mainClass: string;
  classpath: string;
  jvmArgsText: string;
  argsText: string;
  envText: string;
  profilesText: string;
  portText: string;
  url: string;
  frontendScript: string;
  mavenForceUpdate: boolean;
  mavenDebugMode: boolean;
  mavenDisableFork: boolean;
};

type GroupFormState = {
  id?: string;
  name: string;
  serviceIds: string[];
};

type ServiceGroupFormState = {
  serviceId: string;
  groupIds: string[];
};

type FeedbackState = {
  message: string;
  tone: 'error' | 'success' | 'info';
} | null;

type SettingsFormState = {
  mavenSettingsFile: string;
  mavenLocalRepository: string;
  clearLogsOnRestart: boolean;
};

function AppIcon({ icon, size = 18, className = '' }: { icon: IconName; size?: number; className?: string }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className
  };

  switch (icon) {
    case 'menuService':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="6" height="6" rx="1.5" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" />
        </svg>
      );
    case 'menuGroup':
      return (
        <svg {...common}>
          <path d="M4 8h6l2 2h8v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          <path d="M4 8V6a2 2 0 0 1 2-2h4l2 2h4" />
        </svg>
      );
    case 'menuEnv':
      return (
        <svg {...common}>
          <path d="M12 3l7 4v5c0 4.4-2.6 7.4-7 9-4.4-1.6-7-4.6-7-9V7z" />
          <path d="M9.5 12.5l1.7 1.7 3.3-3.4" />
        </svg>
      );
    case 'menuTemplate':
      return (
        <svg {...common}>
          <path d="M7 7l10 10" />
          <path d="M17 7L7 17" />
          <circle cx="7" cy="7" r="2" />
          <circle cx="17" cy="17" r="2" />
        </svg>
      );
    case 'menuLogs':
      return (
        <svg {...common}>
          <path d="M7 3h8l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          <path d="M15 3v5h5" />
          <path d="M9 13h6M9 17h6" />
        </svg>
      );
    case 'menuSettings':
    case 'gear':
      return (
        <svg {...common}>
          <path d="M12 8.2A3.8 3.8 0 1 0 12 15.8A3.8 3.8 0 1 0 12 8.2Z" />
          <path d="M4.7 13.5l-1.1-1.9 1.6-2.7 2.2.1a6.9 6.9 0 0 1 1.5-.9l.7-2.1h2.8l.7 2.1c.5.2 1 .5 1.5.9l2.2-.1 1.6 2.7-1.1 1.9 1.1 1.9-1.6 2.7-2.2-.1c-.5.4-1 .7-1.5.9l-.7 2.1H9.6l-.7-2.1c-.5-.2-1-.5-1.5-.9l-2.2.1-1.6-2.7z" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M20 12a8 8 0 0 1-13.7 5.7" />
          <path d="M4 12A8 8 0 0 1 17.7 6.3" />
          <path d="M17 3v4h-4" />
          <path d="M7 21v-4h4" />
        </svg>
      );
    case 'batchStart':
    case 'start':
      return (
        <svg {...common}>
          <path d="M8 6l10 6-10 6z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'batchStop':
    case 'stop':
      return (
        <svg {...common}>
          <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'addService':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4 4" />
        </svg>
      );
    case 'language':
      return (
        <svg {...common}>
          <path d="M4 5h8" />
          <path d="M8 3v2" />
          <path d="M10.8 5c-.7 4-2.9 6.9-6.4 8.8" />
          <path d="M5.8 8.3c1.1 2.1 2.9 3.8 5.4 5.1" />
          <path d="M14.2 20l3.5-8 3.5 8" />
          <path d="M15.4 17.2H20" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6l-12 12" />
        </svg>
      );
    case 'minimize':
      return (
        <svg {...common}>
          <path d="M6 12h12" />
        </svg>
      );
    case 'maximize':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
        </svg>
      );
    case 'grid':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="6" height="6" rx="1.2" />
          <rect x="14" y="4" width="6" height="6" rx="1.2" />
          <rect x="4" y="14" width="6" height="6" rx="1.2" />
          <rect x="14" y="14" width="6" height="6" rx="1.2" />
        </svg>
      );
    case 'list':
      return (
        <svg {...common}>
          <path d="M8 7h11M8 12h11M8 17h11" />
          <circle cx="4.5" cy="7" r="1" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="17" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'running':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 12.5l2 2 4-5" />
        </svg>
      );
    case 'stopped':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9v6M15 9v6" />
        </svg>
      );
    case 'failed':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
      );
    case 'starting':
      return (
        <svg {...common}>
          <path d="M12 3a9 9 0 0 1 9 9" />
          <path d="M12 21a9 9 0 0 1-9-9" opacity="0.35" />
          <path d="M3 12a9 9 0 0 1 9-9" opacity="0.55" />
          <path d="M21 12a9 9 0 0 1-9 9" opacity="0.75" />
        </svg>
      );
    case 'log':
      return (
        <svg {...common}>
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      );
    case 'restart':
      return (
        <svg {...common}>
          <path d="M19 12a7 7 0 1 1-2-4.9" />
          <path d="M19 5v5h-5" />
        </svg>
      );
    case 'delete':
      return (
        <svg {...common}>
          <path d="M5 7h14" />
          <path d="M10 3h4" />
          <path d="M8 7l1 12h6l1-12" />
        </svg>
      );
    case 'more':
      return (
        <svg {...common}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case 'external':
      return (
        <svg {...common}>
          <path d="M14 5h5v5" />
          <path d="M10 14l9-9" />
          <path d="M19 14v4a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1h4" />
        </svg>
      );
    case 'star':
      return (
        <svg {...common}>
          <path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'clearLogs':
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M9 4h6" />
          <path d="M7 7l1 12h8l1-12" />
          <path d="M10 11v5M14 11v5" />
        </svg>
      );
    case 'autoScroll':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8" />
          <path d="M8.5 13.5L12 17l3.5-3.5" />
        </svg>
      );
    case 'spring':
      return (
        <svg {...common}>
          <path d="M6 14c2.5 3.5 7.8 4.2 11 1.2 3.2-3 3.5-8.2.8-11.2-.8 2.5-2.7 4.7-5.4 5.7-2.6 1-5.3.6-7.4-.7-.6 1.6-.2 3.5 1 5z" />
          <path d="M8 16c1.4-3.4 4.5-5.7 8.5-6" />
        </svg>
      );
    case 'serviceMark':
      return (
        <svg {...common}>
          <path d="M12 2l8 4.6v10.8L12 22l-8-4.6V6.6z" />
          <path d="M8.5 8.5h7M8.5 12h5M8.5 15.5h7" />
        </svg>
      );
    case 'chevronDown':
      return (
        <svg {...common}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case 'arrowUp':
      return (
        <svg {...common}>
          <path d="M12 6v12" />
          <path d="M7 11l5-5 5 5" />
        </svg>
      );
    case 'arrowDown':
      return (
        <svg {...common}>
          <path d="M12 6v12" />
          <path d="M7 13l5 5 5-5" />
        </svg>
      );
    default:
      return null;
  }
}

function buildServiceForm(service?: ServiceConfig): ServiceFormState {
  return {
    id: service?.id,
    name: service?.name ?? '',
    serviceKind: service?.serviceKind ?? 'spring',
    launchType: service?.launchType ?? 'java-main',
    workingDir: service?.workingDir ?? '',
    command: service?.command ?? '',
    mainClass: service?.mainClass ?? '',
    classpath: service?.classpath ?? '',
    jvmArgsText: service?.jvmArgs?.join(' ') ?? '',
    argsText: service?.args.join(' ') ?? '',
    envText: Object.entries(service?.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    profilesText: service?.profiles?.join(', ') ?? '',
    portText: service?.port ? String(service.port) : '',
    url: service?.url ?? '',
    frontendScript: service?.frontendScript ?? 'dev',
    mavenForceUpdate: service?.mavenForceUpdate ?? false,
    mavenDebugMode: service?.mavenDebugMode ?? false,
    mavenDisableFork: service?.mavenDisableFork ?? false
  };
}

function buildGroupForm(group?: ServiceGroup): GroupFormState {
  return {
    id: group?.id,
    name: group?.name ?? '',
    serviceIds: group?.serviceIds ?? []
  };
}

function buildServiceGroupForm(serviceId: string, groups: ServiceGroup[]): ServiceGroupFormState {
  return {
    serviceId,
    groupIds: groups.filter((group) => group.serviceIds.includes(serviceId)).map((group) => group.id)
  };
}

function buildSettingsForm(settings: AppSettings): SettingsFormState {
  return {
    mavenSettingsFile: settings.mavenSettingsFile ?? '',
    mavenLocalRepository: settings.mavenLocalRepository ?? '',
    clearLogsOnRestart: settings.clearLogsOnRestart ?? true
  };
}

function getProjectNameFromPath(projectPath: string): string {
  const normalized = projectPath.trim().replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]+/);
  return parts[parts.length - 1] ?? '';
}

function getDefaultCommand(launchType: ServiceConfig['launchType']): string {
  if (launchType === 'maven') {
    return 'mvn';
  }
  if (launchType === 'java-main') {
    return 'java';
  }
  if (launchType === 'vue-preset') {
    return 'npm';
  }
  return '';
}

function isSimpleDirectoryImportForm(form: ServiceFormState): boolean {
  const defaultName = getProjectNameFromPath(form.workingDir);
  return (
    !form.id &&
    Boolean(form.workingDir.trim()) &&
    (!form.name.trim() || form.name.trim() === defaultName) &&
    form.serviceKind === 'spring' &&
    form.launchType === 'java-main' &&
    !form.command.trim() &&
    !form.mainClass.trim() &&
    !form.classpath.trim() &&
    !form.jvmArgsText.trim() &&
    !form.argsText.trim() &&
    !form.envText.trim() &&
    !form.profilesText.trim() &&
    !form.portText.trim() &&
    !form.url.trim()
  );
}

function formatLastStart(value: string | undefined, language: AppLanguage): string {
  if (!value) {
    return '--';
  }
  return new Intl.DateTimeFormat(language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

function formatLogTime(value: string | undefined): string {
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  const pad = (target: number, width = 2) => String(target).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  let message = '';
  if (error instanceof Error && error.message) {
    message = error.message;
  } else if (typeof error === 'string' && error.trim()) {
    message = error;
  } else if (error && typeof error === 'object') {
    const candidates = ['message', 'error', 'cause'];
    for (const key of candidates) {
      const value = Reflect.get(error, key);
      if (typeof value === 'string' && value.trim()) {
        message = value;
        break;
      }
    }
  }

  if (!message.trim()) {
    return fallback;
  }

  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return fallback;
  }

  return firstLine.length > 140 ? `${firstLine.slice(0, 140)}...` : firstLine;
}

function getRuntime(snapshot: AppSnapshot, serviceId: string): RuntimeState {
  return snapshot.runtime[serviceId] ?? {
    serviceId,
    status: 'stopped'
  };
}

function getStatusTone(status: RuntimeState['status']): 'running' | 'stopped' | 'failed' | 'starting' {
  if (status === 'running') {
    return 'running';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'starting' || status === 'stopping') {
    return 'starting';
  }
  return 'stopped';
}

function resolveRuntimeUrl(service: ServiceConfig, runtime?: RuntimeState): string | undefined {
  if (runtime?.detectedUrl) {
    return runtime.detectedUrl;
  }
  if (service.url) {
    return service.url;
  }
  if (runtime?.detectedPort) {
    return `http://localhost:${runtime.detectedPort}`;
  }
  if (service.port) {
    return `http://localhost:${service.port}`;
  }
  return undefined;
}

function resolveRuntimePort(service: ServiceConfig, runtime?: RuntimeState): string | undefined {
  if (runtime?.detectedPort) {
    return String(runtime.detectedPort);
  }
  if (service.port) {
    return String(service.port);
  }
  return undefined;
}

function getLaunchCommandPreview(service: ServiceConfig): string {
  if (service.launchType === 'maven') {
    return `${service.command || 'mvn'} spring-boot:run`;
  }
  if (service.launchType === 'java-main') {
    return service.mainClass ? `${service.command || 'java'} ${service.mainClass}` : service.command || 'java';
  }
  if (service.launchType === 'vue-preset') {
    const script = service.frontendScript || 'dev';
    return service.port ? `${service.command || 'npm'} run ${script} -- --port ${service.port}` : `${service.command || 'npm'} run ${script}`;
  }
  return [service.command, ...service.args].filter(Boolean).join(' ');
}

function getServiceGroups(groups: ServiceGroup[], serviceId: string): ServiceGroup[] {
  return groups.filter((group) => group.serviceIds.includes(serviceId));
}

function getGroupName(groups: ServiceGroup[], serviceId: string, fallback: string): string {
  return getServiceGroups(groups, serviceId)[0]?.name ?? fallback;
}

function getGroupNames(groups: ServiceGroup[], serviceId: string, fallback: string): string[] {
  const matches = getServiceGroups(groups, serviceId).map((group) => group.name);
  return matches.length ? matches : [fallback];
}

function buildDonutBackground(summary: ReturnType<typeof buildRuntimeSummary>): string {
  const total = summary.total;

  // 无服务时：单色灰占位
  if (total === 0) {
    return 'conic-gradient(rgba(148,163,184,0.15) 0 100%)';
  }

  const running = (summary.running / total) * 100;
  const stopped = (summary.stopped / total) * 100;
  const starting = (summary.starting / total) * 100;
  const failed = (summary.failed / total) * 100;

  const p1 = running;
  const p2 = p1 + stopped;
  const p3 = p2 + starting;
  const p4 = p3 + failed;

  // 全停时：用主色蓝表示"一切正常，只是已停"
  if (summary.running === 0 && summary.failed === 0 && summary.starting === 0) {
    return 'conic-gradient(rgba(59,130,246,0.45) 0 100%)';
  }

  return `conic-gradient(
    rgba(34,197,94,0.78) 0 ${p1}%,
    rgba(100,116,139,0.35) ${p1}% ${p2}%,
    rgba(245,158,11,0.75) ${p2}% ${p3}%,
    rgba(239,68,68,0.76) ${p3}% ${p4}%,
    rgba(68,85,124,0.2) ${p4}% 100%
  )`;
}

function getLogLevel(entry: LogEntry): LogLevel {
  if (entry.source === 'stderr') {
    return 'ERROR';
  }
  if (entry.source === 'system') {
    return 'SYSTEM';
  }
  const match = stripAnsiSequences(entry.text).match(/\b(INFO|WARN|ERROR|DEBUG|TRACE)\b/);
  return (match?.[1] as LogLevel | undefined) ?? 'INFO';
}

function stripAnsiSequences(text: string): string {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '');
}

function getLogMessage(entry: LogEntry): string {
  return stripAnsiSequences(entry.text).replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s+\w+\s+/, '');
}

function isRootCauseLog(entry: LogEntry): boolean {
  const text = getLogMessage(entry);
  return (
    text.includes('MalformedInputException') ||
    text.includes('parse data from Nacos error') ||
    text.includes('YAMLException') ||
    text.includes('Failed to configure a DataSource') ||
    text.includes('Failed to determine a suitable driver class')
  );
}

function shouldAppendToPreviousLog(previous: LogEntry | undefined, entry: LogEntry): boolean {
  if (!previous || previous.serviceId !== entry.serviceId || previous.source === 'system') {
    return false;
  }
  const previousLevel = getLogLevel(previous);
  if (previousLevel !== 'ERROR' && previous.source !== 'stderr') {
    return false;
  }
  const text = entry.text.trimStart();
  return (
    text.startsWith('at ') ||
    text.startsWith('... ') ||
    text.startsWith('Caused by:') ||
    text.startsWith('Suppressed:') ||
    /^[\w.$]+(?:Exception|Error):/.test(text)
  );
}

function mergeLogEntries(entries: LogEntry[], entry: LogEntry): LogEntry[] {
  const previous = entries[entries.length - 1];
  if (previous?.id === entry.id) {
    return [...entries.slice(0, -1), entry].slice(-2000);
  }
  if (!shouldAppendToPreviousLog(previous, entry)) {
    return [...entries, entry].slice(-2000);
  }
  const merged = {
    ...previous,
    text: `${previous.text}\n${entry.text}`
  };
  return [...entries.slice(0, -1), merged].slice(-2000);
}

function getGroupTone(name: string): 'blue' | 'purple' {
  return name.includes('网关') ? 'purple' : 'blue';
}

function ActionButton({
  icon,
  label,
  kind = 'default',
  compact = false,
  onClick,
  disabled,
  type = 'button',
  iconOnly = false,
  hideLabel = false,
  hideIcon = false
}: {
  icon: IconName;
  label: string;
  kind?: 'default' | 'primary' | 'success' | 'danger';
  compact?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  iconOnly?: boolean;
  hideLabel?: boolean;
  hideIcon?: boolean;
}) {
  const labelHidden = iconOnly || hideLabel;

  return (
    <button
      className={`action-button action-button--${kind} ${compact ? 'action-button--compact' : ''} ${labelHidden ? 'action-button--icon' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={labelHidden ? label : undefined}
      type={type}
    >
      {!hideIcon && <AppIcon icon={icon} size={16} />}
      {!labelHidden && <span>{label}</span>}
    </button>
  );
}

function SidebarItem({
  icon,
  label,
  active = false,
  onClick
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`sidebar-item ${active ? 'sidebar-item--active' : ''}`} onClick={onClick} type="button">
      <span className="sidebar-item__icon">
        <AppIcon icon={icon} size={18} />
      </span>
      <span>{label}</span>
    </button>
  );
}

function DropdownField({
  value,
  options,
  onChange,
  className = '',
  buttonClassName = '',
  align = 'left'
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
  buttonClassName?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <div ref={ref} className={`dropdown-field ${className}`.trim()}>
      <button
        className={`dropdown-field__trigger ${buttonClassName}`.trim()}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        type="button"
      >
        <span>{current?.label ?? ''}</span>
        <AppIcon icon="chevronDown" size={14} />
      </button>
      {open && (
        <div className={`dropdown-field__menu dropdown-field__menu--${align}`}>
          {options.map((option) => (
            <button
              key={option.value}
              className={`dropdown-field__option ${option.value === value ? 'dropdown-field__option--active' : ''}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LogLevelSelect({
  value,
  onChange
}: {
  value: LogLevelFilter;
  onChange: (value: LogLevelFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <div ref={ref} className="pilot-log-level-select">
      <button
        aria-expanded={open}
        className={`pilot-log-level-select__trigger ${open ? 'pilot-log-level-select__trigger--open' : ''}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="pilot-log-level-select__value">
          <span className={`pilot-log-level-dot pilot-log-level-dot--${value.toLowerCase()}`} />
          <span>{value}</span>
        </span>
        <AppIcon icon="chevronDown" size={14} />
      </button>
      {open && (
        <div className="pilot-log-level-select__menu">
          {LOG_LEVEL_FILTERS.map((level) => (
            <button
              className={`pilot-log-level-select__option ${
                level === value ? 'pilot-log-level-select__option--active' : ''
              } ${level === 'ALL' ? 'pilot-log-level-select__option--all' : ''}`}
              key={level}
              onClick={() => {
                onChange(level);
                setOpen(false);
              }}
              type="button"
            >
              <span className="pilot-log-level-select__option-label">
                <span className={`pilot-log-level-dot pilot-log-level-dot--${level.toLowerCase()}`} />
                <span>{level}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LanguageSwitch({
  language,
  onChange
}: {
  language: AppLanguage;
  onChange: (lang: AppLanguage) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = language === 'zh-CN' ? '中文' : 'English';

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <div ref={ref} className="language-switch">
      <button
        className="language-switch__trigger"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="language-switch__icon">
          <AppIcon icon="language" size={18} />
        </span>
        <span>{label}</span>
        <AppIcon icon="chevronDown" size={14} />
      </button>
      {open && (
        <div className="language-switch__dropdown">
          <button
            className={`language-switch__option ${language === 'zh-CN' ? 'language-switch__option--active' : ''}`}
            onClick={() => {
              onChange('zh-CN');
              setOpen(false);
            }}
            type="button"
          >
            中文
          </button>
          <button
            className={`language-switch__option ${language === 'en-US' ? 'language-switch__option--active' : ''}`}
            onClick={() => {
              onChange('en-US');
              setOpen(false);
            }}
            type="button"
          >
            English
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, copy }: { status: RuntimeState['status']; copy: Copy }) {
  const tone = getStatusTone(status);
  return (
    <div className={`status-badge status-badge--${tone}`}>
      <span className={`status-badge__dot status-badge__dot--${tone}`} />
      <span>{copy.statusLabel[status]}</span>
    </div>
  );
}

function ServicePilotLogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-1 -1 34 35" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M16 0.8L29.86 8.8V24.8L16 32.8L2.14 24.8V8.8L16 0.8Z" stroke="#4F8CFF" strokeWidth="2" />
      <text
        x="16"
        y="21.4"
        textAnchor="middle"
        fontFamily="Inter, Arial, Helvetica, sans-serif"
        fontSize="12"
        fontWeight="700"
        fill="#FFFFFF"
        letterSpacing="0.2"
      >
        SP
      </text>
    </svg>
  );
}

function isWindowDragBlocked(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('button, input, select, textarea, a, [role="button"], [data-no-window-drag]'))
  );
}

function renderLogSearchHighlight(text: string, query: string, active: boolean) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return text;
  }

  const normalizedText = text.toLowerCase();
  const segments: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = normalizedText.indexOf(normalizedQuery);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      segments.push(text.slice(cursor, matchIndex));
    }

    const nextCursor = matchIndex + normalizedQuery.length;
    segments.push(
      <mark
        className={`pilot-terminal__search-hit ${active ? 'pilot-terminal__search-hit--active' : ''}`}
        key={`${matchIndex}-${nextCursor}`}
      >
        {text.slice(matchIndex, nextCursor)}
      </mark>
    );
    cursor = nextCursor;
    matchIndex = normalizedText.indexOf(normalizedQuery, cursor);
  }

  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }

  return segments;
}

const LogTerminalRow = memo(function LogTerminalRow({
  entry,
  searchQuery,
  activeSearchMatch,
  registerRow
}: {
  entry: LogEntry;
  searchQuery: string;
  activeSearchMatch: boolean;
  registerRow: (id: string, node: HTMLDivElement | null) => void;
}) {
  const level = getLogLevel(entry);
  const highlight = isRootCauseLog(entry);
  const message = getLogMessage(entry);

  return (
    <div
      className={`pilot-terminal__row ${highlight ? 'pilot-terminal__row--highlight' : ''} ${
        activeSearchMatch ? 'pilot-terminal__row--search-current' : ''
      }`}
      ref={(node) => registerRow(entry.id, node)}
    >
      <span className="pilot-terminal__time">{formatLogTime(entry.timestamp)}</span>
      <span className={`pilot-terminal__level pilot-terminal__level--${level.toLowerCase()}`}>{level}</span>
      <span className={`pilot-terminal__text ${highlight ? 'pilot-terminal__text--highlight' : ''}`}>
        {renderLogSearchHighlight(message, searchQuery, activeSearchMatch)}
      </span>
    </div>
  );
});

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [logsByService, setLogsByService] = useState<Record<string, LogEntry[]>>({});
  const [selectedGroup, setSelectedGroup] = useState<GroupSelection>('all');
  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedLogServiceId, setSelectedLogServiceId] = useState('');
  const [logQuery, setLogQuery] = useState('');
  const [logMatchIndex, setLogMatchIndex] = useState(0);
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeNav, setActiveNav] = useState<NavKey>('services');
  const [rowMenuServiceId, setRowMenuServiceId] = useState('');
  const [selectedWorkspaceGroupId, setSelectedWorkspaceGroupId] = useState('');
  const [groupMenuId, setGroupMenuId] = useState('');
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [serviceGroupSearch, setServiceGroupSearch] = useState('');
  const [serviceForm, setServiceForm] = useState<ServiceFormState | null>(null);
  const [groupForm, setGroupForm] = useState<GroupFormState | null>(null);
  const [serviceGroupForm, setServiceGroupForm] = useState<ServiceGroupFormState | null>(null);
  const [deleteServiceTarget, setDeleteServiceTarget] = useState<ServiceConfig | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>(() =>
    buildSettingsForm({ language: 'zh-CN', mavenSettingsFile: '', mavenLocalRepository: '', clearLogsOnRestart: true })
  );
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [busyKey, setBusyKey] = useState('');
  const [now, setNow] = useState(Date.now());

  const language = snapshot.settings.language;
  const copy = COPY[language];
  const groupUi = useMemo(
    () => ({
      overviewTitle: language === 'zh-CN' ? '分组工作台' : 'Group Workspace',
      overviewDesc: language === 'zh-CN' ? '集中管理分组排序、成员和批量启停。' : 'Manage group order, members, and batch actions.',
      newGroup: language === 'zh-CN' ? '新建分组' : 'New Group',
      editGroup: language === 'zh-CN' ? '编辑分组' : 'Edit Group',
      moveUp: language === 'zh-CN' ? '上移分组' : 'Move Up',
      moveDown: language === 'zh-CN' ? '下移分组' : 'Move Down',
      serviceCount: language === 'zh-CN' ? '个服务' : 'services',
      groupList: language === 'zh-CN' ? '分组列表' : 'Groups',
      groupServices: language === 'zh-CN' ? '组内服务' : 'Services in Group',
      allServices: language === 'zh-CN' ? '全部服务' : 'All Services',
      groupMembersEmpty: language === 'zh-CN' ? '当前分组还没有服务。' : 'This group has no services yet.',
      groupMembersEmptyTitle: language === 'zh-CN' ? '暂无服务' : 'No services',
      groupMembersEmptyDesc: language === 'zh-CN' ? '将服务添加到该分组后在此显示' : 'Add services to this group to see them here.',
      selectGroupHint: language === 'zh-CN' ? '请选择一个分组' : 'Select a group',
      selectGroupDesc: language === 'zh-CN' ? '从左侧点击分组以查看其成员服务' : 'Click a group on the left to view its services.',
      noGroups: language === 'zh-CN' ? '还没有分组，先新建一个吧。' : 'No groups yet. Create one to get started.',
      manageMembership: language === 'zh-CN' ? '移动分组' : 'Manage Groups',
      belongsTo: language === 'zh-CN' ? '所属分组' : 'Groups',
      membershipDesc: language === 'zh-CN' ? '一个服务可以同时加入多个分组。' : 'A service can belong to multiple groups.',
      saveMembership: language === 'zh-CN' ? '确认' : 'Confirm',
      ungroupedHint: language === 'zh-CN' ? '未加入任何分组' : 'Not assigned to any group'
    }),
    [language]
  );
  const deferredServiceSearch = useDeferredValue(serviceSearch.trim().toLowerCase());
  const deferredLogQuery = useDeferredValue(logQuery.trim().toLowerCase());
  const logStreamRef = useRef<HTMLDivElement | null>(null);
  const autoScrollPausedBySearchRef = useRef(false);
  const logRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const registerLogRow = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) {
      logRowRefs.current[id] = node;
      return;
    }
    delete logRowRefs.current[id];
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    window.servicePilot
      .getSnapshot()
      .then((nextSnapshot) => {
        if (!disposed) {
          setSnapshot(nextSnapshot);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setFeedback({
            message: error instanceof Error ? error.message : copy.initFailed,
            tone: 'error'
          });
        }
      });

    const offSnapshot = window.servicePilot.onSnapshot((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });

    const offLog = window.servicePilot.onLogEntry((entry) => {
      startTransition(() => {
        setLogsByService((current) => {
          const entries = current[entry.serviceId] ?? [];
          return {
            ...current,
            [entry.serviceId]: mergeLogEntries(entries, entry)
          };
        });
      });
    });

    return () => {
      disposed = true;
      offSnapshot();
      offLog();
    };
  }, [copy.initFailed]);

  useEffect(() => {
    const closeMenus = () => {
      setRowMenuServiceId('');
      setGroupMenuId('');
    };

    window.addEventListener('click', closeMenus);
    return () => {
      window.removeEventListener('click', closeMenus);
    };
  }, []);

  useEffect(() => {
    if (!snapshot.services.length) {
      setSelectedLogServiceId('');
      return;
    }
    if (!selectedLogServiceId || !snapshot.services.some((service) => service.id === selectedLogServiceId)) {
      setSelectedLogServiceId(snapshot.services[0].id);
    }
  }, [selectedLogServiceId, snapshot.services]);

  useEffect(() => {
    if (selectedGroup === 'all') {
      return;
    }
    if (!snapshot.groups.some((group) => group.id === selectedGroup)) {
      setSelectedGroup('all');
    }
  }, [selectedGroup, snapshot.groups]);

  useEffect(() => {
    if (!snapshot.groups.length) {
      setSelectedWorkspaceGroupId('');
      return;
    }
    if (!selectedWorkspaceGroupId || !snapshot.groups.some((group) => group.id === selectedWorkspaceGroupId)) {
      setSelectedWorkspaceGroupId(snapshot.groups[0].id);
    }
  }, [selectedWorkspaceGroupId, snapshot.groups]);

  // 进入 settings tab 时，用最新的 snapshot.settings 初始化表单
  useEffect(() => {
    if (activeNav === 'settings') {
      setSettingsForm(buildSettingsForm(snapshot.settings));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav]);

  useEffect(() => {
    if (!selectedLogServiceId || logsByService[selectedLogServiceId]) {
      return;
    }

    window.servicePilot
      .getLogHistory(selectedLogServiceId)
      .then((entries) => {
        setLogsByService((current) => ({
          ...current,
          [selectedLogServiceId]: entries.reduce<LogEntry[]>((merged, entry) => mergeLogEntries(merged, entry), [])
        }));
      })
      .catch((error) => {
        setFeedback({
          message: error instanceof Error ? error.message : copy.logLoadFailed,
          tone: 'error'
        });
      });
  }, [copy.logLoadFailed, logsByService, selectedLogServiceId]);

  const currentLogEntries = useMemo(() => logsByService[selectedLogServiceId] ?? [], [logsByService, selectedLogServiceId]);

  const levelFilteredLogEntries = useMemo(() => {
    if (logLevelFilter === 'ALL') {
      return currentLogEntries;
    }
    return currentLogEntries.filter((entry) => getLogLevel(entry) === logLevelFilter);
  }, [currentLogEntries, logLevelFilter]);

  const filteredLogEntries = useMemo(() => {
    if (!deferredLogQuery) {
      return levelFilteredLogEntries;
    }
    return levelFilteredLogEntries.filter((entry) => entry.text.toLowerCase().includes(deferredLogQuery));
  }, [deferredLogQuery, levelFilteredLogEntries]);

  const hasLogQuery = Boolean(deferredLogQuery);
  const logMatchCount = hasLogQuery ? filteredLogEntries.length : 0;
  const activeLogMatchEntryId = hasLogQuery ? filteredLogEntries[logMatchIndex]?.id : undefined;
  const lastFilteredLogEntry = filteredLogEntries[filteredLogEntries.length - 1];
  const logScrollSignal = lastFilteredLogEntry ? `${lastFilteredLogEntry.id}:${lastFilteredLogEntry.text.length}` : '';
  const logSearchStatusText = hasLogQuery
    ? logMatchCount
      ? `${Math.min(logMatchIndex + 1, logMatchCount)} / ${logMatchCount}`
      : '0 / 0'
    : '';
  const logSearchHintText = hasLogQuery
    ? logMatchCount
      ? language === 'zh-CN'
        ? `共找到 ${logMatchCount} 条匹配结果`
        : `${logMatchCount} matches found`
      : language === 'zh-CN'
        ? `未找到匹配内容：${logQuery.trim()}`
        : `No matches for: ${logQuery.trim()}`
    : '';

  const moveLogMatch = (direction: 1 | -1) => {
    if (!logMatchCount) {
      return;
    }
    setAutoScroll(false);
    setLogMatchIndex((current) => (current + direction + logMatchCount) % logMatchCount);
  };

  const handleLogSearchChange = (value: string) => {
    setLogQuery(value);
    setLogMatchIndex(0);
    if (value.trim() && autoScroll) {
      autoScrollPausedBySearchRef.current = true;
      setAutoScroll(false);
    } else if (!value.trim() && autoScrollPausedBySearchRef.current) {
      autoScrollPausedBySearchRef.current = false;
      setAutoScroll(true);
    }
  };

  const clearLogSearch = () => {
    setLogQuery('');
    setLogMatchIndex(0);
    if (autoScrollPausedBySearchRef.current) {
      autoScrollPausedBySearchRef.current = false;
      setAutoScroll(true);
    }
  };

  useEffect(() => {
    setLogMatchIndex(0);
  }, [deferredLogQuery, logLevelFilter, selectedLogServiceId]);

  useEffect(() => {
    if (logMatchIndex < logMatchCount) {
      return;
    }
    setLogMatchIndex(Math.max(0, logMatchCount - 1));
  }, [logMatchCount, logMatchIndex]);

  useLayoutEffect(() => {
    if (!autoScroll || !logStreamRef.current) {
      return;
    }
    const scrollToBottom = () => {
      if (logStreamRef.current) {
        logStreamRef.current.scrollTop = logStreamRef.current.scrollHeight;
      }
    };
    scrollToBottom();
    const frame = window.requestAnimationFrame(scrollToBottom);
    const timer = window.setTimeout(scrollToBottom, 0);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [activeNav, autoScroll, logScrollSignal, selectedLogServiceId]);

  useLayoutEffect(() => {
    if (!activeLogMatchEntryId || !logStreamRef.current) {
      return;
    }

    const row = logRowRefs.current[activeLogMatchEntryId];
    if (!row) {
      return;
    }

    row.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [activeLogMatchEntryId, activeNav]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timer = window.setTimeout(() => {
      setFeedback(null);
    }, feedback.tone === 'error' ? 4200 : 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [feedback]);

  const runtimeSummary = useMemo(() => buildRuntimeSummary(snapshot), [snapshot]);

  const filteredServices = useMemo(() => {
    return snapshot.services.filter((service) => {
      if (selectedGroup !== 'all') {
        const group = snapshot.groups.find((item) => item.id === selectedGroup);
        if (!group?.serviceIds.includes(service.id)) {
          return false;
        }
      }

      if (!deferredServiceSearch) {
        return true;
      }

      const searchHaystack = [
        service.name,
        service.workingDir,
        service.command,
        getGroupNames(snapshot.groups, service.id, copy.ungrouped).join(' ')
      ]
        .join(' ')
        .toLowerCase();

      return searchHaystack.includes(deferredServiceSearch);
    });
  }, [copy.ungrouped, deferredServiceSearch, selectedGroup, snapshot.groups, snapshot.services]);

  const selectedGroupEntity = useMemo(
    () => snapshot.groups.find((group) => group.id === selectedWorkspaceGroupId),
    [selectedWorkspaceGroupId, snapshot.groups]
  );
  const visibleGroupServices = useMemo(() => {
    if (!selectedGroupEntity) {
      return [];
    }
    return snapshot.services.filter((service) => selectedGroupEntity.serviceIds.includes(service.id));
  }, [selectedGroupEntity, snapshot.services]);

  async function runAction(key: string, action: () => Promise<void>) {
    try {
      setBusyKey(key);
      setFeedback(null);
      await action();
    } catch (error) {
      setFeedback({
        message: getActionErrorMessage(error, copy.actionFailed),
        tone: 'error'
      });
    } finally {
      setBusyKey('');
    }
  }

  async function refreshSnapshot() {
    const nextSnapshot = await window.servicePilot.getSnapshot();
    setSnapshot(nextSnapshot);
  }

  async function handleLanguageChange(nextLanguage: AppLanguage) {
    await runAction(`language-${nextLanguage}`, async () => {
      await window.servicePilot.setLanguage(nextLanguage);
    });
  }

  function handleOpenSettings() {
    setActiveNav('settings');
  }

  async function handlePickMavenSettingsFile() {
    const picked = await window.servicePilot.pickFile(settingsForm.mavenSettingsFile || undefined, [
      { name: 'XML', extensions: ['xml'] }
    ]);
    if (!picked) {
      return;
    }
    setSettingsForm({
      ...settingsForm,
      mavenSettingsFile: picked
    });
  }

  async function handlePickMavenRepository() {
    const picked = await window.servicePilot.pickDirectory(settingsForm.mavenLocalRepository || undefined);
    if (!picked) {
      return;
    }
    setSettingsForm({
      ...settingsForm,
      mavenLocalRepository: picked
    });
  }

  async function handleImportIdeaMavenConfig() {
    const defaultPath = serviceForm?.workingDir?.trim() || snapshot.services[0]?.workingDir || undefined;
    const projectDir = await window.servicePilot.pickDirectory(defaultPath);
    if (!projectDir) {
      return;
    }
    await runAction('import-idea-maven', async () => {
      await window.servicePilot.importIdeaMavenConfig(projectDir);
      setFeedback({
        message: copy.ideaConfigImported,
        tone: 'success'
      });
    });
  }

  async function handleQuickImportProject() {
    const defaultPath = snapshot.services[0]?.workingDir || undefined;
    const projectDir = await window.servicePilot.pickDirectory(defaultPath);
    if (!projectDir) {
      return;
    }

    await runAction('import-project', async () => {
      const service = await window.servicePilot.quickStartProject(projectDir);
      setSelectedLogServiceId(service.id);
      setFeedback({
        message: copy.ideaProjectStarted,
        tone: 'success'
      });
    });
  }

  async function handleSaveSettings() {
    await runAction('save-settings', async () => {
      const next = {
        ...snapshot.settings,
        mavenSettingsFile: settingsForm.mavenSettingsFile.trim(),
        mavenLocalRepository: settingsForm.mavenLocalRepository.trim(),
        clearLogsOnRestart: settingsForm.clearLogsOnRestart
      };
      await window.servicePilot.saveSettings(next);
      // 用保存后的值刷新表单（去掉首尾空格）
      setSettingsForm(buildSettingsForm(next));
      setFeedback({
        message: copy.settingsSaved,
        tone: 'success'
      });
    });
  }

  async function handlePickDirectory() {
    if (!serviceForm) {
      return;
    }
    const picked = await window.servicePilot.pickDirectory(serviceForm.workingDir || undefined);
    if (!picked) {
      return;
    }

    try {
      const detected = await window.servicePilot.detectProject(picked);
      setServiceForm((current) => {
        if (!current) {
          return current;
        }

        const currentDefaultName = getProjectNameFromPath(current.workingDir);
        const shouldUseDetectedName =
          !current.id || !current.name.trim() || current.name.trim() === currentDefaultName;

        if (detected.serviceKind === 'vue') {
          return {
            ...current,
            name: shouldUseDetectedName ? detected.name : current.name,
            serviceKind: 'vue',
            launchType: 'vue-preset',
            workingDir: picked,
            command: detected.command,
            frontendScript: detected.frontendScript ?? 'dev',
            mainClass: '',
            classpath: '',
            jvmArgsText: '',
            profilesText: '',
            mavenForceUpdate: false,
            mavenDebugMode: false,
            mavenDisableFork: false
          };
        }

        return {
          ...current,
          name: shouldUseDetectedName ? detected.name : current.name,
          serviceKind: 'spring',
          launchType: 'java-main',
          workingDir: picked,
          command: detected.command,
          frontendScript: 'dev',
          url: ''
        };
      });
    } catch (error) {
      setServiceForm((current) =>
        current
          ? {
              ...current,
              name: !current.id || !current.name.trim() ? getProjectNameFromPath(picked) : current.name,
              workingDir: picked
            }
          : current
      );
      setFeedback({
        message: error instanceof Error ? error.message : copy.actionFailed,
        tone: 'error'
      });
    }
  }

  function handleGenerateClasspath() {
    if (!serviceForm) {
      return;
    }
    setServiceForm({
      ...serviceForm,
      classpath: buildDefaultClasspath(serviceForm.workingDir)
    });
  }

  async function handleSaveService() {
    if (!serviceForm) {
      return;
    }

    if (isSimpleDirectoryImportForm(serviceForm)) {
      await runAction('import-project-service', async () => {
        const service = await window.servicePilot.importProject(serviceForm.workingDir.trim());
        setSelectedLogServiceId(service.id);
        setServiceForm(null);
      });
      return;
    }

    const port = serviceForm.portText.trim() ? Number(serviceForm.portText.trim()) : undefined;
    const payload: SaveServiceInput = {
      id: serviceForm.id,
      name: serviceForm.name.trim(),
      serviceKind: serviceForm.serviceKind,
      launchType: serviceForm.launchType,
      workingDir: serviceForm.workingDir.trim(),
      command: serviceForm.command.trim() || getDefaultCommand(serviceForm.launchType),
      args: parseArgs(serviceForm.argsText),
      env: parseEnv(serviceForm.envText),
      profiles: serviceForm.serviceKind === 'spring' ? parseProfiles(serviceForm.profilesText) : [],
      port: port && !Number.isNaN(port) ? port : undefined,
      url: serviceForm.serviceKind === 'vue' ? serviceForm.url.trim() || undefined : undefined,
      frontendScript: serviceForm.serviceKind === 'vue' ? serviceForm.frontendScript.trim() || 'dev' : undefined,
      mavenForceUpdate:
        serviceForm.serviceKind === 'spring' && serviceForm.launchType === 'maven' ? serviceForm.mavenForceUpdate : false,
      mavenDebugMode:
        serviceForm.serviceKind === 'spring' && serviceForm.launchType === 'maven' ? serviceForm.mavenDebugMode : false,
      mavenDisableFork:
        serviceForm.serviceKind === 'spring' && serviceForm.launchType === 'maven' ? serviceForm.mavenDisableFork : false,
      mainClass:
        serviceForm.serviceKind === 'spring' && serviceForm.launchType === 'java-main'
          ? serviceForm.mainClass.trim() || undefined
          : undefined,
      classpath:
        serviceForm.serviceKind === 'spring' && serviceForm.launchType === 'java-main'
          ? serviceForm.classpath.trim() || undefined
          : undefined,
      jvmArgs:
        serviceForm.serviceKind === 'spring' &&
        (serviceForm.launchType === 'java-main' || serviceForm.launchType === 'maven')
          ? parseArgs(serviceForm.jvmArgsText)
          : []
    };

    await runAction(`save-service-${payload.id ?? 'new'}`, async () => {
      await window.servicePilot.saveService(payload);
      setServiceForm(null);
    });
  }

  async function handleSaveGroup() {
    if (!groupForm) {
      return;
    }

    const payload: SaveGroupInput = {
      id: groupForm.id,
      name: groupForm.name.trim(),
      serviceIds: groupForm.serviceIds
    };

    await runAction(`save-group-${payload.id ?? 'new'}`, async () => {
      const saved = await window.servicePilot.saveGroup(payload);
      setGroupForm(null);
      setSelectedWorkspaceGroupId(saved.id);
    });
  }

  function handleOpenServiceGroups(serviceId: string) {
    setServiceGroupSearch('');
    setServiceGroupForm(buildServiceGroupForm(serviceId, snapshot.groups));
  }

  async function handleSaveServiceGroups() {
    if (!serviceGroupForm) {
      return;
    }

    const targetGroupIds = new Set(serviceGroupForm.groupIds);
    await runAction(`service-groups-${serviceGroupForm.serviceId}`, async () => {
      for (const group of snapshot.groups) {
        const currentlyIncluded = group.serviceIds.includes(serviceGroupForm.serviceId);
        const shouldInclude = targetGroupIds.has(group.id);
        if (currentlyIncluded === shouldInclude) {
          continue;
        }

        await window.servicePilot.saveGroup({
          id: group.id,
          name: group.name,
          serviceIds: shouldInclude
            ? [...group.serviceIds, serviceGroupForm.serviceId]
            : group.serviceIds.filter((serviceId) => serviceId !== serviceGroupForm.serviceId)
        });
      }

      setServiceGroupForm(null);
    });
  }

  async function handleMoveGroup(groupId: string, targetIndex: number) {
    await runAction(`move-group-${groupId}-${targetIndex}`, () => window.servicePilot.moveGroup(groupId, targetIndex));
  }

  async function handleBatchStart() {
    const targets = filteredServices.filter((service) => getRuntime(snapshot, service.id).status !== 'running');
    await runAction('batch-start', async () => {
      for (const service of targets) {
        await window.servicePilot.startService(service.id);
      }
    });
  }

  async function handleBatchStop() {
    const targets = filteredServices.filter((service) => {
      const status = getRuntime(snapshot, service.id).status;
      return status === 'running' || status === 'starting' || status === 'stopping';
    });
    await runAction('batch-stop', async () => {
      for (const service of targets) {
        await window.servicePilot.stopService(service.id);
      }
    });
  }

  function handleRestartService(serviceId: string) {
    void runAction(`restart-${serviceId}`, async () => {
      if (snapshot.settings.clearLogsOnRestart ?? true) {
        setLogsByService((current) => ({
          ...current,
          [serviceId]: []
        }));
      }
      await window.servicePilot.restartService(serviceId);
    });
  }

  const sidebarActions: Record<NavKey, () => void> = {
    services: () => setActiveNav('services'),
    groups: () => setActiveNav('groups'),
    settings: () => handleOpenSettings()
  };

  const handleWindowDragMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.detail > 1 || isWindowDragBlocked(event.target)) {
      return;
    }

    void window.servicePilot.startWindowDrag();
  };

  const handleWindowTitleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (isWindowDragBlocked(event.target)) {
      return;
    }

    void window.servicePilot.toggleMaximizeWindow();
  };

  const blockWindowControlDrag = (event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  return (
    <div className="pilot-app">
      <header
        className="pilot-header"
        data-tauri-drag-region
        onDoubleClick={handleWindowTitleDoubleClick}
        onMouseDown={handleWindowDragMouseDown}
      >
        <div className="pilot-brand">
          <div className="pilot-brand__mark">
            <ServicePilotLogoMark size={40} />
          </div>
          <div className="pilot-brand__copy">
            <h1>{copy.appName}</h1>
            <span className="pilot-brand__version">{VERSION}</span>
          </div>
        </div>

        <div className="pilot-header__tools" data-no-window-drag>
          <LanguageSwitch language={language} onChange={handleLanguageChange} />

          <div
            className="pilot-window-controls"
            data-no-window-drag
            onDoubleClick={blockWindowControlDrag}
            onMouseDown={blockWindowControlDrag}
          >
            <button
              aria-label="Minimize window"
              className="pilot-window-control"
              data-no-window-drag
              onClick={() => void window.servicePilot.minimizeWindow()}
              title={language === 'zh-CN' ? '最小化' : 'Minimize'}
              type="button"
            >
              <AppIcon icon="minimize" size={15} />
            </button>
            <button
              aria-label="Maximize or restore window"
              className="pilot-window-control"
              data-no-window-drag
              onClick={() => void window.servicePilot.toggleMaximizeWindow()}
              title={language === 'zh-CN' ? '最大化/还原' : 'Maximize / Restore'}
              type="button"
            >
              <AppIcon icon="maximize" size={14} />
            </button>
            <button
              aria-label="Close window"
              className="pilot-window-control pilot-window-control--close"
              data-no-window-drag
              onClick={() => {
                if (runtimeSummary.running > 0 && !window.confirm(copy.quitConfirm)) {
                  return;
                }
                void window.servicePilot.closeWindow();
              }}
              title={language === 'zh-CN' ? '关闭' : 'Close'}
              type="button"
            >
              <AppIcon icon="close" size={15} />
            </button>
          </div>
        </div>
      </header>

      <div className="pilot-layout">
        <aside className="pilot-sidebar">
          <div className="pilot-sidebar__nav">
            {NAV_ITEMS.map((item) => (
              <SidebarItem
                key={item.key}
                active={item.key === activeNav}
                icon={item.icon}
                label={copy[item.copyKey] as string}
                onClick={sidebarActions[item.key]}
              />
            ))}
          </div>

          {activeNav !== 'settings' && (
            <section className="pilot-overview-card">
              <div className="pilot-overview-card__title">{copy.serviceOverview}</div>
              <div className="pilot-overview-headline">
                <strong className="pilot-overview-headline__running">{runtimeSummary.running}</strong>
                <span className="pilot-overview-headline__slash">/</span>
                <strong>{runtimeSummary.total}</strong>
              </div>
              <div className="pilot-overview-card__caption">
                <span>{copy.running}</span>
              </div>

              <div className="pilot-overview-stats">
                <div className={`pilot-overview-stats__row ${runtimeSummary.running === 0 ? 'pilot-overview-stats__row--empty' : ''}`}>
                  <span className="pilot-overview-stats__label">
                    <i className="tone-dot tone-dot--running" />
                    {copy.running}
                  </span>
                  <strong className={runtimeSummary.running > 0 ? 'pilot-overview-stats__count--running' : ''}>{runtimeSummary.running}</strong>
                </div>
                <div className={`pilot-overview-stats__row ${runtimeSummary.stopped === 0 ? 'pilot-overview-stats__row--empty' : ''}`}>
                  <span className="pilot-overview-stats__label">
                    <i className="tone-dot tone-dot--stopped" />
                    {copy.stopped}
                  </span>
                  <strong>{runtimeSummary.stopped}</strong>
                </div>
                <div className={`pilot-overview-stats__row ${runtimeSummary.starting === 0 ? 'pilot-overview-stats__row--empty' : ''}`}>
                  <span className="pilot-overview-stats__label">
                    <i className="tone-dot tone-dot--starting" />
                    {copy.starting}
                  </span>
                  <strong>{runtimeSummary.starting}</strong>
                </div>
                <div className={`pilot-overview-stats__row ${runtimeSummary.failed === 0 ? 'pilot-overview-stats__row--empty' : ''}`}>
                  <span className="pilot-overview-stats__label">
                    <i className="tone-dot tone-dot--failed" />
                    {copy.failed}
                  </span>
                  <strong className={runtimeSummary.failed > 0 ? 'pilot-overview-stats__count--failed' : ''}>{runtimeSummary.failed}</strong>
                </div>
              </div>
            </section>
          )}
        </aside>

        <main className="pilot-main">
          {activeNav === 'groups' ? (
            <section className="pilot-surface pilot-surface--groups">
              <section className="pilot-group-hero">
                <div>
                  <h2>{groupUi.overviewTitle}</h2>
                  <p>{groupUi.overviewDesc}</p>
                </div>
                <ActionButton compact icon="addService" kind="primary" label={groupUi.newGroup} onClick={() => setGroupForm(buildGroupForm())} />
              </section>

              <section className="pilot-group-layout">
                <section className="pilot-group-panel">
                  <header className="pilot-group-panel__header">
                    <h3>{groupUi.groupList}</h3>
                    <span>{snapshot.groups.length}</span>
                  </header>

                  <div className="pilot-group-panel__body pilot-group-panel__body--groups">
                    {snapshot.groups.length ? (
                      snapshot.groups.map((group, index) => {
                        const groupServices = snapshot.services.filter((service) => group.serviceIds.includes(service.id));
                        const hasRunningService = groupServices.some((service) => {
                          const status = getRuntime(snapshot, service.id).status;
                          return status === 'running' || status === 'starting' || status === 'stopping';
                        });
                        const isActive = selectedWorkspaceGroupId === group.id;

                        return (
                          <article
                            className={`pilot-group-card ${isActive ? 'pilot-group-card--active' : ''}`}
                            key={group.id}
                            onClick={() => setSelectedWorkspaceGroupId(group.id)}
                          >
                            <div className="pilot-group-card__header">
                              <div className="pilot-group-card__header-left">
                                <strong>{group.name}</strong>
                                <span className="pilot-group-card__count">{groupServices.length}</span>
                              </div>
                              <div className="pilot-group-card__menu" onClick={(event) => event.stopPropagation()}>
                                <button
                                  aria-label={copy.more}
                                  className="pilot-group-card__menu-button"
                                  onClick={() => setGroupMenuId((current) => (current === group.id ? '' : group.id))}
                                  type="button"
                                >
                                  <AppIcon icon="more" size={16} />
                                </button>
                                {groupMenuId === group.id && (
                                  <div className="floating-menu floating-menu--group" onClick={(event) => event.stopPropagation()}>
                                    <button
                                      className="floating-menu__item"
                                      disabled={busyKey !== '' || index === 0}
                                      onClick={() => {
                                        setGroupMenuId('');
                                        void handleMoveGroup(group.id, index - 1);
                                      }}
                                      type="button"
                                    >
                                      {groupUi.moveUp}
                                    </button>
                                    <button
                                      className="floating-menu__item"
                                      disabled={busyKey !== '' || index === snapshot.groups.length - 1}
                                      onClick={() => {
                                        setGroupMenuId('');
                                        void handleMoveGroup(group.id, index + 1);
                                      }}
                                      type="button"
                                    >
                                      {groupUi.moveDown}
                                    </button>
                                    <button
                                      className={`floating-menu__item ${hasRunningService ? 'floating-menu__item--danger' : 'floating-menu__item--success'}`}
                                      disabled={busyKey !== ''}
                                      onClick={() => {
                                        setGroupMenuId('');
                                        void runAction(
                                          `${hasRunningService ? 'stop' : 'start'}-group-${group.id}`,
                                          () => (hasRunningService ? window.servicePilot.stopGroup(group.id) : window.servicePilot.startGroup(group.id))
                                        );
                                      }}
                                      type="button"
                                    >
                                      {hasRunningService ? copy.batchStop : copy.batchStart}
                                    </button>
                                    <button
                                      className="floating-menu__item"
                                      disabled={busyKey !== ''}
                                      onClick={() => {
                                        setGroupMenuId('');
                                        setGroupForm(buildGroupForm(group));
                                      }}
                                      type="button"
                                    >
                                      {groupUi.editGroup}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="pilot-group-card__services">
                              {groupServices.length ? (
                                groupServices.map((service) => (
                                  <span className="pilot-group-card__service" key={service.id}>
                                    {service.name}
                                  </span>
                                ))
                              ) : (
                                <span className="pilot-group-card__empty">{groupUi.groupMembersEmpty}</span>
                              )}
                            </div>
                          </article>
                        );
                      })
                    ) : (
                      <div className="pilot-empty-state pilot-empty-state--compact">
                        <div>{groupUi.noGroups}</div>
                        <ActionButton compact icon="addService" kind="primary" label={groupUi.newGroup} onClick={() => setGroupForm(buildGroupForm())} />
                      </div>
                    )}
                  </div>
                </section>

                <section className="pilot-group-panel">
                  <header className="pilot-group-panel__header">
                    <div>
                      <h3>{selectedGroupEntity?.name ?? groupUi.allServices}</h3>
                      <p>
                        {selectedGroupEntity
                          ? `${visibleGroupServices.length} ${groupUi.serviceCount}`
                          : groupUi.membershipDesc}
                      </p>
                    </div>
                  </header>

                  <div className="pilot-group-panel__body pilot-group-panel__body--services">
                    {visibleGroupServices.length ? (
                      <div className="pilot-group-service-header">
                        <span>{copy.serviceName}</span>
                        <span>{copy.group}</span>
                        <span>{copy.status}</span>
                        <span>{copy.actions}</span>
                      </div>
                    ) : null}
                    {visibleGroupServices.length ? (
                      visibleGroupServices.map((service) => {
                        const runtime = getRuntime(snapshot, service.id);
                        const serviceGroups = getServiceGroups(snapshot.groups, service.id);
                        return (
                          <article className="pilot-group-service" key={service.id}>
                            <div className="pilot-group-service__main">
                              <strong>{service.name}</strong>
                              <span>{getLaunchCommandPreview(service)}</span>
                            </div>

                            <div className="pilot-group-service__meta">
                              <div className="group-chip-list">
                                {serviceGroups.length ? (
                                  serviceGroups.map((group) => (
                                    <span className={`group-chip ${group.id === selectedWorkspaceGroupId ? 'group-chip--primary' : 'group-chip--muted'}`} key={group.id}>
                                      {group.name}
                                    </span>
                                  ))
                                ) : (
                                  <span className="group-chip group-chip--muted">{groupUi.ungroupedHint}</span>
                                )}
                              </div>
                            </div>

                            <div className="pilot-group-service__status">
                              <StatusBadge copy={copy} status={runtime.status} />
                            </div>

                            <div className="pilot-group-service__actions">
                              <ActionButton
                                compact
                                icon="menuGroup"
                                kind="default"
                                label={groupUi.manageMembership}
                                onClick={() => handleOpenServiceGroups(service.id)}
                              />
                              <ActionButton
                                compact
                                disabled={busyKey !== ''}
                                icon={runtime.status === 'running' ? 'stop' : 'start'}
                                kind={runtime.status === 'running' ? 'danger' : 'primary'}
                                label={runtime.status === 'running' ? copy.stop : copy.start}
                                onClick={() => {
                                  const action =
                                    runtime.status === 'running'
                                      ? () => window.servicePilot.stopService(service.id)
                                      : () => window.servicePilot.startService(service.id);
                                  void runAction(`toggle-group-service-${service.id}`, action);
                                }}
                              />
                            </div>
                          </article>
                        );
                      })
                    ) : (
                      <div className="pilot-empty-state pilot-empty-state--compact">
                        <div className="pilot-empty-state__icon">
                          <AppIcon icon="menuGroup" size={20} />
                        </div>
                        <div>
                          <div className="pilot-empty-state__title">
                            {selectedGroupEntity ? groupUi.groupMembersEmptyTitle : groupUi.selectGroupHint}
                          </div>
                          <div className="pilot-empty-state__desc">
                            {selectedGroupEntity ? groupUi.groupMembersEmptyDesc : groupUi.selectGroupDesc}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </section>
            </section>
          ) : activeNav === 'settings' ? (
            <section className="pilot-settings-page">
              <header className="pilot-settings-page__header">
                <div>
                  <h2>{copy.systemSettings}</h2>
                </div>
              </header>

              <div className="pilot-settings-page__body">
                <section className="pilot-settings-group">
                  <div className="pilot-settings-section__heading">
                    <div className="pilot-settings-section__title">{copy.mavenConfig}</div>
                  </div>

                  <label className="field field--full">
                    <span>{copy.mavenSettingsFile}</span>
                    <div className="settings-path-field">
                      <input
                        value={settingsForm.mavenSettingsFile}
                        placeholder={copy.mavenSettingsFileHint}
                        onChange={(event) =>
                          setSettingsForm({
                            ...settingsForm,
                            mavenSettingsFile: event.target.value
                          })
                        }
                      />
                      <button
                        aria-label={copy.chooseFile}
                        className="settings-path-field__button"
                        onClick={() => void handlePickMavenSettingsFile()}
                        title={copy.chooseFile}
                        type="button"
                      >
                        <AppIcon icon="menuLogs" size={16} />
                      </button>
                    </div>
                  </label>

                  <label className="field field--full">
                    <span>{copy.mavenLocalRepository}</span>
                    <div className="settings-path-field">
                      <input
                        value={settingsForm.mavenLocalRepository}
                        placeholder={copy.mavenLocalRepositoryHint}
                        onChange={(event) =>
                          setSettingsForm({
                            ...settingsForm,
                            mavenLocalRepository: event.target.value
                          })
                        }
                      />
                      <button
                        aria-label={copy.browse}
                        className="settings-path-field__button"
                        onClick={() => void handlePickMavenRepository()}
                        title={copy.browse}
                        type="button"
                      >
                        <AppIcon icon="menuGroup" size={16} />
                      </button>
                    </div>
                  </label>
                </section>

                <section className="pilot-settings-group">
                  <div className="pilot-settings-section__heading">
                    <div className="pilot-settings-section__title">{copy.logConfig}</div>
                  </div>

                  <label className="toggle-field field--full">
                    <input
                      type="checkbox"
                      checked={settingsForm.clearLogsOnRestart}
                      onChange={(event) =>
                        setSettingsForm({
                          ...settingsForm,
                          clearLogsOnRestart: event.target.checked
                        })
                      }
                    />
                    <span>
                      <strong>{copy.clearLogsOnRestart}</strong>
                      <small>{copy.clearLogsOnRestartHint}</small>
                    </span>
                  </label>
                </section>

                <div className="pilot-settings-actions">
                  <ActionButton compact icon="refresh" kind="default" label={copy.resetSettings} onClick={() => setSettingsForm(buildSettingsForm(snapshot.settings))} />
                  <ActionButton compact icon="gear" kind="primary" label={copy.settingsSave} onClick={() => void handleSaveSettings()} />
                </div>
              </div>
            </section>
          ) : (
            <section className="pilot-surface pilot-surface--no-gap">
              <div className="pilot-toolbar">
                <div className="pilot-toolbar__filters">
                  <DropdownField
                    value={selectedGroup}
                    options={[
                      { value: 'all', label: copy.allGroups },
                      ...snapshot.groups.map((group) => ({ value: group.id, label: group.name }))
                    ]}
                    onChange={(value) => setSelectedGroup(value)}
                    className="pilot-select"
                    buttonClassName="pilot-select__trigger"
                  />

                  <label className="pilot-search">
                    <AppIcon icon="search" size={17} />
                    <input
                      value={serviceSearch}
                      onChange={(event) => setServiceSearch(event.target.value)}
                      placeholder={copy.searchPlaceholder}
                    />
                  </label>
                </div>

                <div className="pilot-toolbar__actions">
                  <ActionButton
                    compact
                    disabled={busyKey !== ''}
                    icon="refresh"
                    kind="default"
                    label={copy.refresh}
                    onClick={() => {
                      void runAction('refresh', refreshSnapshot);
                    }}
                  />
                  <div className="batch-menu-wrap">
                    <button
                      className="action-button action-button--default action-button--compact"
                      disabled={busyKey !== ''}
                      onClick={(event) => {
                        event.stopPropagation();
                        setBatchMenuOpen((current) => !current);
                      }}
                      type="button"
                    >
                      <AppIcon icon="batchStart" size={16} />
                      <span>{language === 'zh-CN' ? '批量操作' : 'Batch Actions'}</span>
                      <AppIcon icon="chevronDown" size={14} />
                    </button>
                    {batchMenuOpen && (
                      <div className="floating-menu floating-menu--batch" onClick={(event) => event.stopPropagation()}>
                        <button
                          className="floating-menu__item floating-menu__item--success"
                          onClick={() => {
                            setBatchMenuOpen(false);
                            void handleBatchStart();
                          }}
                          type="button"
                        >
                          {copy.batchStart}
                        </button>
                        <button
                          className="floating-menu__item floating-menu__item--danger"
                          onClick={() => {
                            setBatchMenuOpen(false);
                            void handleBatchStop();
                          }}
                          type="button"
                        >
                          {copy.batchStop}
                        </button>
                      </div>
                    )}
                  </div>
                  <ActionButton
                    compact
                    disabled={busyKey !== ''}
                    icon="start"
                    kind="default"
                    label={copy.quickStartIdeaProject}
                    onClick={() => {
                      void handleQuickImportProject();
                    }}
                  />
                  <ActionButton compact icon="addService" kind="primary" label={copy.addService} onClick={() => setServiceForm(buildServiceForm())} />
                </div>
              </div>

              <section className="pilot-table-card">
                <div className="pilot-table-card__body">
                  <header className="pilot-table-card__header">
                    <span>{copy.serviceName}</span>
                    <span>{copy.group}</span>
                    <span>{copy.status}</span>
                    <span>{copy.port}</span>
                    <span>{copy.runtime}</span>
                    <span>{copy.lastStart}</span>
                    <span className="pilot-table-card__actions-head"></span>
                  </header>

                  {filteredServices.map((service) => {
                    const runtime = getRuntime(snapshot, service.id);
                    const tone = getStatusTone(runtime.status);
                    const serviceGroups = getServiceGroups(snapshot.groups, service.id);
                    const servicePort = resolveRuntimePort(service, runtime);
                    const serviceUrl = resolveRuntimeUrl(service, runtime);

                    return (
                      <article
                        className={`service-row service-row--${tone} ${selectedLogServiceId === service.id ? 'service-row--active' : ''}`}
                        key={service.id}
                        onClick={() => setSelectedLogServiceId(service.id)}
                      >
                        <div className="service-row__name">
                          <span className="service-row__name-text" title={service.name}>{service.name}</span>
                        </div>

                        <div className="service-row__group">
                          <div className="group-chip-list">
                            {serviceGroups.length ? (
                              serviceGroups.map((group) => (
                                <span className="group-chip group-chip--primary" key={group.id}>
                                  {group.name}
                                </span>
                              ))
                            ) : (
                              <span className="group-chip group-chip--muted">{copy.ungrouped}</span>
                            )}
                          </div>
                        </div>

                        <div className="service-row__status">
                          <StatusBadge copy={copy} status={runtime.status} />
                        </div>

                        <div className="service-row__port">
                          {serviceUrl ? (
                            <button
                              className="service-row__port-link"
                              onClick={() => {
                                void runAction(`open-${service.id}`, () => window.servicePilot.openServiceUrl(service.id));
                              }}
                              type="button"
                            >
                              <span>{servicePort ?? '--'}</span>
                              {servicePort && <AppIcon icon="external" size={13} />}
                            </button>
                          ) : (
                            <span className="service-row__port-text">{servicePort ?? '--'}</span>
                          )}
                        </div>

                        <div className="service-row__runtime">{formatDuration(runtime, now)}</div>
                        <div className="service-row__last">{formatLastStart(runtime.startedAt, language)}</div>

                        <div className="service-row__actions">
                          {runtime.status === 'running' ? (
                            <>
                              <ActionButton
                                compact
                                disabled={busyKey !== ''}
                                icon="restart"
                                kind="default"
                                label={copy.restart}
                                onClick={() => handleRestartService(service.id)}
                              />
                              <ActionButton
                                compact
                                disabled={busyKey !== ''}
                                icon="stop"
                                kind="danger"
                                label={copy.stop}
                                onClick={() => {
                                  void runAction(`stop-${service.id}`, () => window.servicePilot.stopService(service.id));
                                }}
                              />
                            </>
                          ) : (
                            <ActionButton
                              compact
                              disabled={busyKey !== ''}
                              icon="start"
                              kind="primary"
                              label={copy.start}
                              onClick={() => {
                                void runAction(`start-${service.id}`, () => window.servicePilot.startService(service.id));
                              }}
                            />
                          )}
                          <div className="service-row__menu-wrap">
                            <button
                              className="action-button action-button--default action-button--compact"
                              onClick={(event) => {
                                event.stopPropagation();
                                setRowMenuServiceId((current) => (current === service.id ? '' : service.id));
                              }}
                              type="button"
                            >
                              <AppIcon icon="more" size={16} />
                              <span>{copy.more}</span>
                            </button>
                            {rowMenuServiceId === service.id && (
                                  <div className="floating-menu floating-menu--row" onClick={(event) => event.stopPropagation()}>
                                    <button
                                      className="floating-menu__item"
                                      onClick={() => {
                                        setRowMenuServiceId('');
                                        setServiceForm(buildServiceForm(service));
                                      }}
                                      type="button"
                                    >
                                      {copy.edit}
                                    </button>
                                    <button
                                      className="floating-menu__item"
                                      onClick={() => {
                                        setRowMenuServiceId('');
                                        handleOpenServiceGroups(service.id);
                                      }}
                                      type="button"
                                    >
                                      {groupUi.manageMembership}
                                    </button>
                                    <button
                                      className="floating-menu__item floating-menu__item--danger"
                                      onClick={() => {
                                        setRowMenuServiceId('');
                                        setDeleteServiceTarget(service);
                                      }}
                                      type="button"
                                    >
                                      {copy.delete}
                                    </button>
                                  </div>
                                )}
                          </div>
                        </div>
                      </article>
                    );
                  })}

                  {!filteredServices.length && (
                    <div className="pilot-empty-state">
                      <div>{copy.noServices}</div>
                      <ActionButton
                        compact
                        disabled={busyKey !== ''}
                        icon="start"
                        kind="primary"
                        label={copy.quickStartIdeaProject}
                        onClick={() => {
                          void handleQuickImportProject();
                        }}
                      />
                    </div>
                  )}
                </div>
              </section>

              <section className="pilot-logs-card">
                <div className="pilot-log-tabs">
                  {snapshot.services.map((service) => {
                    const tone = getStatusTone(getRuntime(snapshot, service.id).status);
                    const active = selectedLogServiceId === service.id;
                    return (
                      <button
                        key={service.id}
                        className={`pilot-log-tab ${active ? 'pilot-log-tab--active' : ''}`}
                        onClick={() => setSelectedLogServiceId(service.id)}
                        type="button"
                      >
                        <span className={`tone-dot tone-dot--${tone}`} />
                        <span className="pilot-log-tab__name">{service.name}</span>
                      </button>
                    );
                  })}
                </div>

                <header className="pilot-logs-card__header">
                  <div className="pilot-logs-card__tools">
                    <div className="pilot-logs-card__tool-group pilot-logs-card__tool-group--filters">
                      <label className="pilot-log-level-control">
                        <span>{language === 'zh-CN' ? '日志级别' : 'Log Level'}</span>
                        <LogLevelSelect value={logLevelFilter} onChange={setLogLevelFilter} />
                      </label>

                      <div className="pilot-log-search">
                        <AppIcon icon="search" size={14} />
                        <input
                          value={logQuery}
                          onChange={(event) => handleLogSearchChange(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' || !logQuery.trim()) {
                              return;
                            }
                            event.preventDefault();
                            moveLogMatch(event.shiftKey ? -1 : 1);
                          }}
                          placeholder={copy.searchLogs}
                        />
                        {hasLogQuery && <span className="pilot-log-search__count">{logSearchStatusText}</span>}
                        {hasLogQuery && (
                          <span className="pilot-log-search__actions">
                            <button
                              aria-label={language === 'zh-CN' ? '上一个匹配' : 'Previous match'}
                              className="pilot-log-search__button"
                              disabled={!logMatchCount}
                              onClick={() => moveLogMatch(-1)}
                              type="button"
                            >
                              <AppIcon icon="arrowUp" size={13} />
                            </button>
                            <button
                              aria-label={language === 'zh-CN' ? '下一个匹配' : 'Next match'}
                              className="pilot-log-search__button"
                              disabled={!logMatchCount}
                              onClick={() => moveLogMatch(1)}
                              type="button"
                            >
                              <AppIcon icon="arrowDown" size={13} />
                            </button>
                            <button
                              aria-label={language === 'zh-CN' ? '清空搜索' : 'Clear search'}
                              className="pilot-log-search__button"
                              onClick={clearLogSearch}
                              type="button"
                            >
                              <AppIcon icon="close" size={13} />
                            </button>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="pilot-logs-card__tool-group pilot-logs-card__tool-group--actions">
                      <label className={`pilot-toggle ${autoScroll ? 'pilot-toggle--active' : ''}`}>
                        <input
                          type="checkbox"
                          checked={autoScroll}
                          onChange={(event) => {
                            const nextValue = event.target.checked;
                            autoScrollPausedBySearchRef.current = false;
                            setAutoScroll(nextValue);
                            if (nextValue) {
                              requestAnimationFrame(() => {
                                if (logStreamRef.current) {
                                  logStreamRef.current.scrollTop = logStreamRef.current.scrollHeight;
                                }
                              });
                            }
                          }}
                        />
                        <span>{copy.autoScroll}</span>
                      </label>

                      <ActionButton compact icon="clearLogs" kind="default" label={copy.clearLogs} onClick={() => setLogsByService((current) => ({ ...current, [selectedLogServiceId]: [] }))} />
                    </div>
                  </div>
                </header>

                <div className="pilot-logs-card__body">
                  <div className="pilot-terminal">
                    {logSearchHintText && <div className="pilot-log-search-summary">{logSearchHintText}</div>}
                    <div className="pilot-terminal__body" ref={logStreamRef}>
                      {filteredLogEntries.map((entry) => (
                        <LogTerminalRow
                          activeSearchMatch={activeLogMatchEntryId === entry.id}
                          entry={entry}
                          key={entry.id}
                          registerRow={registerLogRow}
                          searchQuery={deferredLogQuery}
                        />
                      ))}
                      {!filteredLogEntries.length && (
                        <div className="pilot-terminal__empty">
                          <div className="pilot-terminal__empty-icon">
                            <AppIcon icon="log" size={26} />
                          </div>
                          <div className="pilot-terminal__empty-title">
                            {hasLogQuery ? (language === 'zh-CN' ? '未找到匹配内容' : 'No matches') : copy.noLogs}
                          </div>
                          <div className="pilot-terminal__empty-desc">
                            {hasLogQuery ? logQuery.trim() : copy.noLogsDesc}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </section>
          )}
        </main>
      </div>

      {serviceForm && (
        <div className="modal-backdrop">
          <div className="modal modal--service">
            <div className="modal__header">
              <div>
                <h3>{serviceForm.id ? copy.updateService : copy.createService}</h3>
                <p>{copy.serviceModalDesc}</p>
              </div>
              <button className="modal__close" onClick={() => setServiceForm(null)} type="button">
                <AppIcon icon="close" size={16} />
              </button>
            </div>

            <div className="form-grid">
              <div className="field field--full">
                <span>{copy.workingDirectory}</span>
                <div className="field-row field-row--project">
                  <input value={serviceForm.workingDir} placeholder={copy.workingDirPlaceholder} readOnly />
                  <ActionButton
                    compact
                    icon="menuGroup"
                    kind="default"
                    label={language === 'zh-CN' ? '选择项目' : 'Choose Project'}
                    onClick={() => void handlePickDirectory()}
                  />
                </div>
              </div>

              <details className="service-advanced field--full">
                <summary>{language === 'zh-CN' ? '高级配置' : 'Advanced'}</summary>
                <div className="service-advanced__grid">
                  <label className="field">
                    <span>{copy.name}</span>
                    <input
                      value={serviceForm.name}
                      placeholder={copy.serviceNamePlaceholder}
                      onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value })}
                    />
                  </label>

                  <label className="field">
                    <span>{copy.port}</span>
                    <input
                      value={serviceForm.portText}
                      placeholder={copy.portPlaceholder}
                      onChange={(event) => setServiceForm({ ...serviceForm, portText: event.target.value })}
                    />
                  </label>

                  {serviceForm.serviceKind === 'spring' && (
                    <label className="field field--full">
                      <span>{copy.mainClass}</span>
                      <input
                        value={serviceForm.mainClass}
                        placeholder={copy.mainClassPlaceholder}
                        onChange={(event) => setServiceForm({ ...serviceForm, mainClass: event.target.value })}
                      />
                    </label>
                  )}

                  {serviceForm.serviceKind === 'vue' && (
                    <label className="field field--full">
                      <span>{copy.accessUrl}</span>
                      <input
                        value={serviceForm.url}
                        placeholder={copy.urlPlaceholder}
                        onChange={(event) => setServiceForm({ ...serviceForm, url: event.target.value })}
                      />
                    </label>
                  )}

                  {serviceForm.serviceKind === 'spring' && (
                    <label className="field">
                      <span>{copy.profiles}</span>
                      <input
                        value={serviceForm.profilesText}
                        placeholder={copy.profilesPlaceholder}
                        onChange={(event) => setServiceForm({ ...serviceForm, profilesText: event.target.value })}
                      />
                    </label>
                  )}

                  <label className="field">
                    <span>{copy.args}</span>
                    <input
                      value={serviceForm.argsText}
                      placeholder={serviceForm.serviceKind === 'spring' ? '--server.servlet.context-path=/api' : '-- --host 0.0.0.0'}
                      onChange={(event) => setServiceForm({ ...serviceForm, argsText: event.target.value })}
                    />
                  </label>

                  {serviceForm.serviceKind === 'spring' && (
                    <label className="field field--full">
                      <span>{copy.jvmArgs}</span>
                      <input
                        value={serviceForm.jvmArgsText}
                        placeholder={copy.jvmArgsPlaceholder}
                        onChange={(event) => setServiceForm({ ...serviceForm, jvmArgsText: event.target.value })}
                      />
                    </label>
                  )}

                  <label className="field field--full">
                    <span>{copy.envVars}</span>
                    <textarea
                      rows={4}
                      value={serviceForm.envText}
                      placeholder={copy.envPlaceholder}
                      onChange={(event) => setServiceForm({ ...serviceForm, envText: event.target.value })}
                    />
                  </label>

                </div>
              </details>
            </div>

            <div className="modal__footer">
              <ActionButton compact icon="close" kind="default" label={copy.cancel} onClick={() => setServiceForm(null)} />
              <ActionButton compact icon="addService" kind="primary" label={copy.saveService} onClick={() => void handleSaveService()} />
            </div>
          </div>
        </div>
      )}

      {deleteServiceTarget && (
        <div className="modal-backdrop">
          <div className="modal modal--narrow modal--confirm">
            <div className="modal__header">
              <div>
                <h3>{copy.delete}</h3>
                <p>{copy.deleteConfirm(deleteServiceTarget.name)}</p>
              </div>
              <button className="modal__close" onClick={() => setDeleteServiceTarget(null)} type="button">
                <AppIcon icon="close" size={16} />
              </button>
            </div>

            <div className="modal-confirm__body">
              <div className="modal-confirm__service">{deleteServiceTarget.name}</div>
              <div className="modal-confirm__path">{deleteServiceTarget.workingDir}</div>
            </div>

            <div className="modal__footer">
              <ActionButton compact icon="close" kind="default" label={copy.cancel} onClick={() => setDeleteServiceTarget(null)} />
              <ActionButton
                compact
                disabled={busyKey !== ''}
                icon="delete"
                kind="danger"
                label={copy.delete}
                onClick={() => {
                  const target = deleteServiceTarget;
                  void runAction(`delete-${target.id}`, async () => {
                    await window.servicePilot.deleteService(target.id);
                    setDeleteServiceTarget(null);
                    if (selectedLogServiceId === target.id) {
                      setSelectedLogServiceId('');
                    }
                  });
                }}
              />
            </div>
          </div>
        </div>
      )}

      {groupForm && (
        <div className="modal-backdrop">
          <div className="modal modal--narrow">
            <div className="modal__header">
              <div>
                <h3>{groupForm.id ? copy.updateGroup : copy.createGroup}</h3>
                <p>{copy.groupModalDesc}</p>
              </div>
              <button className="modal__close" onClick={() => setGroupForm(null)} type="button">
                <AppIcon icon="close" size={16} />
              </button>
            </div>

            <div className="form-grid">
              <label className="field field--full">
                <span>{copy.groupName}</span>
                <input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} />
              </label>

              <div className="field field--full">
                <span>{copy.groupServices}</span>
                <div className="check-grid">
                  {snapshot.services.map((service) => (
                    <label className="check-row" key={service.id}>
                      <input
                        type="checkbox"
                        checked={groupForm.serviceIds.includes(service.id)}
                        onChange={(event) => {
                          setGroupForm({
                            ...groupForm,
                            serviceIds: toggleValue(groupForm.serviceIds, service.id, event.target.checked)
                          });
                        }}
                      />
                      <span>{service.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal__footer">
              {groupForm.id && (
                <ActionButton
                  compact
                  icon="delete"
                  kind="danger"
                  label={copy.deleteGroup}
                  onClick={() => {
                    void runAction(`delete-group-${groupForm.id}`, async () => {
                      await window.servicePilot.deleteGroup(groupForm.id!);
                      setGroupForm(null);
                      if (selectedGroup === groupForm.id) {
                        setSelectedGroup('all');
                      }
                      if (selectedWorkspaceGroupId === groupForm.id) {
                        setSelectedWorkspaceGroupId('');
                      }
                    });
                  }}
                />
              )}
              <div className="modal__spacer" />
              <ActionButton compact icon="close" kind="default" label={copy.cancel} onClick={() => setGroupForm(null)} />
              <ActionButton compact icon="addService" kind="primary" label={copy.saveGroup} onClick={() => void handleSaveGroup()} />
            </div>
          </div>
        </div>
      )}

      {serviceGroupForm && (
        <div className="modal-backdrop">
          <div className="modal modal--membership">
            <div className="modal__header modal__header--membership">
              <div>
                <h3>{groupUi.manageMembership}</h3>
                <p>{groupUi.membershipDesc}</p>
              </div>
              <button className="modal__close" onClick={() => setServiceGroupForm(null)} type="button">
                <AppIcon icon="close" size={16} />
              </button>
            </div>

            <div className="membership-panel">
              <div className="membership-context">
                <AppIcon icon="menuGroup" size={16} />
                <span>{language === 'zh-CN' ? '为' : 'Set groups for'}</span>
                <strong>{snapshot.services.find((service) => service.id === serviceGroupForm.serviceId)?.name ?? '--'}</strong>
                {language === 'zh-CN' && <span>设置分组</span>}
              </div>

              <div className="membership-toolbar">
                <label className="membership-search">
                  <AppIcon icon="search" size={18} />
                  <input
                    value={serviceGroupSearch}
                    onChange={(event) => setServiceGroupSearch(event.target.value)}
                    placeholder={language === 'zh-CN' ? '搜索分组' : 'Search groups'}
                  />
                </label>
                <button
                  className="membership-new-button"
                  onClick={() => {
                    setServiceGroupForm(null);
                    setGroupForm(buildGroupForm());
                  }}
                  type="button"
                >
                  {language === 'zh-CN' ? '+ 新建分组' : '+ New Group'}
                </button>
              </div>

              <div className="membership-list">
                {snapshot.groups
                  .filter((group) => group.name.toLowerCase().includes(serviceGroupSearch.trim().toLowerCase()))
                  .map((group) => {
                    const checked = serviceGroupForm.groupIds.includes(group.id);
                    const groupServiceCount = group.serviceIds.length;
                    return (
                      <label className={`membership-row ${checked ? 'membership-row--checked' : ''}`} key={group.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setServiceGroupForm({
                              ...serviceGroupForm,
                              groupIds: toggleValue(serviceGroupForm.groupIds, group.id, event.target.checked)
                            });
                          }}
                        />
                        <span className="membership-row__name">{group.name}</span>
                        <span className="membership-row__count">
                          {language === 'zh-CN'
                            ? `${groupServiceCount} 个服务`
                            : `${groupServiceCount} ${groupServiceCount === 1 ? 'service' : 'services'}`}
                        </span>
                      </label>
                    );
                  })}
                {!snapshot.groups.filter((group) => group.name.toLowerCase().includes(serviceGroupSearch.trim().toLowerCase())).length && (
                  <div className="membership-list__empty">
                    {language === 'zh-CN' ? '没有匹配的分组' : 'No matching groups'}
                  </div>
                )}
              </div>

              <div className="membership-selected">
                <span>{language === 'zh-CN' ? '已选：' : 'Selected:'}</span>
                <div className="membership-tags">
                  {snapshot.groups
                    .filter((group) => serviceGroupForm.groupIds.includes(group.id))
                    .map((group) => (
                      <button
                        className="membership-tag"
                        key={group.id}
                        onClick={() =>
                          setServiceGroupForm({
                            ...serviceGroupForm,
                            groupIds: serviceGroupForm.groupIds.filter((groupId) => groupId !== group.id)
                          })
                        }
                        type="button"
                      >
                        <span>{group.name}</span>
                        <AppIcon icon="close" size={14} />
                      </button>
                    ))}
                  {!serviceGroupForm.groupIds.length && (
                    <span className="membership-tags__empty">{language === 'zh-CN' ? '未选择' : 'None'}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="modal__footer modal__footer--membership">
              <ActionButton compact hideIcon icon="close" kind="default" label={copy.cancel} onClick={() => setServiceGroupForm(null)} />
              <ActionButton compact icon="menuGroup" kind="primary" label={groupUi.saveMembership} onClick={() => void handleSaveServiceGroups()} />
            </div>
          </div>
        </div>
      )}


      {feedback && (
        <div className={`pilot-feedback-toast pilot-feedback-toast--${feedback.tone}`}>
          <span>{feedback.message}</span>
          <button
            className="pilot-feedback-toast__close"
            onClick={() => setFeedback(null)}
            type="button"
          >
            <AppIcon icon="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
