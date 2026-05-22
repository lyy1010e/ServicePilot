import type { AppSettings } from '@shared/models';

export type SettingsFormState = {
  mavenSettingsFile: string;
  mavenLocalRepository: string;
  clearLogsOnRestart: boolean;
};

export function buildSettingsForm(settings: AppSettings): SettingsFormState {
  return {
    mavenSettingsFile: settings.mavenSettingsFile ?? '',
    mavenLocalRepository: settings.mavenLocalRepository ?? '',
    clearLogsOnRestart: settings.clearLogsOnRestart ?? true
  };
}
