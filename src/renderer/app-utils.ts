import type { AppSnapshot, RuntimeState } from '@shared/models';

export function parseArgs(input: string): string[] {
  return input
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseEnv(input: string): Record<string, string> {
  return Object.fromEntries(
    input
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('=');
        if (index < 0) {
          return [line, ''];
        }
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

export function parseProfiles(input: string): string[] {
  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildDefaultClasspath(workingDir: string): string {
  const base = workingDir.trim().replace(/[\\/]+$/, '');
  if (!base) {
    return '';
  }
  return [
    `${base}\\target\\classes`,
    `${base}\\target\\test-classes`,
    `${base}\\target\\dependency\\*`
  ].join(';');
}

export function formatDuration(runtime: RuntimeState | undefined, now: number): string {
  if (!runtime) {
    return '--';
  }

  let diffSeconds: number | null = null;
  if (typeof runtime.elapsedSeconds === 'number') {
    diffSeconds = Math.max(0, Math.floor(runtime.elapsedSeconds));
  } else if (
    runtime.startedAt &&
    (runtime.status === 'running' || runtime.status === 'starting' || runtime.status === 'stopping')
  ) {
    const started = new Date(runtime.startedAt).getTime();
    if (!Number.isNaN(started)) {
      diffSeconds = Math.max(0, Math.floor((now - started) / 1000));
    }
  }

  if (diffSeconds === null) {
    return '--';
  }

  const hours = String(Math.floor(diffSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((diffSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(diffSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function toggleValue(values: string[], target: string, checked: boolean): string[] {
  if (checked) {
    return values.includes(target) ? values : [...values, target];
  }
  return values.filter((value) => value !== target);
}

function getRuntime(snapshot: AppSnapshot, serviceId: string): RuntimeState {
  return snapshot.runtime[serviceId] ?? {
    serviceId,
    status: 'stopped'
  };
}

export function buildRuntimeSummary(snapshot: AppSnapshot) {
  const summary = {
    total: snapshot.services.length,
    running: 0,
    stopped: 0,
    starting: 0,
    failed: 0
  };

  snapshot.services.forEach((service) => {
    const status = getRuntime(snapshot, service.id).status;
    if (status === 'running') {
      summary.running += 1;
    } else if (status === 'failed') {
      summary.failed += 1;
    } else if (status === 'starting' || status === 'stopping') {
      summary.starting += 1;
    } else {
      summary.stopped += 1;
    }
  });

  return summary;
}
