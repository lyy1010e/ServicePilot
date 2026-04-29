import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSnapshot, LogEntry, ServiceConfig, ServicePilotApi } from '@shared/models';
import { App } from './App';

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
    quickStartProject: vi.fn().mockResolvedValue(springService()),
    importIdeaProject: vi.fn().mockResolvedValue(springService()),
    importState: vi.fn().mockResolvedValue(undefined),
    exportState: vi.fn().mockResolvedValue(undefined),
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
    onSnapshot: vi.fn().mockReturnValue(vi.fn()),
    onLogEntry: vi.fn().mockReturnValue(vi.fn())
  };
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

  it('saves a new Spring service from the service modal', async () => {
    const { api, user } = await renderApp(snapshot());
    vi.mocked(api.pickDirectory).mockResolvedValue('D:\\workspace\\gateway');
    vi.mocked(api.detectProject).mockResolvedValue({
      name: 'gateway',
      serviceKind: 'spring',
      launchType: 'java-main',
      command: ''
    });

    await user.click(screen.getByRole('button', { name: 'Add Service' }));
    await user.click(screen.getByRole('button', { name: 'Choose Project' }));
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
});
