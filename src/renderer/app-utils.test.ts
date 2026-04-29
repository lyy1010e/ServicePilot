import { describe, expect, it } from 'vitest';
import type { AppSnapshot, RuntimeState, ServiceConfig } from '@shared/models';
import {
  buildDefaultClasspath,
  buildRuntimeSummary,
  formatDuration,
  parseArgs,
  parseEnv,
  parseProfiles,
  toggleValue
} from './app-utils';

function service(id: string): ServiceConfig {
  return {
    id,
    name: id,
    serviceKind: 'spring',
    launchType: 'java-main',
    workingDir: `D:\\workspace\\${id}`,
    command: 'java',
    args: [],
    env: {}
  };
}

function snapshot(runtime: AppSnapshot['runtime']): AppSnapshot {
  const services = ['api', 'web', 'worker', 'queue'].map(service);
  return {
    services,
    groups: [],
    runtime,
    settings: {
      language: 'zh-CN',
      mavenSettingsFile: '',
      mavenLocalRepository: '',
      clearLogsOnRestart: true
    }
  };
}

describe('app utils', () => {
  it('parses whitespace separated arguments', () => {
    expect(parseArgs('  --server.port=8080   --debug\t-Dfoo=bar ')).toEqual([
      '--server.port=8080',
      '--debug',
      '-Dfoo=bar'
    ]);
  });

  it('parses environment variables and preserves values after the first equals sign', () => {
    expect(parseEnv('JAVA_HOME=D:\\jdk\nTOKEN=a=b=c\nEMPTY\n')).toEqual({
      JAVA_HOME: 'D:\\jdk',
      TOKEN: 'a=b=c',
      EMPTY: ''
    });
  });

  it('parses comma separated profiles', () => {
    expect(parseProfiles(' dev,local,  test ,,')).toEqual(['dev', 'local', 'test']);
  });

  it('builds the default Windows Java classpath for a working directory', () => {
    expect(buildDefaultClasspath('D:\\workspace\\api\\')).toBe(
      'D:\\workspace\\api\\target\\classes;D:\\workspace\\api\\target\\test-classes;D:\\workspace\\api\\target\\dependency\\*'
    );
    expect(buildDefaultClasspath('   ')).toBe('');
  });

  it('formats elapsed runtime duration', () => {
    expect(formatDuration({ serviceId: 'api', status: 'running', elapsedSeconds: 3661 }, Date.now())).toBe('01:01:01');
    expect(formatDuration(undefined, Date.now())).toBe('--');
  });

  it('formats duration from startedAt for active services only', () => {
    const runtime: RuntimeState = {
      serviceId: 'api',
      status: 'starting',
      startedAt: '2026-04-29T00:00:00.000Z'
    };
    const now = new Date('2026-04-29T00:00:42.000Z').getTime();
    expect(formatDuration(runtime, now)).toBe('00:00:42');
    expect(formatDuration({ ...runtime, status: 'stopped' }, now)).toBe('--');
  });

  it('adds and removes toggle values without duplicates', () => {
    expect(toggleValue(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleValue(['a'], 'a', true)).toEqual(['a']);
    expect(toggleValue(['a', 'b'], 'a', false)).toEqual(['b']);
  });

  it('summarizes runtime states for services', () => {
    expect(
      buildRuntimeSummary(
        snapshot({
          api: { serviceId: 'api', status: 'running' },
          web: { serviceId: 'web', status: 'failed' },
          worker: { serviceId: 'worker', status: 'stopping' }
        })
      )
    ).toEqual({
      total: 4,
      running: 1,
      stopped: 1,
      starting: 1,
      failed: 1
    });
  });
});
