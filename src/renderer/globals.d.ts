import type { AppSnapshot, LogEntry, ServicePilotApi } from '../shared/models';

type TauriUnlisten = () => void;

interface TauriEventPayload<T> {
  payload: T;
}

interface TauriEventApi {
  listen<T>(event: string, handler: (event: TauriEventPayload<T>) => void): Promise<TauriUnlisten>;
}

interface TauriCoreApi {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

declare global {
  interface Window {
    servicePilot: ServicePilotApi;
    __TAURI__?: {
      core: TauriCoreApi;
      event: TauriEventApi;
    };
  }

  interface WindowEventMap {
    'service-pilot:snapshot': CustomEvent<AppSnapshot>;
    'service-pilot:log': CustomEvent<LogEntry>;
  }
}

export {};
