const DEFAULT_WORKER_URL = 'https://min-filmsamling-api.min-filmsamling.workers.dev';

export function withWorkerDefault(settings) {
  return { ...settings, workerUrl: settings.workerUrl || DEFAULT_WORKER_URL };
}
