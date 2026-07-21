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

    await api.app.getSnapshot();
    await api.services.save(input);
    await api.services.start('svc-1');
    await api.services.stop('svc-1');
    await api.services.restart('svc-1');
    await api.groups.setServiceMembership('svc-1', ['group-1']);
    await api.logs.clear('svc-1');
    await api.settings.save({
      language: 'en-US',
      mavenSettingsFile: 'D:\\settings.xml',
      mavenLocalRepository: 'D:\\repo',
      clearLogsOnRestart: false,
      resumeServicesOnLaunch: true
    });

    expect(invoke).toHaveBeenNthCalledWith(1, 'app_get_snapshot', undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, 'service_save', { input });
    expect(invoke).toHaveBeenNthCalledWith(3, 'service_start', { serviceId: 'svc-1' });
    expect(invoke).toHaveBeenNthCalledWith(4, 'service_stop', { serviceId: 'svc-1' });
    expect(invoke).toHaveBeenNthCalledWith(5, 'service_restart', { serviceId: 'svc-1' });
    expect(invoke).toHaveBeenNthCalledWith(6, 'group_set_service_membership', {
      serviceId: 'svc-1',
      groupIds: ['group-1']
    });
    expect(invoke).toHaveBeenNthCalledWith(7, 'log_clear', { serviceId: 'svc-1' });
    expect(invoke).toHaveBeenNthCalledWith(8, 'settings_save', {
      settings: {
        language: 'en-US',
        mavenSettingsFile: 'D:\\settings.xml',
        mavenLocalRepository: 'D:\\repo',
        clearLogsOnRestart: false,
        resumeServicesOnLaunch: true
      }
    });
  });

  it('wraps string errors from Tauri invoke', async () => {
    const { invoke } = mockTauri();
    invoke.mockRejectedValue('service not found');

    await expect(createServicePilotApi().services.start('missing')).rejects.toThrow('service not found');
  });

  it('wraps object message errors from Tauri invoke', async () => {
    const { invoke } = mockTauri();
    invoke.mockRejectedValue({ message: 'invalid command' });

    await expect(createServicePilotApi().services.start('svc-1')).rejects.toThrow('invalid command');
  });

  it('serializes plain object errors from Tauri invoke', async () => {
    const { invoke } = mockTauri();
    invoke.mockRejectedValue({ code: 'E_BAD_STATE' });

    await expect(createServicePilotApi().services.start('svc-1')).rejects.toThrow('{"code":"E_BAD_STATE"}');
  });

  it('uses fallback errors when Tauri invoke returns an empty object', async () => {
    const { invoke } = mockTauri();
    invoke.mockRejectedValue({});

    await expect(createServicePilotApi().services.start('svc-1')).rejects.toThrow('Tauri command "service_start" failed.');
  });

  it('throws a helpful error outside the Tauri runtime', async () => {
    await expect(createServicePilotApi().app.getSnapshot()).rejects.toThrow('Tauri runtime is not available');
  });

  it('unsubscribes listeners that resolve after disposal', async () => {
    const { listen } = mockTauri();
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);

    const dispose = createServicePilotApi().events.onSnapshot(() => undefined);
    dispose();

    expect(listen).toHaveBeenCalledWith('snapshot:update', expect.any(Function));
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });
});
