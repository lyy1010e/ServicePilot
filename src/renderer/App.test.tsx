import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSnapshot, LogEntry, ServiceConfig, ServicePilotApi } from '@shared/models';
import { App, getLogMessage } from './App';

function springService(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    id: 'svc-1',
    name: 'Gateway',
    serviceKind: 'spring',
    launchType: 'java-main',
    workingDir: 'D:\\workspace\\gateway',
    command: 'java',
    args: [],
    env: {},
    port: 8080,
    mainClass: 'com.example.GatewayApplication',
    ...overrides
  };
}

function snapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    services: [],
    groups: [],
    runtime: {},
    settings: {
      language: 'en-US',
      mavenSettingsFile: '',
      mavenLocalRepository: '',
      clearLogsOnRestart: true
    },
    ...overrides
  };
}

function createMockApi(initialSnapshot: AppSnapshot): ServicePilotApi {
  return {
    getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
    listServices: vi.fn().mockResolvedValue(initialSnapshot.services),
    listGroups: vi.fn().mockResolvedValue(initialSnapshot.groups),
    getLogHistory: vi.fn().mockResolvedValue([] satisfies LogEntry[]),
    pickDirectory: vi.fn().mockResolvedValue(null),
    pickFile: vi.fn().mockResolvedValue(null),
    setLanguage: vi.fn().mockResolvedValue(undefined),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    detectProject: vi.fn().mockResolvedValue({
      name: 'gateway',
      serviceKind: 'spring',
      launchType: 'java-main',
      command: ''
    }),
    importIdeaMavenConfig: vi.fn().mockResolvedValue(initialSnapshot.settings),
    importProject: vi.fn().mockResolvedValue(springService()),
    importIdeaProject: vi.fn().mockResolvedValue(springService()),
    importState: vi.fn().mockResolvedValue(undefined),
    exportState: vi.fn().mockResolvedValue(undefined),
    scanSpringServices: vi.fn().mockResolvedValue({ services: [] }),
    batchImportServices: vi.fn().mockResolvedValue([springService()]),
    saveService: vi.fn().mockResolvedValue(springService()),
    deleteService: vi.fn().mockResolvedValue(undefined),
    startService: vi.fn().mockResolvedValue(undefined),
    stopService: vi.fn().mockResolvedValue(undefined),
    restartService: vi.fn().mockResolvedValue(undefined),
    openServiceUrl: vi.fn().mockResolvedValue(undefined),
    saveGroup: vi.fn().mockResolvedValue({ id: 'group-1', name: 'Group', serviceIds: [] }),
    deleteGroup: vi.fn().mockResolvedValue(undefined),
    moveGroup: vi.fn().mockResolvedValue(undefined),
    startGroup: vi.fn().mockResolvedValue(undefined),
    stopGroup: vi.fn().mockResolvedValue(undefined),
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
    toggleMaximizeWindow: vi.fn().mockResolvedValue(undefined),
    startWindowDrag: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    showWindow: vi.fn().mockResolvedValue(undefined),
    exitApp: vi.fn().mockResolvedValue(undefined),
    getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
    checkUpdate: vi.fn().mockResolvedValue(null),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    onSnapshot: vi.fn().mockReturnValue(vi.fn()),
    onLogEntry: vi.fn().mockReturnValue(vi.fn()),
    onCloseRequested: vi.fn().mockReturnValue(vi.fn())
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

async function renderApp(initialSnapshot: AppSnapshot) {
  const api = createMockApi(initialSnapshot);
  window.servicePilot = api;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('Service Manager');
  return { api, user };
}

describe('App service flows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('saves a new Spring service from the service modal', { timeout: 30000 }, async () => {
    const { api, user } = await renderApp(snapshot());
    vi.mocked(api.pickDirectory).mockResolvedValue('D:\\workspace\\gateway');
    vi.mocked(api.detectProject).mockResolvedValue({
      name: 'gateway',
      serviceKind: 'spring',
      launchType: 'java-main',
      command: ''
    });

    const addButtons = screen.getAllByRole('button', { name: 'Add Service' });
    await user.click(addButtons[0]);

    // 等待 API 被调用
    await waitFor(() => {
      expect(api.detectProject).toHaveBeenCalled();
    });

    // 等待表单出现
    await waitFor(() => {
      expect(screen.getByText('Advanced')).toBeInTheDocument();
    }, { timeout: 3000 });

    await user.click(screen.getByText('Advanced'));

    await user.clear(screen.getByPlaceholderText('For example: gateway / user-service'));
    await user.type(screen.getByPlaceholderText('For example: gateway / user-service'), 'Gateway');
    await user.type(screen.getByPlaceholderText('Optional, reads project config by default'), '8080');
    await user.type(screen.getByPlaceholderText('For example: com.example.Application'), 'com.example.GatewayApplication');
    await user.type(screen.getByPlaceholderText('For example: dev, local'), 'dev, local');
    await user.type(screen.getByPlaceholderText('--server.servlet.context-path=/api'), '--debug --server.servlet.context-path=/api');
    await user.type(screen.getByPlaceholderText(/JAVA_HOME=D:\\environment\\jdk17/), 'JAVA_HOME=D:\\jdk\nTOKEN=a=b');

    await user.click(screen.getByRole('button', { name: 'Save Service' }));

    await waitFor(() => expect(api.saveService).toHaveBeenCalledTimes(1));
    expect(api.saveService).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Gateway',
        serviceKind: 'spring',
        launchType: 'java-main',
        workingDir: 'D:\\workspace\\gateway',
        command: 'java',
        mainClass: 'com.example.GatewayApplication',
        profiles: ['dev', 'local'],
        args: ['--debug', '--server.servlet.context-path=/api'],
        env: {
          JAVA_HOME: 'D:\\jdk',
          TOKEN: 'a=b'
        },
        port: 8080
      })
    );
  });

  it('starts an existing stopped service from the service list', async () => {
    const service = springService();
    const { api, user } = await renderApp(
      snapshot({
        services: [service],
        runtime: {
          [service.id]: {
            serviceId: service.id,
            status: 'stopped'
          }
        }
      })
    );

    const row = screen.getAllByText('Gateway')[0].closest('article');
    expect(row).not.toBeNull();

    await user.click(within(row!).getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(api.startService).toHaveBeenCalledWith('svc-1'));
  });

  it('removes duplicate application timestamps from log messages', () => {
    expect(
      getLogMessage({
        id: 'log-1',
        serviceId: 'svc-1',
        timestamp: '2026-05-20T07:20:00.027Z',
        source: 'stdout',
        text: '2026-05-20 15:20:00.029  INFO 29768 --- [scheduling-1] c.a.Task : started'
      })
    ).toBe('29768 --- [scheduling-1] c.a.Task : started');
  });

  it('can stop a service while its start action is still pending', async () => {
    const service = springService();
    const start = deferred<void>();
    const { api, user } = await renderApp(
      snapshot({
        services: [service],
        runtime: {
          [service.id]: {
            serviceId: service.id,
            status: 'stopped'
          }
        }
      })
    );
    vi.mocked(api.startService).mockReturnValue(start.promise);

    const emitSnapshot = vi.mocked(api.onSnapshot).mock.calls[0]?.[0];
    expect(emitSnapshot).toBeDefined();

    const row = screen.getAllByText('Gateway')[0].closest('article');
    expect(row).not.toBeNull();

    await user.click(within(row!).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(api.startService).toHaveBeenCalledWith('svc-1'));

    act(() => {
      emitSnapshot!(
        snapshot({
          services: [service],
          runtime: {
            [service.id]: {
              serviceId: service.id,
              status: 'starting',
              startedAt: '2026-05-20T00:00:00.000Z'
            }
          }
        })
      );
    });

    const stopButton = within(row!).getByRole('button', { name: 'Stop' });
    expect(stopButton).toBeEnabled();

    await user.click(stopButton);

    await waitFor(() => expect(api.stopService).toHaveBeenCalledWith('svc-1'));
    start.resolve();
  });

  it('opens the update confirmation from the header update button', async () => {
    const { api, user } = await renderApp(snapshot());
    vi.mocked(api.checkUpdate).mockResolvedValue({
      version: '1.0.6',
      currentVersion: '1.0.5',
      notes: '## New\n\n- Added release notes in updater.',
      date: null
    });

    await waitFor(() => expect(api.checkUpdate).toHaveBeenCalled(), { timeout: 5000 });

    await user.click(screen.getByRole('button', { name: 'Update Now' }));

    expect(screen.getByText(/Update directly to ServicePilot 1\.0\.6/)).toBeInTheDocument();
    expect(screen.getByText(/Added release notes in updater/)).toBeInTheDocument();
    expect(api.startWindowDrag).not.toHaveBeenCalled();

    const updateButtons = screen.getAllByRole('button', { name: 'Update Now' });
    await user.click(updateButtons[updateButtons.length - 1]);

    await waitFor(() => expect(api.installUpdate).toHaveBeenCalledTimes(1));
  });
});
