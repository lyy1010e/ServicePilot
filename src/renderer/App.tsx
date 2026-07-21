import { memo, startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type {
  AppSettings,
  AppLanguage,
  AppSnapshot,
  AppUpdateInfo,
  AppUpdateProgress,
  BatchImportItem,
  LogEntry,
  RuntimeState,
  SaveGroupInput,
  SaveServiceInput,
  ScannedService,
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
import {
  LOG_LEVEL_FILTERS,
  formatLogConsolePrefix,
  getLogLevel,
  getLogMessage,
  isRootCauseLog,
  mergeLogEntries,
  renderLogSearchHighlight,
  type LogLevelFilter
} from './features/logs/log-utils';
import { buildGroupForm, buildServiceGroupForm, type GroupFormState, type ServiceGroupFormState } from './features/groups/group-forms';
import { buildServiceForm, getDefaultCommand, getProjectNameFromPath, isSimpleDirectoryImportForm, type ServiceFormState } from './features/services/service-forms';
import { buildSettingsForm, type SettingsFormState } from './features/settings/settings-forms';
import servicePilotLogo from './assets/icons/brand/servicepilot.svg';
import angularIcon from './assets/icons/tech/angular.svg';
import astroIcon from './assets/icons/tech/astro.svg';
import bunIcon from './assets/icons/tech/bun.svg';
import frontendIcon from './assets/icons/tech/frontend.svg';
import gradleIcon from './assets/icons/tech/gradle.svg';
import javaIcon from './assets/icons/tech/java.svg';
import mavenIcon from './assets/icons/tech/maven.svg';
import nextjsIcon from './assets/icons/tech/nextjs.svg';
import nodeIcon from './assets/icons/tech/node.svg';
import npmIcon from './assets/icons/tech/npm.svg';
import nuxtIcon from './assets/icons/tech/nuxt.svg';
import pnpmIcon from './assets/icons/tech/pnpm.svg';
import reactIcon from './assets/icons/tech/react.svg';
import remixIcon from './assets/icons/tech/remix.svg';
import rustIcon from './assets/icons/tech/rust.svg';
import serviceIcon from './assets/icons/tech/service.svg';
import springBootIcon from './assets/icons/tech/spring-boot.svg';
import storybookIcon from './assets/icons/tech/storybook.svg';
import svelteIcon from './assets/icons/tech/svelte.svg';
import tauriIcon from './assets/icons/tech/tauri.svg';
import viteIcon from './assets/icons/tech/vite.svg';
import vueIcon from './assets/icons/tech/vue.svg';
import yarnIcon from './assets/icons/tech/yarn.svg';

const EMPTY_SNAPSHOT: AppSnapshot = {
  services: [],
  groups: [],
  runtime: {},
  settings: {
    language: 'zh-CN',
    mavenSettingsFile: '',
    mavenLocalRepository: '',
    clearLogsOnRestart: true,
    resumeServicesOnLaunch: false
  }
};

type GroupSelection = 'all' | string;
type NavKey = 'services' | 'groups' | 'settings';
const TECH_ICON_META: Record<string, { src: string; label: string }> = {
  'spring-boot': { src: springBootIcon, label: 'Spring Boot' },
  vue: { src: vueIcon, label: 'Vue' },
  react: { src: reactIcon, label: 'React' },
  vite: { src: viteIcon, label: 'Vite' },
  nextjs: { src: nextjsIcon, label: 'Next.js' },
  nuxt: { src: nuxtIcon, label: 'Nuxt' },
  angular: { src: angularIcon, label: 'Angular' },
  svelte: { src: svelteIcon, label: 'Svelte' },
  astro: { src: astroIcon, label: 'Astro' },
  remix: { src: remixIcon, label: 'Remix' },
  storybook: { src: storybookIcon, label: 'Storybook' },
  node: { src: nodeIcon, label: 'Node.js' },
  npm: { src: npmIcon, label: 'npm' },
  pnpm: { src: pnpmIcon, label: 'pnpm' },
  yarn: { src: yarnIcon, label: 'Yarn' },
  bun: { src: bunIcon, label: 'Bun' },
  tauri: { src: tauriIcon, label: 'Tauri' },
  rust: { src: rustIcon, label: 'Rust' },
  java: { src: javaIcon, label: 'Java' },
  maven: { src: mavenIcon, label: 'Maven' },
  gradle: { src: gradleIcon, label: 'Gradle' },
  frontend: { src: frontendIcon, label: 'Frontend' },
  service: { src: serviceIcon, label: 'Service' }
};

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
  | 'check'
  | 'delete'
  | 'more'
  | 'external'
  | 'star'
  | 'clearLogs'
  | 'autoScroll'
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
  resumeServicesOnLaunch: string;
  resumeServicesOnLaunchHint: string;
  otherConfig: string;
  otherConfigHint: string;
  advancedConfigManual: string;
  resetSettings: string;
  mavenSettingsFile: string;
  mavenSettingsFileHint: string;
  mavenLocalRepository: string;
  mavenLocalRepositoryHint: string;
  importIdeaConfig: string;
  ideaProject: string;
  rootCause?: string;
  settingsSaved: string;
  settingsSave: string;
  ideaConfigImported: string;
  ideaProjectStarted: string;
  initFailed: string;
  actionFailed: string;
  logLoadFailed: string;
  installUpdate: string;
  updateAvailable: string;
  updateReadyTitle: string;
  updateLater: string;
  updateDownloading: string;
  updateDownloadPreparing: string;
  updateDownloadProgress: (percent: number) => string;
  updateInstallingStatus: string;
  updateInstalling: string;
  scanImport: string;
  scanningServices: string;
  detectedServices: (count: number) => string;
  selectAll: string;
  importSelected: string;
  noServicesDetected: string;
  scanFailed: string;
  servicesImported: (count: number) => string;
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
    manageGroups: '管理分组',
    noServices: '当前没有符合筛选条件的服务。',
    noLogService: '未选择日志服务',
    noLogs: '等待服务输出日志...',
    noLogsDesc: '服务启动后将在这里实时显示输出',
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
    serviceModalDesc: '配置本地 Spring Boot、Vue 或 Rust 服务。',
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
    clearLogsOnRestart: '启动或重启服务前清空旧日志',
    clearLogsOnRestartHint: '开启后点击启动或重启会先清空该服务旧日志，再写入新的启动日志。',
    resumeServicesOnLaunch: '启动时恢复上次退出的服务',
    resumeServicesOnLaunchHint: '开启后，会在下次打开 ServicePilot 时自动启动上次正常退出前仍在运行的服务。',
    otherConfig: '其他',
    otherConfigHint: '其他系统相关设置（更多配置项将陆续支持）',
    advancedConfigManual: '更多高级配置，请在配置文件中手动修改。',
    resetSettings: '重置',
    mavenSettingsFile: 'Maven Settings',
    mavenSettingsFileHint: '例如：D:\\environment\\settings.xml',
    mavenLocalRepository: '本地仓库',
    mavenLocalRepositoryHint: '例如：D:\\environment\\repository',
    importIdeaConfig: '从 IDEA 项目读取',
    ideaProject: 'IDEA 项目',
    settingsSaved: '设置已保存。',
    settingsSave: '保存',
    ideaConfigImported: '已读取 IDEA Maven 配置。',
    ideaProjectStarted: '已添加项目，正在后台准备并启动。',
    initFailed: '初始化失败。',
    actionFailed: '操作失败。',
    logLoadFailed: '读取日志失败。',
    installUpdate: '立即更新',
    updateAvailable: '发现新版本',
    updateReadyTitle: 'ServicePilot 有新版本',
    updateLater: '稍后',
    updateDownloading: '正在下载更新',
    updateDownloadPreparing: '正在连接更新服务...',
    updateDownloadProgress: (percent) => `已下载 ${percent}%`,
    updateInstallingStatus: '正在安装更新',
    updateInstalling: '正在下载更新并应用，完成后应用会自动重启。',
    scanImport: '扫描导入',
    scanningServices: '扫描中...',
    detectedServices: (count) => `检测到 ${count} 个 Spring Boot 服务`,
    selectAll: '全选',
    importSelected: '导入选中服务',
    noServicesDetected: '未检测到 Spring Boot 服务',
    scanFailed: '扫描失败',
    servicesImported: (count) => `已导入 ${count} 个服务`
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
    manageGroups: 'Manage Groups',
    noServices: 'No services match the current filter.',
    noLogService: 'No log service selected',
    noLogs: 'Waiting for service log output...',
    noLogsDesc: 'Service output will stream here after startup.',
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
    serviceModalDesc: 'Configure a local Spring Boot, Vue, or Rust service.',
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
    clearLogsOnRestart: 'Clear old logs before starting or restarting a service',
    clearLogsOnRestartHint: 'When enabled, Start and Restart clear that service log before writing the new launch output.',
    resumeServicesOnLaunch: 'Restore services from the previous exit',
    resumeServicesOnLaunchHint: 'When enabled, ServicePilot starts the services that were still running before its last normal exit.',
    otherConfig: 'Other',
    otherConfigHint: 'Other system settings. More options will be supported later.',
    advancedConfigManual: 'More advanced options can be edited manually in the config file.',
    resetSettings: 'Reset',
    mavenSettingsFile: 'Maven Settings',
    mavenSettingsFileHint: 'For example: D:\\environment\\settings.xml',
    mavenLocalRepository: 'Local Repository',
    mavenLocalRepositoryHint: 'For example: D:\\environment\\repository',
    importIdeaConfig: 'Read From IDEA Project',
    ideaProject: 'IDEA Project',
    rootCause: 'Root Cause',
    settingsSaved: 'Settings saved.',
    settingsSave: 'Save',
    ideaConfigImported: 'IDEA Maven config imported.',
    ideaProjectStarted: 'Project added. Preparing and starting in the background.',
    initFailed: 'Initialization failed.',
    actionFailed: 'Action failed.',
    logLoadFailed: 'Failed to load logs.',
    installUpdate: 'Update Now',
    updateAvailable: 'Update available',
    updateReadyTitle: 'ServicePilot update available',
    updateLater: 'Later',
    updateDownloading: 'Downloading update',
    updateDownloadPreparing: 'Connecting to update service...',
    updateDownloadProgress: (percent) => `Downloaded ${percent}%`,
    updateInstallingStatus: 'Installing update',
    updateInstalling: 'Downloading and applying the update. The app will restart when it is done.',
    scanImport: 'Scan & Import',
    scanningServices: 'Scanning...',
    detectedServices: (count) => `Detected ${count} Spring Boot services`,
    selectAll: 'Select All',
    importSelected: 'Import Selected',
    noServicesDetected: 'No Spring Boot services detected',
    scanFailed: 'Scan failed',
    servicesImported: (count) => `Imported ${count} services`
  }
};

const NAV_ITEMS: Array<{ key: NavKey; icon: IconName; copyKey: keyof Copy }> = [
  { key: 'services', icon: 'menuService', copyKey: 'serviceManager' },
  { key: 'groups', icon: 'menuGroup', copyKey: 'groupManager' },
  { key: 'settings', icon: 'menuSettings', copyKey: 'systemSettings' }
];


type FeedbackState = {
  message: string;
  tone: 'error' | 'success' | 'info';
} | null;


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
      return (
        <svg {...common}>
          <path d="M8 5.6l10.2 6.4L8 18.4z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'start':
      return (
        <svg {...common}>
          <path d="M8 5.6l10.2 6.4L8 18.4z" />
        </svg>
      );
    case 'batchStop':
    case 'stop':
      return (
        <svg {...common}>
          <rect x="6.2" y="6.2" width="11.6" height="11.6" rx="1.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M5 12.5l4.2 4.2L19 7" />
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
          <path d="M19.4 8.1A8.1 8.1 0 1 0 18 16.7" />
          <path d="M19.4 4.2v5.6h-5.6" />
          <path d="M9.2 6.8l8.5 5.2-8.5 5.2z" fill="#4ade80" stroke="none" />
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
          <circle cx="12" cy="5.8" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="18.2" r="1.4" fill="currentColor" stroke="none" />
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

function canStopRuntime(status: RuntimeState['status']): boolean {
  return status === 'running' || status === 'starting';
}

function isStopActionDisabled(busyKey: string, serviceId: string, status: RuntimeState['status']): boolean {
  if (!busyKey) {
    return false;
  }
  if (status === 'starting') {
    return busyKey === 'install-update' || busyKey === `stop-${serviceId}`;
  }
  return true;
}

function getServiceAvatarTone(index: number): 'blue' | 'green' | 'purple' | 'amber' | 'rose' {
  const tones = ['blue', 'green', 'purple', 'amber', 'rose'] as const;
  return tones[index % tones.length];
}

function normalizeFrameworkIconKey(service: ServiceConfig): string {
  const framework = service.framework?.trim().toLowerCase();
  if (framework && TECH_ICON_META[framework]) {
    return framework;
  }
  if (service.serviceKind === 'spring') {
    return 'spring-boot';
  }
  return 'service';
}

function ServiceTechIcon({ service, index }: { service: ServiceConfig; index: number }) {
  const iconKey = normalizeFrameworkIconKey(service);
  const icon = TECH_ICON_META[iconKey];
  if (icon) {
    return (
      <span className="service-row__avatar service-row__avatar--tech" title={icon.label}>
        <img alt="" src={icon.src} />
      </span>
    );
  }

  return (
    <span className={`service-row__avatar service-row__avatar--${getServiceAvatarTone(index)}`}>
      <AppIcon icon="serviceMark" size={15} />
    </span>
  );
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
  if (service.launchType === 'cargo-run') {
    return service.port ? `${service.command || 'cargo'} run -- --port ${service.port}` : `${service.command || 'cargo'} run`;
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
  hideIcon = false,
  className = ''
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
  className?: string;
}) {
  const labelHidden = iconOnly || hideLabel;

  return (
    <button
      className={`action-button action-button--${kind} ${compact ? 'action-button--compact' : ''} ${labelHidden ? 'action-button--icon' : ''} ${className}`.trim()}
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

function ModalButton({
  kind = 'secondary',
  label,
  onClick,
  disabled = false,
  icon,
  hideIcon
}: {
  kind?: 'secondary' | 'primary' | 'danger';
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: IconName;
  hideIcon?: boolean;
}) {
  const buttonKind = kind === 'secondary' ? 'default' : kind;
  const buttonIcon = icon ?? (kind === 'primary' ? 'check' : kind === 'danger' ? 'delete' : undefined);

  return (
    <button
      className={`modal-btn modal-btn--${kind} action-button action-button--${buttonKind}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {!hideIcon && buttonIcon && <AppIcon icon={buttonIcon} size={16} />}
      <span>{label}</span>
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

function isWindowDragBlocked(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('button, input, select, textarea, a, [role="button"], [data-no-window-drag]'))
  );
}

const ITEM_HEIGHT_ESTIMATE = 22;
const OVERSCAN = 10;
const LOG_BOTTOM_TOLERANCE = 32;

const VirtualLogList = memo(function VirtualLogList({
  items,
  searchQuery,
  activeSearchMatchId,
  autoScroll,
  emptyTitle
}: {
  items: LogEntry[];
  searchQuery: string;
  activeSearchMatchId: string | undefined;
  autoScroll: boolean;
  emptyTitle: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const programmaticScrollRef = useRef(false);
  const followTailRef = useRef(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  useEffect(() => {
    const activeIds = new Set(items.map((item) => item.id));
    setMeasuredHeights((current) => {
      const staleIds = Object.keys(current).filter((id) => !activeIds.has(id));
      if (!staleIds.length) {
        return current;
      }
      return Object.fromEntries(Object.entries(current).filter(([id]) => activeIds.has(id)));
    });
  }, [items]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    setContainerHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  // 测量已渲染行的实际高度
  const measureRow = useCallback((id: string, node: HTMLDivElement | null) => {
    if (!node) return;
    const h = node.offsetHeight;
    if (h > 0) {
      setMeasuredHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }));
    }
  }, []);

  // 搜索跳转
  useEffect(() => {
    if (!activeSearchMatchId || !containerRef.current) return;
    const idx = items.findIndex((e) => e.id === activeSearchMatchId);
    if (idx < 0) return;
    let top = 0;
    for (let i = 0; i < idx; i++) top += measuredHeights[items[i].id] || ITEM_HEIGHT_ESTIMATE;
    const rowH = measuredHeights[activeSearchMatchId] || ITEM_HEIGHT_ESTIMATE;
    const el = containerRef.current;
    const targetTop = top - el.clientHeight / 2 + rowH / 2;
    el.scrollTop = Math.max(0, targetTop);
  }, [activeSearchMatchId, items, measuredHeights]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    if (!autoScroll || programmaticScrollRef.current) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    followTailRef.current = distanceFromBottom <= LOG_BOTTOM_TOLERANCE;
  }, [autoScroll]);

  // 计算总高度和可见范围
  const { totalHeight, startIndex, endIndex, offsetY } = useMemo(() => {
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      total += measuredHeights[items[i].id] || ITEM_HEIGHT_ESTIMATE;
    }

    let acc = 0;
    let start = 0;
    for (let i = 0; i < items.length; i++) {
      const h = measuredHeights[items[i].id] || ITEM_HEIGHT_ESTIMATE;
      if (acc + h >= scrollTop) { start = i; break; }
      acc += h;
      if (i === items.length - 1) start = i;
    }

    const visibleStart = Math.max(0, start - OVERSCAN);
    let visibleEnd = start;
    let consumed = acc;
    for (let i = start; i < items.length; i++) {
      consumed += measuredHeights[items[i].id] || ITEM_HEIGHT_ESTIMATE;
      visibleEnd = i;
      if (consumed >= scrollTop + containerHeight) break;
    }
    visibleEnd = Math.min(items.length - 1, visibleEnd + OVERSCAN);

    let topPad = 0;
    for (let i = 0; i < visibleStart; i++) {
      topPad += measuredHeights[items[i].id] || ITEM_HEIGHT_ESTIMATE;
    }

    return { totalHeight: total, startIndex: visibleStart, endIndex: visibleEnd, offsetY: topPad };
  }, [items, scrollTop, containerHeight, measuredHeights]);

  const visibleItems = items.slice(startIndex, endIndex + 1);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, []);

  useLayoutEffect(() => {
    if (!autoScroll) {
      followTailRef.current = true;
      return;
    }
    if (!followTailRef.current) return;
    scrollToBottom();
    const frame = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(frame);
  }, [autoScroll, containerHeight, items.length, scrollToBottom, totalHeight]);

  if (!items.length) {
    return (
      <div className="pilot-terminal__body pilot-terminal__body--empty">
        <div className="pilot-terminal__empty">{emptyTitle}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="pilot-terminal__body"
      onScroll={handleScroll}
      style={{ overflow: 'auto' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((entry) => {
            const level = getLogLevel(entry);
            const highlight = isRootCauseLog(entry);
            const message = getLogMessage(entry);
            return (
              <div
                key={entry.id}
                ref={(node) => measureRow(entry.id, node)}
                className={`pilot-terminal__row ${highlight ? 'pilot-terminal__row--highlight' : ''} ${
                  activeSearchMatchId === entry.id ? 'pilot-terminal__row--search-current' : ''
                }`}
              >
                <span className={`pilot-terminal__text pilot-terminal__text--${level.toLowerCase()} ${highlight ? 'pilot-terminal__text--highlight' : ''}`}>
                  <span className="pilot-terminal__prefix">{formatLogConsolePrefix(entry, level)} </span>
                  {renderLogSearchHighlight(message, searchQuery, activeSearchMatchId === entry.id)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

const ServiceRuntimeDuration = memo(function ServiceRuntimeDuration({ runtime }: { runtime: RuntimeState | undefined }) {
  const [now, setNow] = useState(Date.now());
  const isActive = runtime && (runtime.status === 'running' || runtime.status === 'starting' || runtime.status === 'stopping') && runtime.startedAt;
  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isActive]);
  return <div className="service-row__runtime">{formatDuration(runtime, now)}</div>;
});

export { getLogMessage };

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [isReady, setIsReady] = useState(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [logsByService, setLogsByService] = useState<Record<string, LogEntry[]>>({});
  const [selectedGroup, setSelectedGroup] = useState<GroupSelection>('all');
  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [selectedLogServiceId, setSelectedLogServiceId] = useState('');
  const [logQuery, setLogQuery] = useState('');
  const [logMatchIndex, setLogMatchIndex] = useState(0);
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>('ALL');
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeNav, setActiveNav] = useState<NavKey>('services');
  const [rowMenuServiceId, setRowMenuServiceId] = useState('');
  const [selectedWorkspaceGroupId, setSelectedWorkspaceGroupId] = useState('');
  const [groupMenuId, setGroupMenuId] = useState('');
  const [serviceGroupSearch, setServiceGroupSearch] = useState('');
  const [serviceForm, setServiceForm] = useState<ServiceFormState | null>(null);
  const [groupForm, setGroupForm] = useState<GroupFormState | null>(null);
  const [serviceGroupForm, setServiceGroupForm] = useState<ServiceGroupFormState | null>(null);
  const [deleteServiceTarget, setDeleteServiceTarget] = useState<ServiceConfig | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>(() =>
    buildSettingsForm({ language: 'zh-CN', mavenSettingsFile: '', mavenLocalRepository: '', clearLogsOnRestart: true, resumeServicesOnLaunch: false })
  );
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [busyKey, setBusyKey] = useState('');
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updatePromptOpen, setUpdatePromptOpen] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<AppUpdateProgress | null>(null);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanResults, setScanResults] = useState<ScannedService[]>([]);
  const [scanSelected, setScanSelected] = useState<Set<string>>(new Set());
  const [scanLoading, setScanLoading] = useState(false);
  const [scanGroupIds, setScanGroupIds] = useState<string[]>([]);
  const logTabsRef = useRef<HTMLDivElement | null>(null);

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
  const autoScrollPausedBySearchRef = useRef(false);
  const selectedLogServiceIdRef = useRef(selectedLogServiceId);
  selectedLogServiceIdRef.current = selectedLogServiceId;

  const handleCloseAttempt = useCallback(() => {
    const current = snapshotRef.current;
    const hasRunning = current.services.some((service) => {
      const status = (current.runtime[service.id]?.status ?? 'stopped') as string;
      return status === 'running' || status === 'starting' || status === 'stopping';
    });
    if (hasRunning) {
      setExitConfirmOpen(true);
    } else {
      void window.servicePilot.app.exit();
    }
  }, []);


  useEffect(() => {
    let disposed = false;
    window.servicePilot.app
      .getVersion()
      .then((version) => {
        if (!disposed) {
          setAppVersion(version);
        }
      })
      .catch(() => {
        if (!disposed) {
          setAppVersion('1.0.0');
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!isReady) { return; }
    let disposed = false;
    const timer = window.setTimeout(() => {
      window.servicePilot.app
        .checkUpdate()
        .then((nextUpdate) => {
          if (!disposed) {
            setUpdateInfo(nextUpdate);
            setUpdatePromptOpen(Boolean(nextUpdate));
            setUpdateProgress(null);
          }
        })
        .catch(() => {
          if (!disposed) {
            setUpdateInfo(null);
            setUpdatePromptOpen(false);
            setUpdateProgress(null);
          }
        });
    }, 3000);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [isReady]);

  useEffect(() => {
    let disposed = false;

    performance.mark('sp-snapshot-start');
    window.servicePilot.app
      .getSnapshot()
      .then((nextSnapshot) => {
        if (!disposed) {
          performance.mark('sp-snapshot-end');
          performance.measure('sp: getSnapshot IPC', 'sp-snapshot-start', 'sp-snapshot-end');
          setSnapshot(nextSnapshot);
          setIsReady(true);
        }
      })
      .catch((error) => {
        if (!disposed) {
          performance.mark('sp-snapshot-end');
          performance.measure('sp: getSnapshot IPC (failed)', 'sp-snapshot-start', 'sp-snapshot-end');
          setFeedback({
            message: error instanceof Error ? error.message : copy.initFailed,
            tone: 'error'
          });
          setIsReady(true);
        }
      });

    const offSnapshot = window.servicePilot.events.onSnapshot((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });

    const offLog = window.servicePilot.events.onLogBatch((entries) => {
      const selectedId = selectedLogServiceIdRef.current;
      if (!selectedId || !snapshotRef.current.services.some((service) => service.id === selectedId)) {
        return;
      }
      const selectedEntries = entries.filter((entry) => entry.serviceId === selectedId);
      if (!selectedEntries.length) {
        return;
      }
      startTransition(() => {
        setLogsByService((current) => {
          // 只为当前选中的服务累积实时日志，其他服务切换时从 logs.history 加载
          const currentEntries = current[selectedId] ?? [];
          return {
            [selectedId]: selectedEntries.reduce(mergeLogEntries, currentEntries)
          };
        });
      });
    });

    const offUpdateProgress = window.servicePilot.events.onUpdateProgress((progress) => {
      setUpdatePromptOpen(true);
      setUpdateProgress(progress);
    });

    const offCloseRequested = window.servicePilot.window.onCloseRequested(() => {
      handleCloseAttempt();
    });

    return () => {
      disposed = true;
      offSnapshot();
      offLog();
      offUpdateProgress();
      offCloseRequested();
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
    if (!isReady) { return; }
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('fade-out');
      window.setTimeout(() => { splash.remove(); }, 350);
    }
    window.servicePilot.app.showWindow().catch(() => {});
    try {
      performance.mark('sp-ready-end');
      performance.measure('sp: total to interactive', 'sp-bridge-start', 'sp-ready-end');
      const measures = performance.getEntriesByType('measure');
      for (const m of measures) {
        console.log(`[ServicePilot] ${m.name}: ${m.duration.toFixed(1)}ms`);
      }
    } catch {
      // performance marks may not exist in test environment
    }
  }, [isReady]);

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
    setLogsByService((current) => {
      if (!selectedLogServiceId || !current[selectedLogServiceId]) {
        return Object.keys(current).length ? {} : current;
      }
      return Object.keys(current).length === 1 ? current : { [selectedLogServiceId]: current[selectedLogServiceId] };
    });
  }, [selectedLogServiceId]);

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
    if (!logsExpanded || !selectedLogServiceId || logsByService[selectedLogServiceId]) {
      return;
    }

    window.servicePilot.logs
      .history(selectedLogServiceId)
      .then((entries) => {
        setLogsByService((current) => {
          const history = entries.reduce<LogEntry[]>((merged, entry) => mergeLogEntries(merged, entry), []);
          return {
            [selectedLogServiceId]: (current[selectedLogServiceId] ?? []).reduce(mergeLogEntries, history)
          };
        });
      })
      .catch((error) => {
        setFeedback({
          message: error instanceof Error ? error.message : copy.logLoadFailed,
          tone: 'error'
        });
      });
  }, [copy.logLoadFailed, logsByService, logsExpanded, selectedLogServiceId]);

  const selectedLogService = useMemo(
    () => snapshot.services.find((service) => service.id === selectedLogServiceId),
    [selectedLogServiceId, snapshot.services]
  );

  useEffect(() => {
    if (!logsExpanded || !selectedLogServiceId) {
      return;
    }
    const activeTab = logTabsRef.current?.querySelector<HTMLElement>('.pilot-log-tab--active');
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [logsExpanded, selectedLogServiceId]);

  const currentLogEntries = useMemo(() => logsByService[selectedLogServiceId] ?? [], [logsByService, selectedLogServiceId]);

  const levelFilteredLogEntries = useMemo(() => {
    if (logLevelFilter === 'ALL') {
      return currentLogEntries;
    }
    return currentLogEntries.filter((entry) => getLogLevel(entry) === logLevelFilter);
  }, [currentLogEntries, logLevelFilter]);

  const matchedLogEntries = useMemo(() => {
    if (!deferredLogQuery) {
      return [];
    }
    return levelFilteredLogEntries.filter((entry) => entry.text.toLowerCase().includes(deferredLogQuery));
  }, [deferredLogQuery, levelFilteredLogEntries]);

  const hasLogQuery = Boolean(deferredLogQuery);
  const logMatchCount = matchedLogEntries.length;
  const activeLogMatchEntryId = hasLogQuery ? matchedLogEntries[logMatchIndex]?.id : undefined;
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

  useEffect(() => {
    if (!feedback) {
      return;
    }
    if (feedback.tone === 'info' && busyKey === 'install-update') {
      return;
    }

    const timer = window.setTimeout(() => {
      setFeedback(null);
    }, feedback.tone === 'error' ? 4200 : 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [busyKey, feedback]);

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
  const selectedVisibleServiceIds = useMemo(
    () => filteredServices.filter((service) => selectedServiceIds.has(service.id)).map((service) => service.id),
    [filteredServices, selectedServiceIds]
  );
  const batchScopeServices = useMemo(
    () =>
      selectedVisibleServiceIds.length
        ? filteredServices.filter((service) => selectedServiceIds.has(service.id))
        : filteredServices,
    [filteredServices, selectedServiceIds, selectedVisibleServiceIds.length]
  );
  const batchStartTargetCount = useMemo(
    () =>
      batchScopeServices.filter(
        (service) => !['running', 'starting', 'stopping'].includes(getRuntime(snapshot, service.id).status)
      ).length,
    [batchScopeServices, snapshot]
  );
  const batchStopTargetCount = useMemo(
    () =>
      batchScopeServices.filter((service) => {
        const status = getRuntime(snapshot, service.id).status;
        return status === 'running' || status === 'starting' || status === 'stopping';
      }).length,
    [batchScopeServices, snapshot]
  );
  const allVisibleServicesSelected =
    filteredServices.length > 0 && selectedVisibleServiceIds.length === filteredServices.length;

  useEffect(() => {
    const visibleIds = new Set(filteredServices.map((service) => service.id));
    setSelectedServiceIds((current) => {
      const next = new Set([...current].filter((serviceId) => visibleIds.has(serviceId)));
      return next.size === current.size ? current : next;
    });
  }, [filteredServices]);

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
  const updateDownloadPercent = useMemo(() => {
    if (!updateProgress?.total) {
      return null;
    }
    return Math.min(100, Math.max(0, Math.round((updateProgress.downloaded / updateProgress.total) * 100)));
  }, [updateProgress]);
  const isInstallingUpdate = busyKey === 'install-update';
  const updateStatusText = updateProgress?.phase === 'installing'
    ? copy.updateInstalling
    : updateDownloadPercent !== null
      ? copy.updateDownloadProgress(updateDownloadPercent)
      : copy.updateDownloadPreparing;

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
    const nextSnapshot = await window.servicePilot.app.getSnapshot();
    setSnapshot(nextSnapshot);
  }

  async function handleLanguageChange(nextLanguage: AppLanguage) {
    await runAction(`language-${nextLanguage}`, async () => {
      await window.servicePilot.settings.setLanguage(nextLanguage);
    });
  }

  function handleOpenSettings() {
    setActiveNav('settings');
  }

  async function handlePickMavenSettingsFile() {
    const picked = await window.servicePilot.dialog.pickFile(settingsForm.mavenSettingsFile || undefined, [
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
    const picked = await window.servicePilot.dialog.pickDirectory(settingsForm.mavenLocalRepository || undefined);
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
    const projectDir = await window.servicePilot.dialog.pickDirectory(defaultPath);
    if (!projectDir) {
      return;
    }
    await runAction('import-idea-maven', async () => {
      await window.servicePilot.settings.importIdeaMavenConfig(projectDir);
      setFeedback({
        message: copy.ideaConfigImported,
        tone: 'success'
      });
    });
  }

  async function handleScanImport() {
    const defaultPath = snapshot.services[0]?.workingDir || undefined;
    const projectDir = await window.servicePilot.dialog.pickDirectory(defaultPath);
    if (!projectDir) {
      return;
    }

    setScanLoading(true);
    setScanResults([]);
    setScanSelected(new Set());

    try {
      // 先尝试扫描 Spring Boot 服务
      const result = await window.servicePilot.services.scanSpring(projectDir);

      if (result.services.length > 0) {
        // 扫描到 Spring Boot 服务，显示列表让用户选择
        setScanResults(result.services);
        setScanSelected(new Set(result.services.map((s) => s.workingDir)));
        setScanModalOpen(true);
      } else {
        // 没扫描到 Spring Boot 服务，尝试检测前端项目
        const detected = await window.servicePilot.services.detectProject(projectDir);

        if (detected.serviceKind === 'vue' || detected.serviceKind === 'rust') {
          // 是前端项目，直接导入
          await runAction('import-project', async () => {
            const service = await window.servicePilot.services.importProject(projectDir);
            setSelectedLogServiceId(service.id);
            setFeedback({
              message: copy.servicesImported(1),
              tone: 'success'
            });
          });
        } else {
          // 都不是，打开表单让用户手动填写
          setServiceForm({
            ...buildServiceForm(),
            workingDir: projectDir
          });
        }
      }
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : copy.scanFailed,
        tone: 'error'
      });
    } finally {
      setScanLoading(false);
    }
  }

  function handleToggleScanSelect(workingDir: string) {
    setScanSelected((current) => {
      const next = new Set(current);
      if (next.has(workingDir)) {
        next.delete(workingDir);
      } else {
        next.add(workingDir);
      }
      return next;
    });
  }

  function handleToggleSelectAll() {
    if (scanSelected.size === scanResults.length) {
      setScanSelected(new Set());
    } else {
      setScanSelected(new Set(scanResults.map((s) => s.workingDir)));
    }
  }

  function handleToggleServiceSelected(serviceId: string, checked: boolean) {
    setSelectedServiceIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(serviceId);
      } else {
        next.delete(serviceId);
      }
      return next;
    });
  }

  function handleToggleFilteredServices(checked: boolean) {
    setSelectedServiceIds(checked ? new Set(filteredServices.map((service) => service.id)) : new Set());
  }

  async function handleBatchImportSelected() {
    const items: BatchImportItem[] = scanResults
      .filter((s) => scanSelected.has(s.workingDir))
      .map((s) => ({ name: s.name, workingDir: s.workingDir }));

    if (!items.length) {
      return;
    }

    const assignGroupIds = [...scanGroupIds];

    await runAction('batch-import', async () => {
      const imported = await window.servicePilot.services.batchImport(items);

      if (imported.length && assignGroupIds.length) {
        await window.servicePilot.groups.addServicesToGroups(imported.map((s) => s.id), assignGroupIds);
      }

      setScanModalOpen(false);
      setScanResults([]);
      setScanSelected(new Set());
      setScanGroupIds([]);
      if (imported.length) {
        setSelectedLogServiceId(imported[0].id);
      }
      const failed = items.length - imported.length;
      if (failed > 0) {
        setFeedback({
          message: copy.servicesImported(imported.length) + `，${failed} 个导入失败`,
          tone: imported.length > 0 ? 'success' : 'error'
        });
      } else {
        setFeedback({
          message: copy.servicesImported(imported.length),
          tone: 'success'
        });
      }
    });
  }

  async function handleSaveSettings() {
    await runAction('save-settings', async () => {
      const next = {
        ...snapshot.settings,
        mavenSettingsFile: settingsForm.mavenSettingsFile.trim(),
        mavenLocalRepository: settingsForm.mavenLocalRepository.trim(),
        clearLogsOnRestart: settingsForm.clearLogsOnRestart,
        resumeServicesOnLaunch: settingsForm.resumeServicesOnLaunch
      };
      await window.servicePilot.settings.save(next);
      // 用保存后的值刷新表单（去掉首尾空格）
      setSettingsForm(buildSettingsForm(next));
      setFeedback({
        message: copy.settingsSaved,
        tone: 'success'
      });
    });
  }

  async function handleInstallUpdate() {
    if (!updateInfo) {
      return;
    }
    setUpdatePromptOpen(true);
  }

  async function confirmInstallUpdate() {
    if (!updateInfo) {
      return;
    }
    setUpdatePromptOpen(true);
    setUpdateProgress({ phase: 'downloading', downloaded: 0, total: null });
    try {
      setBusyKey('install-update');
      setFeedback(null);
      await window.servicePilot.app.installUpdate();
    } catch (error) {
      setUpdateProgress(null);
      setUpdatePromptOpen(false);
      setFeedback({
        message: getActionErrorMessage(error, copy.actionFailed),
        tone: 'error'
      });
    } finally {
      setBusyKey('');
    }
  }

  async function handlePickDirectory() {
    if (!serviceForm) {
      return;
    }
    const picked = await window.servicePilot.dialog.pickDirectory(serviceForm.workingDir || undefined);
    if (!picked) {
      return;
    }

    try {
      const detected = await window.servicePilot.services.detectProject(picked);
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

        if (detected.serviceKind === 'rust') {
          return {
            ...current,
            name: shouldUseDetectedName ? detected.name : current.name,
            serviceKind: 'rust',
            launchType: 'cargo-run',
            workingDir: picked,
            command: 'cargo',
            mainClass: '',
            classpath: '',
            jvmArgsText: '',
            profilesText: '',
            frontendScript: 'dev',
            url: '',
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
        const service = await window.servicePilot.services.importProject(serviceForm.workingDir.trim());
        if (serviceForm.groupIds.length > 0) {
          await window.servicePilot.groups.setServiceMembership(service.id, serviceForm.groupIds);
        }

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
      const saved = await window.servicePilot.services.save(payload);
      await window.servicePilot.groups.setServiceMembership(saved.id, serviceForm.groupIds);

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
      const saved = await window.servicePilot.groups.save(payload);
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
    await runAction(`service-groups-${serviceGroupForm.serviceId}`, async () => {
      await window.servicePilot.groups.setServiceMembership(serviceGroupForm.serviceId, serviceGroupForm.groupIds);
      setServiceGroupForm(null);
    });
  }

  async function handleMoveGroup(groupId: string, targetIndex: number) {
    await runAction(`move-group-${groupId}-${targetIndex}`, () => window.servicePilot.groups.move(groupId, targetIndex));
  }

  async function handleBatchStart() {
    const targets = batchScopeServices.filter((service) => !['running', 'starting', 'stopping'].includes(getRuntime(snapshot, service.id).status));
    if (!targets.length) {
      return;
    }
    await runAction('batch-start', async () => {
      clearServiceLogsForLaunch(targets.map((service) => service.id));
      await Promise.allSettled(targets.map((service) => window.servicePilot.services.start(service.id)));
    });
  }

  async function handleBatchStop() {
    const targets = batchScopeServices.filter((service) => {
      const status = getRuntime(snapshot, service.id).status;
      return status === 'running' || status === 'starting' || status === 'stopping';
    });
    if (!targets.length) {
      return;
    }
    await runAction('batch-stop', async () => {
      for (const service of targets) {
        await window.servicePilot.services.stop(service.id);
      }
    });
  }

  function handleRestartService(serviceId: string) {
    void runAction(`restart-${serviceId}`, async () => {
      clearServiceLogsForLaunch([serviceId]);
      await window.servicePilot.services.restart(serviceId);
    });
  }

  function clearServiceLogsForLaunch(serviceIds: string[]) {
    if (!(snapshot.settings.clearLogsOnRestart ?? true) || !serviceIds.length) {
      return;
    }

    setLogsByService((current) => {
      const next = { ...current };
      const selectedId = selectedLogServiceIdRef.current;
      for (const serviceId of serviceIds) {
        if (serviceId === selectedId) {
          next[serviceId] = [];
        } else {
          delete next[serviceId];
        }
      }
      return next;
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

    void window.servicePilot.window.startDrag();
  };

  const handleWindowTitleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (isWindowDragBlocked(event.target)) {
      return;
    }

    void window.servicePilot.window.toggleMaximize();
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
            <img alt="" src={servicePilotLogo} />
          </div>
          <div className="pilot-brand__copy">
            <h1>{copy.appName}</h1>
            <div
              className="pilot-brand__version-row"
              data-no-window-drag
              onDoubleClick={blockWindowControlDrag}
              onMouseDown={blockWindowControlDrag}
            >
              <span className="pilot-brand__version">v{appVersion}</span>
              {updateInfo && (
                <button
                  aria-label={copy.installUpdate}
                  className="pilot-brand__update-button pilot-brand__update-button--available"
                  disabled={busyKey === 'install-update'}
                  onClick={() => void handleInstallUpdate()}
                  onDoubleClick={blockWindowControlDrag}
                  onMouseDown={blockWindowControlDrag}
                  title={copy.updateAvailable}
                  type="button"
                >
                  <AppIcon icon="arrowUp" size={14} />
                </button>
              )}
            </div>
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
              onClick={() => void window.servicePilot.window.minimize()}
              title={language === 'zh-CN' ? '最小化' : 'Minimize'}
              type="button"
            >
              <AppIcon icon="minimize" size={15} />
            </button>
            <button
              aria-label="Maximize or restore window"
              className="pilot-window-control"
              data-no-window-drag
              onClick={() => void window.servicePilot.window.toggleMaximize()}
              title={language === 'zh-CN' ? '最大化/还原' : 'Maximize / Restore'}
              type="button"
            >
              <AppIcon icon="maximize" size={14} />
            </button>
            <button
              aria-label="Close window"
              className="pilot-window-control pilot-window-control--close"
              data-no-window-drag
              onClick={handleCloseAttempt}
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
          {!isReady ? (
            <div className="pilot-loading">
              <div className="pilot-loading__spinner" />
            </div>
          ) : activeNav === 'groups' ? (
            <section className="pilot-surface pilot-surface--groups">
              <section className="pilot-group-hero">
                <div>
                  <h2>{groupUi.overviewTitle}</h2>
                  <p>{groupUi.overviewDesc}</p>
                </div>
                <ActionButton compact className="action-button--add-service" icon="addService" kind="primary" label={groupUi.newGroup} onClick={() => setGroupForm(buildGroupForm())} />
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
                                          async () => {
                                            if (hasRunningService) {
                                              await window.servicePilot.groups.stop(group.id);
                                              return;
                                            }

                                            clearServiceLogsForLaunch(group.serviceIds);
                                            await window.servicePilot.groups.start(group.id);
                                          }
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
                        <ActionButton compact className="action-button--add-service" icon="addService" kind="primary" label={groupUi.newGroup} onClick={() => setGroupForm(buildGroupForm())} />
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

                  <label className="toggle-field field--full">
                    <input
                      type="checkbox"
                      checked={settingsForm.resumeServicesOnLaunch}
                      onChange={(event) =>
                        setSettingsForm({
                          ...settingsForm,
                          resumeServicesOnLaunch: event.target.checked
                        })
                      }
                    />
                    <span>
                      <strong>{copy.resumeServicesOnLaunch}</strong>
                      <small>{copy.resumeServicesOnLaunchHint}</small>
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
            <section className={`pilot-surface pilot-surface--no-gap ${logsExpanded ? 'pilot-surface--logs-expanded' : 'pilot-surface--logs-collapsed'}`}>
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
                      className="action-button action-button--success action-button--compact"
                      disabled={busyKey !== '' || batchStartTargetCount === 0}
                      onClick={() => void handleBatchStart()}
                      type="button"
                    >
                      <AppIcon icon="batchStart" size={16} />
                      <span>{selectedVisibleServiceIds.length ? `${copy.batchStart} (${batchStartTargetCount})` : copy.batchStart}</span>
                    </button>
                    <button
                      className="action-button action-button--danger action-button--compact"
                      disabled={busyKey !== '' || batchStopTargetCount === 0}
                      onClick={() => void handleBatchStop()}
                      type="button"
                    >
                      <AppIcon icon="stop" size={16} />
                      <span>{selectedVisibleServiceIds.length ? `${copy.batchStop} (${batchStopTargetCount})` : copy.batchStop}</span>
                    </button>
                  </div>
                  <ActionButton compact className="action-button--add-service" icon="addService" kind="primary" label={copy.addService} onClick={() => void handleScanImport()} />
                </div>
              </div>

              <section className="pilot-table-card">
                <div className="pilot-table-card__body">
                  <header className="pilot-table-card__header">
                    <label className="pilot-table-card__select-head" title={copy.selectAll}>
                      <input
                        aria-label={copy.selectAll}
                        checked={allVisibleServicesSelected}
                        disabled={!filteredServices.length}
                        onChange={(event) => handleToggleFilteredServices(event.target.checked)}
                        type="checkbox"
                      />
                    </label>
                    <span>{copy.serviceName}</span>
                    <span>{copy.group}</span>
                    <span>{copy.status}</span>
                    <span>{copy.port}</span>
                    <span>{copy.runtime}</span>
                    <span>{copy.lastStart}</span>
                    <span className="pilot-table-card__actions-head"></span>
                  </header>

                  {filteredServices.map((service, index) => {
                    const runtime = getRuntime(snapshot, service.id);
                    const tone = getStatusTone(runtime.status);
                    const serviceGroups = getServiceGroups(snapshot.groups, service.id);
                    const servicePort = resolveRuntimePort(service, runtime);
                    const serviceCanStop = canStopRuntime(runtime.status);
                    const isServiceSelected = selectedServiceIds.has(service.id);

                    return (
                      <article
                        className={`service-row service-row--${tone} ${isServiceSelected ? 'service-row--selected' : ''} ${selectedLogServiceId === service.id ? 'service-row--active' : ''}`}
                        key={service.id}
                        onClick={() => setSelectedLogServiceId(service.id)}
                      >
                        <label
                          className="service-row__select"
                          onClick={(event) => event.stopPropagation()}
                          title={service.name}
                        >
                          <input
                            aria-label={`Select ${service.name}`}
                            checked={isServiceSelected}
                            onChange={(event) => handleToggleServiceSelected(service.id, event.target.checked)}
                            type="checkbox"
                          />
                        </label>
                        <div className="service-row__name">
                          <ServiceTechIcon index={index} service={service} />
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
                          <span className="service-row__port-text">{servicePort ?? '--'}</span>
                        </div>

                        <ServiceRuntimeDuration runtime={runtime} />
                        <div className="service-row__last">{formatLastStart(runtime.startedAt, language)}</div>

                        <div className="service-row__actions">
                          {serviceCanStop ? (
                            <>
                              {runtime.status === 'running' && (
                                <ActionButton
                                  compact
                                  className="service-row__restart-button"
                                  disabled={busyKey !== ''}
                                  iconOnly
                                  icon="restart"
                                  kind="default"
                                  label={copy.restart}
                                  onClick={() => handleRestartService(service.id)}
                                />
                              )}
                              <ActionButton
                                compact
                                disabled={isStopActionDisabled(busyKey, service.id, runtime.status)}
                                iconOnly
                                icon="stop"
                                kind="danger"
                                label={copy.stop}
                                onClick={() => {
                                  void runAction(`stop-${service.id}`, () => window.servicePilot.services.stop(service.id));
                                }}
                              />
                            </>
                          ) : (
                            <ActionButton
                              compact
                              disabled={busyKey !== ''}
                              iconOnly
                              icon="start"
                              kind="success"
                              label={copy.start}
                              onClick={() => {
                                void runAction(`start-${service.id}`, async () => {
                                  clearServiceLogsForLaunch([service.id]);
                                  await window.servicePilot.services.start(service.id);
                                });
                              }}
                            />
                          )}
                          <div className="service-row__menu-wrap">
                            <button
                              aria-label={copy.more}
                              className="action-button action-button--default action-button--compact action-button--icon service-row__more-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setRowMenuServiceId((current) => (current === service.id ? '' : service.id));
                              }}
                              title={copy.more}
                              type="button"
                            >
                              <AppIcon icon="more" size={16} />
                            </button>
                            {rowMenuServiceId === service.id && (
                                  <div className="floating-menu floating-menu--row" onClick={(event) => event.stopPropagation()}>
                                    <button
                                      className="floating-menu__item"
                                      onClick={() => {
                                        setRowMenuServiceId('');
                                        setServiceForm(buildServiceForm(service, snapshot.groups));
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
                                      {language === 'zh-CN' ? '分组' : 'Groups'}
                                    </button>
                                    <button
                                      className="floating-menu__item floating-menu__item--danger"
                                      onClick={(event) => {
                                        event.stopPropagation();
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
                        className="action-button--add-service"
                        disabled={busyKey !== ''}
                        icon="addService"
                        kind="primary"
                        label={copy.addService}
                        onClick={() => void handleScanImport()}
                      />
                    </div>
                  )}
                </div>
              </section>

              <section className={`pilot-logs-card ${logsExpanded ? 'pilot-logs-card--expanded' : 'pilot-logs-card--collapsed'}`}>
                {!logsExpanded ? (
                  <button className="pilot-logs-collapsed" onClick={() => setLogsExpanded(true)} type="button">
                    <span className="pilot-logs-collapsed__main">
                      <AppIcon icon="log" size={15} />
                      <span>{copy.serviceLogs}</span>
                      {selectedLogService && <span className="pilot-logs-collapsed__service">{selectedLogService.name}</span>}
                    </span>
                    <span className="pilot-logs-collapsed__meta">
                      {language === 'zh-CN' ? '展开' : 'Open'}
                      <AppIcon icon="chevronDown" size={14} />
                    </span>
                  </button>
                ) : (
                  <>
                <div className="pilot-log-tabs-wrapper">
                <div
                  ref={logTabsRef}
                  className="pilot-log-tabs"
                  onWheel={(event) => {
                    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
                      return;
                    }
                    event.currentTarget.scrollLeft += event.deltaY;
                    event.preventDefault();
                  }}
                >
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
                <div className="pilot-log-tabs-more">
                  <button
                    aria-label={language === 'zh-CN' ? '收起日志' : 'Collapse logs'}
                    className="pilot-log-tabs__collapse"
                    onClick={() => setLogsExpanded(false)}
                    type="button"
                  >
                    <AppIcon icon="chevronDown" size={14} />
                  </button>
                </div>
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
                          }}
                        />
                        <span>{copy.autoScroll}</span>
                      </label>

                      <ActionButton
                        compact
                        className="pilot-log-clear-button"
                        icon="clearLogs"
                        kind="default"
                        label={copy.clearLogs}
                        onClick={() => {
                          const serviceId = selectedLogServiceId;
                          void runAction(`clear-log-${serviceId}`, async () => {
                            await window.servicePilot.logs.clear(serviceId);
                            setLogsByService((current) => ({ ...current, [serviceId]: [] }));
                          });
                        }}
                      />
                    </div>
                  </div>
                </header>

                <div className="pilot-logs-card__body">
                  <div className="pilot-terminal">
                    {logSearchHintText && (
                      <div className="pilot-log-search-summary">
                        <span>{logSearchHintText}</span>
                      </div>
                    )}
                    <VirtualLogList
                      items={levelFilteredLogEntries}
                      searchQuery={deferredLogQuery}
                      activeSearchMatchId={activeLogMatchEntryId}
                      autoScroll={autoScroll}
                      emptyTitle={copy.noLogs}
                    />
                  </div>
                </div>
                  </>
                )}
              </section>
            </section>
          )}
        </main>
      </div>

      {serviceForm && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="modal-title">{serviceForm.id ? copy.updateService : copy.createService}</div>
                <div className="modal-desc">{copy.serviceModalDesc}</div>
              </div>
              <button className="modal-close" aria-label={copy.cancel} onClick={() => setServiceForm(null)} type="button">
                ×
              </button>
            </div>

            <div className="modal-body">
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

              <div className="field field--full">
                <span>{copy.group}</span>
                <div className="service-groups-select">
                  {snapshot.groups.length === 0 ? (
                    <span className="service-groups-select__empty">
                      {language === 'zh-CN' ? '暂无分组' : 'No groups available'}
                    </span>
                  ) : (
                    snapshot.groups.map((group) => {
                      const checked = serviceForm.groupIds.includes(group.id);
                      return (
                        <label className={`service-groups-select__item ${checked ? 'service-groups-select__item--checked' : ''}`} key={group.id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              setServiceForm({
                                ...serviceForm,
                                groupIds: event.target.checked
                                  ? [...serviceForm.groupIds, group.id]
                                  : serviceForm.groupIds.filter((id) => id !== group.id)
                              });
                            }}
                          />
                          <span>{group.name}</span>
                          <span className="service-groups-select__count">
                            {group.serviceIds.length}
                          </span>
                        </label>
                      );
                    })
                  )}
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
            </div>

            <div className="modal-footer">
              <ModalButton label={copy.cancel} onClick={() => setServiceForm(null)} />
              <ModalButton kind="primary" label={copy.saveService} onClick={() => void handleSaveService()} />
            </div>
          </div>
        </div>
      )}

      {deleteServiceTarget && (
        <div className="modal-overlay">
          <div className="modal confirm">
            <div className="modal-header">
              <div>
                <div className="modal-title">{copy.delete}</div>
                <div className="modal-desc">{copy.deleteConfirm(deleteServiceTarget.name)}</div>
              </div>
              <button className="modal-close" aria-label={copy.cancel} onClick={() => setDeleteServiceTarget(null)} type="button">
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-confirm__body">
                <div className="modal-confirm__service">{deleteServiceTarget.name}</div>
                <div className="modal-confirm__path">{deleteServiceTarget.workingDir}</div>
              </div>
            </div>

            <div className="modal-footer">
              <ModalButton label={copy.cancel} onClick={() => setDeleteServiceTarget(null)} />
              <ModalButton
                disabled={busyKey === `delete-${deleteServiceTarget.id}`}
                kind="danger"
                label={copy.delete}
                onClick={() => {
                  const target = deleteServiceTarget;
                  setDeleteServiceTarget(null);
                  void runAction(`delete-${target.id}`, async () => {
                    await window.servicePilot.services.delete(target.id);
                    await refreshSnapshot();
                    // 清理已删除服务的日志缓存，释放内存
                    setLogsByService((current) => {
                      if (!current[target.id]) {
                        return current;
                      }
                      const next = { ...current };
                      delete next[target.id];
                      return next;
                    });
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

      {scanModalOpen && (
        <div className="modal-overlay">
          <div className="modal large">
            <div className="modal-header">
              <div>
                <div className="modal-title">{copy.scanImport}</div>
                <div className="modal-desc">
                  {scanLoading
                    ? copy.scanningServices
                    : scanResults.length > 0
                      ? copy.detectedServices(scanResults.length)
                      : copy.noServicesDetected}
                </div>
              </div>
              <button className="modal-close" aria-label={copy.cancel} onClick={() => { setScanModalOpen(false); setScanResults([]); setScanSelected(new Set()); setScanGroupIds([]); }} type="button">
                ×
              </button>
            </div>

            <div className="modal-body modal-body--scan">
              {scanLoading ? (
                <div className="pilot-loading">
                  <div className="pilot-loading__spinner" />
                </div>
              ) : scanResults.length > 0 ? (
                <>
                  <div className="scan-toolbar">
                    <button
                      className="action-button action-button--default action-button--compact"
                      onClick={handleToggleSelectAll}
                      type="button"
                    >
                      {copy.selectAll} ({scanSelected.size}/{scanResults.length})
                    </button>
                  </div>
                  {snapshot.groups.length > 0 && (
                    <div className="scan-group-select">
                      <span className="scan-group-select__label">{copy.group}</span>
                      {snapshot.groups.map((group) => {
                        const checked = scanGroupIds.includes(group.id);
                        return (
                          <label className={`scan-group-select__item ${checked ? 'scan-group-select__item--checked' : ''}`} key={group.id}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                setScanGroupIds(
                                  event.target.checked
                                    ? [...scanGroupIds, group.id]
                                    : scanGroupIds.filter((id) => id !== group.id)
                                );
                              }}
                            />
                            <span>{group.name || '—'}</span>
                            <span className="scan-group-select__count">{group.serviceIds.length}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <div className="scan-list">
                    {scanResults.map((service) => (
                      <label className={`scan-row ${scanSelected.has(service.workingDir) ? 'scan-row--checked' : ''}`} key={service.workingDir}>
                        <input
                          type="checkbox"
                          checked={scanSelected.has(service.workingDir)}
                          onChange={() => handleToggleScanSelect(service.workingDir)}
                        />
                        <span className="scan-row__name">{service.name}</span>
                        {service.port && <span className="scan-row__port">:{service.port}</span>}
                        <span className="scan-row__dir" title={service.workingDir}>{service.workingDir}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <div className="pilot-empty-state pilot-empty-state--compact">
                  <div>{copy.noServicesDetected}</div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <ModalButton label={copy.cancel} onClick={() => { setScanModalOpen(false); setScanResults([]); setScanSelected(new Set()); setScanGroupIds([]); }} />
              {scanResults.length > 0 && (
                <ModalButton
                  disabled={busyKey !== '' || scanSelected.size === 0}
                  icon="arrowDown"
                  kind="primary"
                  label={`${copy.importSelected} (${scanSelected.size})`}
                  onClick={() => void handleBatchImportSelected()}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {exitConfirmOpen && (
        <div className="modal-overlay">
          <div className="modal confirm">
            <div className="modal-header">
              <div>
                <div className="modal-title">{language === 'zh-CN' ? '确认退出' : 'Confirm Exit'}</div>
                <div className="modal-desc">{copy.quitConfirm}</div>
              </div>
              <button className="modal-close" aria-label={copy.cancel} onClick={() => setExitConfirmOpen(false)} type="button">
                ×
              </button>
            </div>
            <div className="modal-footer">
              <ModalButton label={copy.cancel} onClick={() => setExitConfirmOpen(false)} />
              <ModalButton
                kind="danger"
                label={language === 'zh-CN' ? '退出' : 'Exit'}
                onClick={() => void window.servicePilot.app.exit()}
              />
            </div>
          </div>
        </div>
      )}

      {updateInfo && updatePromptOpen && (
        <div className="pilot-update-overlay">
        <div
          aria-busy={isInstallingUpdate}
          aria-modal="true"
          className={`pilot-update-card ${isInstallingUpdate ? 'pilot-update-card--busy' : ''}`}
          role="dialog"
        >
          <div className="pilot-update-card__icon" aria-hidden="true">
            <AppIcon icon={isInstallingUpdate ? 'starting' : 'arrowUp'} size={17} />
          </div>
          <div className="pilot-update-card__content">
            <div className="pilot-update-card__title">
              {updateProgress?.phase === 'installing'
                ? copy.updateInstallingStatus
                : isInstallingUpdate
                  ? copy.updateDownloading
                  : copy.updateReadyTitle}
            </div>
            {isInstallingUpdate && <div className="pilot-update-card__desc">{updateStatusText}</div>}
            {isInstallingUpdate && (
              <div
                aria-label={updateStatusText}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={updateDownloadPercent ?? undefined}
                className={`pilot-update-card__progress ${updateDownloadPercent === null ? 'pilot-update-card__progress--indeterminate' : ''}`}
                role="progressbar"
              >
                <span style={{ width: `${updateDownloadPercent ?? 32}%` }} />
              </div>
            )}
          </div>
          {!isInstallingUpdate && (
            <div className="pilot-update-card__actions">
              <button className="pilot-update-card__secondary" onClick={() => setUpdatePromptOpen(false)} type="button">
                {copy.updateLater}
              </button>
              <button className="pilot-update-card__primary" onClick={() => void confirmInstallUpdate()} type="button">
                {copy.installUpdate}
              </button>
            </div>
          )}
        </div>
        </div>
      )}

      {groupForm && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="modal-title">{groupForm.id ? copy.updateGroup : copy.createGroup}</div>
                <div className="modal-desc">{copy.groupModalDesc}</div>
              </div>
              <button className="modal-close" aria-label={copy.cancel} onClick={() => setGroupForm(null)} type="button">
                ×
              </button>
            </div>

            <div className="modal-body">
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
            </div>

            <div className="modal-footer modal-footer--split">
              {groupForm.id && (
                <ModalButton
                  kind="danger"
                  label={copy.deleteGroup}
                  onClick={() => {
                    void runAction(`delete-group-${groupForm.id}`, async () => {
                      await window.servicePilot.groups.delete(groupForm.id!);
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
              <ModalButton label={copy.cancel} onClick={() => setGroupForm(null)} />
              <ModalButton kind="primary" label={copy.saveGroup} onClick={() => void handleSaveGroup()} />
            </div>
          </div>
        </div>
      )}

      {serviceGroupForm && (
        <div className="modal-overlay">
          <div className="modal large">
            <div className="modal-header">
              <div>
                <div className="modal-title">{groupUi.manageMembership}</div>
                <div className="modal-desc">{groupUi.membershipDesc}</div>
              </div>
              <button className="modal-close" aria-label={copy.cancel} onClick={() => setServiceGroupForm(null)} type="button">
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="membership-panel">
              <div className="membership-context">
                <AppIcon icon="menuGroup" size={16} />
                <div className="membership-context__copy">
                  <strong>{snapshot.services.find((service) => service.id === serviceGroupForm.serviceId)?.name ?? '--'}</strong>
                  <span>{language === 'zh-CN' ? '设置所属分组' : 'Set group membership'}</span>
                </div>
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
                <span
                  title={snapshot.groups
                    .filter((group) => serviceGroupForm.groupIds.includes(group.id))
                    .map((group) => group.name)
                    .join(', ')}
                >
                  {serviceGroupForm.groupIds.length
                    ? language === 'zh-CN'
                      ? `已选择 ${serviceGroupForm.groupIds.length} 个分组`
                      : `${serviceGroupForm.groupIds.length} ${serviceGroupForm.groupIds.length === 1 ? 'group' : 'groups'} selected`
                    : language === 'zh-CN'
                      ? '未选择分组'
                      : 'No groups selected'}
                </span>
              </div>
              </div>
            </div>

            <div className="modal-footer modal-footer--membership">
              <ModalButton label={copy.cancel} onClick={() => setServiceGroupForm(null)} />
              <ModalButton kind="primary" label={groupUi.saveMembership} onClick={() => void handleSaveServiceGroups()} />
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
