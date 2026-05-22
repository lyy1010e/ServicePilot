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
    app: {
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      getVersion: vi.fn().mockResolvedValue('1.0.0'),
      checkUpdate: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      showWindow: vi.fn().mockResolvedValue(undefined),
      exit: vi.fn().mockResolvedValue(undefined)
    },
    services: {
      list: vi.fn().mockResolvedValue(initialSnapshot.services),
      detectProject: vi.fn().mockResolvedValue({
        name: 'gateway',
        serviceKind: 'spring',
        launchType: 'java-main',
        command: ''
      }),
      importProject: vi.fn().mockResolvedValue(springService()),
      importIdeaProject: vi.fn().mockResolvedValue(springService()),
      scanSpring: vi.fn().mockResolvedValue({ services: [] }),
      batchImport: vi.fn().mockResolvedValue([springService()]),
      save: vi.fn().mockResolvedValue(springService()),
      delete: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      restart: vi.fn().mockResolvedValue(undefined),
      openUrl: vi.fn().mockResolvedValue(undefined)
    },
    groups: {
      list: vi.fn().mockResolvedValue(initialSnapshot.groups),
      save: vi.fn().mockResolvedValue({ id: 'group-1', name: 'Group', serviceIds: [] }),
      delete: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      setServiceMembership: vi.fn().mockResolvedValue(undefined),
      addServicesToGroups: vi.fn().mockResolvedValue(undefined)
    },
    logs: {
      history: vi.fn().mockResolvedValue([] satisfies LogEntry[]),
      clear: vi.fn().mockResolvedValue(undefined)
    },
    settings: {
      setLanguage: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
      importIdeaMavenConfig: vi.fn().mockResolvedValue(initialSnapshot.settings),
      importState: vi.fn().mockResolvedValue(undefined),
      exportState: vi.fn().mockResolvedValue(undefined)
    },
    dialog: {
      pickDirectory: vi.fn().mockResolvedValue(null),
      pickFile: vi.fn().mockResolvedValue(null)
    },
    window: {
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
      startDrag: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      onCloseRequested: vi.fn().mockReturnValue(vi.fn())
    },
    events: {
      onSnapshot: vi.fn().mockReturnValue(vi.fn()),
      onLogEntry: vi.fn().mockReturnValue(vi.fn())
    }
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

async function renderApp(initialSnapshot: AppSnapshot, configureApi?: (api: ServicePilotApi) => void) {
  const api = createMockApi(initialSnapshot);
  configureApi?.(api);
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
    vi.mocked(api.dialog.pickDirectory).mockResolvedValue('D:\\workspace\\gateway');
    vi.mocked(api.services.detectProject).mockResolvedValue({
      name: 'gateway',
      serviceKind: 'spring',
      launchType: 'java-main',
      command: ''
    });

    const addButtons = screen.getAllByRole('button', { name: 'Add Service' });
    await user.click(addButtons[0]);

    // 等待 API 被调用
    await waitFor(() => {
      expect(api.services.detectProject).toHaveBeenCalled();
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

    await waitFor(() => expect(api.services.save).toHaveBeenCalledTimes(1));
    expect(api.services.save).toHaveBeenCalledWith(
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

    await waitFor(() => expect(api.services.start).toHaveBeenCalledWith('svc-1'));
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

  it('searches within the full log context and keeps surrounding lines visible', async () => {
    const service = springService();
    const logs: LogEntry[] = [
      {
        id: 'log-before',
        serviceId: service.id,
        timestamp: '2026-05-20T07:19:59.000Z',
        source: 'stdout',
        text: 'Preparing checkout session'
      },
      {
        id: 'log-match',
        serviceId: service.id,
        timestamp: '2026-05-20T07:20:00.000Z',
        source: 'stdout',
        text: 'User searched for mobile phone'
      },
      {
        id: 'log-after',
        serviceId: service.id,
        timestamp: '2026-05-20T07:20:01.000Z',
        source: 'stdout',
        text: 'Payment callback completed'
      }
    ];
    const { api, user } = await renderApp(
      snapshot({
        services: [service],
        runtime: {
          [service.id]: {
            serviceId: service.id,
            status: 'running'
          }
        }
      }),
      (nextApi) => {
        vi.mocked(nextApi.logs.history).mockResolvedValue(logs);
      }
    );

    await waitFor(() => expect(api.logs.history).toHaveBeenCalledWith(service.id));

    await user.type(screen.getByPlaceholderText('Search log content...'), 'mobile');

    expect(await screen.findByText(/User searched for/)).toBeInTheDocument();
    expect(screen.getByText(/Preparing checkout session/)).toBeInTheDocument();
    expect(screen.getByText(/Payment callback completed/)).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Locate in original log' })).not.toBeInTheDocument();

    const matchRow = screen.getByText(/User searched for/).closest('.pilot-terminal__row');
    expect(matchRow).toHaveClass('pilot-terminal__row--search-current');
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
    vi.mocked(api.services.start).mockReturnValue(start.promise);

    const emitSnapshot = vi.mocked(api.events.onSnapshot).mock.calls[0]?.[0];
    expect(emitSnapshot).toBeDefined();

    const row = screen.getAllByText('Gateway')[0].closest('article');
    expect(row).not.toBeNull();

    await user.click(within(row!).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(api.services.start).toHaveBeenCalledWith('svc-1'));

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

    await waitFor(() => expect(api.services.stop).toHaveBeenCalledWith('svc-1'));
    start.resolve();
  });

  it('opens the update confirmation from the header update button', async () => {
    const { api, user } = await renderApp(snapshot());
    vi.mocked(api.app.checkUpdate).mockResolvedValue({
      version: '1.0.6',
      currentVersion: '1.0.5',
      notes: '## New\n\n- Added release notes in updater.',
      date: null
    });

    await waitFor(() => expect(api.app.checkUpdate).toHaveBeenCalled(), { timeout: 5000 });

    await user.click(screen.getByRole('button', { name: 'Update Now' }));

    expect(screen.getByText(/Update directly to ServicePilot 1\.0\.6/)).toBeInTheDocument();
    expect(screen.getByText(/Added release notes in updater/)).toBeInTheDocument();
    expect(api.window.startDrag).not.toHaveBeenCalled();

    const updateButtons = screen.getAllByRole('button', { name: 'Update Now' });
    await user.click(updateButtons[updateButtons.length - 1]);

    await waitFor(() => expect(api.app.installUpdate).toHaveBeenCalledTimes(1));
  });
});
