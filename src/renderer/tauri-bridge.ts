import type {
  AppSettings,
  AppSnapshot,
  AppUpdateInfo,
  AppUpdateProgress,
  BatchImportItem,
  LogEntry,
  ProjectDetection,
  SaveGroupInput,
  SaveServiceInput,
  ScanResult,
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

  void listen<T>(event, listener)
    .then((handler) => {
      if (disposed) {
        handler();
        return;
      }
      unlisten = handler;
    })
    .catch((error: unknown) => {
      if (!disposed) {
        console.warn(extractErrorMessage(error, `Tauri event "${event}" listener is not available.`));
      }
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
    app: {
      getVersion: () => invoke<string>('app_get_version'),
      checkUpdate: () => invoke<AppUpdateInfo | null>('app_check_update'),
      installUpdate: () => invoke<void>('app_install_update'),
      getSnapshot: () => invoke<AppSnapshot>('app_get_snapshot'),
      showWindow: () => invoke<void>('app_show_window'),
      exit: () => invoke<void>('app_exit')
    },
    services: {
      list: () => invoke<ServiceConfig[]>('service_list'),
      detectProject: (projectDir) => invoke<ProjectDetection>('service_detect_project', { projectDir }),
      importProject: (projectDir) => invoke<ServiceConfig>('service_import_project', { projectDir }),
      importIdeaProject: (projectDir) => invoke<ServiceConfig>('service_import_idea_project', { projectDir }),
      scanSpring: (rootDir) => invoke<ScanResult>('service_scan_spring', { rootDir }),
      batchImport: (items) => invoke<ServiceConfig[]>('service_batch_import', { items: items as BatchImportItem[] }),
      save: (input) => invoke<ServiceConfig>('service_save', { input: input as SaveServiceInput }),
      delete: (serviceId) => invoke<void>('service_delete', { serviceId }),
      start: (serviceId) => invoke<void>('service_start', { serviceId }),
      stop: (serviceId) => invoke<void>('service_stop', { serviceId }),
      restart: (serviceId) => invoke<void>('service_restart', { serviceId }),
      openUrl: (serviceId) => invoke<void>('service_open_url', { serviceId })
    },
    groups: {
      list: () => invoke<ServiceGroup[]>('group_list'),
      save: (input) => invoke<ServiceGroup>('group_save', { input: input as SaveGroupInput }),
      delete: (groupId) => invoke<void>('group_delete', { groupId }),
      move: (groupId, targetIndex) => invoke<void>('group_move', { groupId, targetIndex }),
      start: (groupId) => invoke<void>('group_start', { groupId }),
      stop: (groupId) => invoke<void>('group_stop', { groupId }),
      setServiceMembership: (serviceId, groupIds) => invoke<void>('group_set_service_membership', { serviceId, groupIds }),
      addServicesToGroups: (serviceIds, groupIds) => invoke<void>('group_add_services_to_groups', { serviceIds, groupIds })
    },
    logs: {
      history: (serviceId) => invoke<LogEntry[]>('log_history', { serviceId }),
      clear: (serviceId) => invoke<void>('log_clear', { serviceId })
    },
    settings: {
      setLanguage: (language) => invoke<void>('settings_set_language', { language }),
      save: (settings) => invoke<void>('settings_save', { settings: settings as AppSettings }),
      importIdeaMavenConfig: (projectDir) => invoke<AppSettings>('settings_import_idea_maven_config', { projectDir }),
      importState: () => invoke<void>('settings_import_state'),
      exportState: () => invoke<void>('settings_export_state')
    },
    dialog: {
      pickDirectory: (defaultPath) => invoke<string | null>('dialog_pick_directory', { defaultPath }),
      pickFile: (defaultPath, filters) => invoke<string | null>('dialog_pick_file', { defaultPath, filters })
    },
    window: {
      minimize: () => invoke<void>('window_minimize'),
      toggleMaximize: () => invoke<void>('window_toggle_maximize'),
      startDrag: () => invoke<void>('window_start_drag'),
      close: () => invoke<void>('window_close'),
      onCloseRequested: (listener) => wrapListener<void>('close-requested', () => listener())
    },
    events: {
      onSnapshot: (listener) => wrapListener<AppSnapshot>('snapshot:update', listener),
      onLogBatch: (listener) => wrapListener<LogEntry[]>('log:batch', listener),
      onUpdateProgress: (listener) => wrapListener<AppUpdateProgress>('update:progress', listener)
    }
  };
}
