import type {
  AppSettings,
  AppSnapshot,
  LogEntry,
  ProjectDetection,
  SaveGroupInput,
  SaveServiceInput,
  ServiceConfig,
  ServiceGroup,
  ServicePilotApi
} from '../shared/models';

function getTauri() {
  const tauri = window.__TAURI__;
  if (!tauri) {
    throw new Error('Tauri runtime is not available. Please launch ServicePilot with `npm run dev` or `npm run build`.');
  }
  return tauri;
}

async function listen<T>(event: string, listener: (payload: T) => void): Promise<() => void> {
  const tauri = getTauri();
  return tauri.event.listen<T>(event, ({ payload }) => {
    listener(payload);
  });
}

function wrapListener<T>(event: string, listener: (payload: T) => void): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;

  void listen<T>(event, listener).then((handler) => {
    if (disposed) {
      handler();
      return;
    }
    unlisten = handler;
  });

  return () => {
    disposed = true;
    unlisten?.();
  };
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await getTauri().core.invoke<T>(command, args);
  } catch (error) {
    throw new Error(extractErrorMessage(error, `Tauri command "${command}" failed.`));
  }
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object') {
    const candidates = ['message', 'error', 'cause'];
    for (const key of candidates) {
      const value = Reflect.get(error, key);
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') {
        return serialized;
      }
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export function createServicePilotApi(): ServicePilotApi {
  return {
    getSnapshot: () => invoke<AppSnapshot>('get_snapshot'),
    setLanguage: (language) => invoke<void>('set_language', { language }),
    saveSettings: (settings) => invoke<void>('save_settings', { settings: settings as AppSettings }),
    listServices: () => invoke<ServiceConfig[]>('list_services'),
    listGroups: () => invoke<ServiceGroup[]>('list_groups'),
    getLogHistory: (serviceId) => invoke<LogEntry[]>('get_log_history', { serviceId }),
    pickDirectory: (defaultPath) => invoke<string | null>('pick_directory', { defaultPath }),
    pickFile: (defaultPath, filters) => invoke<string | null>('pick_file', { defaultPath, filters }),
    detectProject: (projectDir) => invoke<ProjectDetection>('detect_project', { projectDir }),
    importIdeaMavenConfig: (projectDir) => invoke<AppSettings>('import_idea_maven_config', { projectDir }),
    importProject: (projectDir) => invoke<ServiceConfig>('import_project', { projectDir }),
    quickStartProject: (projectDir) => invoke<ServiceConfig>('quick_start_project', { projectDir }),
    importIdeaProject: (projectDir) => invoke<ServiceConfig>('import_idea_project', { projectDir }),
    importState: () => invoke<void>('import_state'),
    exportState: () => invoke<void>('export_state'),
    saveService: (input) => invoke<ServiceConfig>('save_service', { input: input as SaveServiceInput }),
    deleteService: (serviceId) => invoke<void>('delete_service', { serviceId }),
    startService: (serviceId) => invoke<void>('start_service', { serviceId }),
    stopService: (serviceId) => invoke<void>('stop_service', { serviceId }),
    restartService: (serviceId) => invoke<void>('restart_service', { serviceId }),
    openServiceUrl: (serviceId) => invoke<void>('open_service_url', { serviceId }),
    saveGroup: (input) => invoke<ServiceGroup>('save_group', { input: input as SaveGroupInput }),
    deleteGroup: (groupId) => invoke<void>('delete_group', { groupId }),
    moveGroup: (groupId, targetIndex) => invoke<void>('move_group', { groupId, targetIndex }),
    startGroup: (groupId) => invoke<void>('start_group', { groupId }),
    stopGroup: (groupId) => invoke<void>('stop_group', { groupId }),
    minimizeWindow: () => invoke<void>('minimize_window'),
    toggleMaximizeWindow: () => invoke<void>('toggle_maximize_window'),
    startWindowDrag: () => invoke<void>('start_window_drag'),
    closeWindow: () => invoke<void>('close_window'),
    onSnapshot: (listener) => wrapListener<AppSnapshot>('snapshot:update', listener),
    onLogEntry: (listener) => wrapListener<LogEntry>('log:entry', listener)
  };
}
