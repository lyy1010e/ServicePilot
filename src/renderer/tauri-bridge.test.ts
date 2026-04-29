import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { SaveServiceInput } from '@shared/models';
import { createServicePilotApi } from './tauri-bridge';

function mockTauri() {
  const invoke = vi.fn();
  const listen = vi.fn();
  window.__TAURI__ = {
    core: { invoke },
    event: { listen }
  };
  return { invoke, listen };
}

describe('createServicePilotApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.__TAURI__;
  });

  it('maps core service methods to Tauri commands and argument shapes', async () => {
    const { invoke } = mockTauri();
    invoke.mockResolvedValue(undefined);
    const api = createServicePilotApi();

    const input: SaveServiceInput = {
      name: 'api',
      serviceKind: 'spring',
      launchType: 'java-main',
      workingDir: 'D:\\workspace\\api',
      command: 'java',
      args: ['--debug'],
      env: { JAVA_HOME: 'D:\\jdk' }
    };

    await api.getSnapshot();
    await api.saveService(input);
    await api.startService('svc-1');
    await api.stopService('svc-1');
    await api.restartService('svc-1');
    await api.saveSettings({
      language: 'en-US',
      mavenSettingsFile: 'D:\\settings.xml',
      mavenLocalRepository: 'D:\\repo',
      clearLogsOnRestart: false
    });

    expect(invoke).toHaveBeenNthCalledWith(1, 'get_snapshot', undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, 'save_service', { input });
    expect(invoke).toHaveBeenNthCalledWith(3, 'start_service', { serviceId: 'svc-1' });
    expect(invoke).toHaveBeenNthCalledWith(4, 'stop_service', { serviceId: 'svc-1' });
    expect(invoke).toHaveBeenNthCalledWith(5, 'restart_service', { serviceId: 'svc-1' });
    expect(invoke).toHaveBeenNthCalledWith(6, 'save_settings', {
      settings: {
        language: 'en-US',
        mavenSettingsFile: 'D:\\settings.xml',
        mavenLocalRepository: 'D:\\repo',
        clearLogsOnRestart: false
      }
    });
  });

  it('wraps string errors from Tauri invoke', async () => {
    const { invoke } = mockTauri();
    invoke.mockRejectedValue('service not found');

    await expect(createServicePilotApi().startService('missing')).rejects.toThrow('service not found');
  });

  it('wraps object message errors from Tauri invoke', async () => {
    const { invoke } = mockTauri();
    invoke.mockRejectedValue({ message: 'invalid command' });

    await expect(createServicePilotApi().startService('svc-1')).rejects.toThrow('invalid command');
  });

  it('serializes plain object errors from Tauri invoke', async () => {
    const { invoke } = mockTauri();
    invoke.mockRejectedValue({ code: 'E_BAD_STATE' });

    await expect(createServicePilotApi().startService('svc-1')).rejects.toThrow('{"code":"E_BAD_STATE"}');
  });

  it('uses fallback errors when Tauri invoke returns an empty object', async () => {
    const { invoke } = mockTauri();
    invoke.mockRejectedValue({});

    await expect(createServicePilotApi().startService('svc-1')).rejects.toThrow('Tauri command "start_service" failed.');
  });

  it('throws a helpful error outside the Tauri runtime', async () => {
    await expect(createServicePilotApi().getSnapshot()).rejects.toThrow('Tauri runtime is not available');
  });

  it('unsubscribes listeners that resolve after disposal', async () => {
    const { listen } = mockTauri();
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);

    const dispose = createServicePilotApi().onSnapshot(() => undefined);
    dispose();

    expect(listen).toHaveBeenCalledWith('snapshot:update', expect.any(Function));
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });
});
