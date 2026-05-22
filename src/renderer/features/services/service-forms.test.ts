import { describe, expect, it } from 'vitest';
import type { ServiceConfig } from '@shared/models';
import {
  buildServiceForm,
  DEFAULT_SPRING_JVM_ARGS_TEXT,
  isSimpleDirectoryImportForm
} from './service-forms';

function service(jvmArgs?: string[]): ServiceConfig {
  return {
    id: 'service-1',
    name: 'service',
    serviceKind: 'spring',
    launchType: 'java-main',
    workingDir: 'D:\\workspace\\service',
    command: 'java',
    args: [],
    env: {},
    jvmArgs
  };
}

describe('service forms', () => {
  it('defaults new Spring services to bounded local JVM memory', () => {
    expect(buildServiceForm().jvmArgsText).toBe(DEFAULT_SPRING_JVM_ARGS_TEXT);
  });

  it('preserves existing service JVM args when editing', () => {
    expect(buildServiceForm(service(['-Xmx1024m'])).jvmArgsText).toBe('-Xmx1024m');
    expect(buildServiceForm(service()).jvmArgsText).toBe('');
  });

  it('still treats default JVM args as a simple directory import form', () => {
    expect(
      isSimpleDirectoryImportForm({
        ...buildServiceForm(),
        workingDir: 'D:\\workspace\\service'
      })
    ).toBe(true);
  });
});
