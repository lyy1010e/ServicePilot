import type { ServiceConfig, ServiceGroup } from '@shared/models';

export const DEFAULT_SPRING_JVM_ARGS_TEXT = '-Xms128m -Xmx512m';

export type ServiceFormState = {
  id?: string;
  name: string;
  serviceKind: ServiceConfig['serviceKind'];
  launchType: ServiceConfig['launchType'];
  workingDir: string;
  command: string;
  argsText: string;
  envText: string;
  profilesText: string;
  portText: string;
  url: string;
  frontendScript: string;
  groupIds: string[];
  mavenForceUpdate: boolean;
  mavenDebugMode: boolean;
  mavenDisableFork: boolean;
  mainClass: string;
  classpath: string;
  jvmArgsText: string;
};

export function buildServiceForm(service?: ServiceConfig, groups?: ServiceGroup[]): ServiceFormState {
  return {
    id: service?.id,
    name: service?.name ?? '',
    serviceKind: service?.serviceKind ?? 'spring',
    launchType: service?.launchType ?? 'java-main',
    workingDir: service?.workingDir ?? '',
    command: service?.command ?? '',
    argsText: service?.args?.join(' ') ?? '',
    envText: service ? Object.entries(service.env).map(([key, value]) => `${key}=${value}`).join('\n') : '',
    profilesText: service?.profiles?.join(', ') ?? '',
    portText: service?.port ? String(service.port) : '',
    url: service?.url ?? '',
    frontendScript: service?.frontendScript ?? 'dev',
    groupIds: service && groups
      ? groups.filter((group) => group.serviceIds.includes(service.id)).map((group) => group.id)
      : [],
    mavenForceUpdate: service?.mavenForceUpdate ?? false,
    mavenDebugMode: service?.mavenDebugMode ?? false,
    mavenDisableFork: service?.mavenDisableFork ?? false,
    mainClass: service?.mainClass ?? '',
    classpath: service?.classpath ?? '',
    jvmArgsText: service ? service.jvmArgs?.join(' ') ?? '' : DEFAULT_SPRING_JVM_ARGS_TEXT
  };
}

export function getProjectNameFromPath(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.split('/').pop() || '';
}

export function getDefaultCommand(launchType: ServiceConfig['launchType']): string {
  switch (launchType) {
    case 'maven':
      return 'mvn';
    case 'java-main':
      return 'java';
    case 'vue-preset':
      return 'npm';
    case 'cargo-run':
      return 'cargo';
    default:
      return '';
  }
}

export function isSimpleDirectoryImportForm(form: ServiceFormState): boolean {
  return (
    !form.id &&
    form.workingDir.trim() !== '' &&
    form.name.trim() === '' &&
    form.command.trim() === '' &&
    form.argsText.trim() === '' &&
    form.envText.trim() === '' &&
    form.profilesText.trim() === '' &&
    form.portText.trim() === '' &&
    form.url.trim() === '' &&
    form.mainClass.trim() === '' &&
    form.classpath.trim() === '' &&
    (form.jvmArgsText.trim() === '' || form.jvmArgsText.trim() === DEFAULT_SPRING_JVM_ARGS_TEXT)
  );
}
