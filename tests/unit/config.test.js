import { describe, expect, it } from 'vitest';
import { withWorkerDefault } from '../../src/config.js';

describe('Worker-adressen i appens indstillinger', () => {
  it('bruger den offentlige Worker, når adressen mangler', () => {
    expect(withWorkerDefault({ id: 'preferences' }).workerUrl).toBe(
      'https://min-filmsamling-api.min-filmsamling.workers.dev',
    );
  });

  it('bruger den offentlige Worker, når en gemt adresse er tom', () => {
    expect(withWorkerDefault({ id: 'preferences', workerUrl: '' }).workerUrl).toBe(
      'https://min-filmsamling-api.min-filmsamling.workers.dev',
    );
  });

  it('bevarer brugerens tilpassede Worker-adresse præcis som gemt', () => {
    expect(
      withWorkerDefault({ id: 'preferences', workerUrl: 'https://films.example.workers.dev/' })
        .workerUrl,
    ).toBe('https://films.example.workers.dev/');
  });

  it('bevarer øvrige indstillinger og ændrer ikke det oprindelige objekt', () => {
    const settings = Object.freeze({ id: 'preferences', language: 'en-GB', listMode: 'grid' });
    expect(withWorkerDefault(settings)).toEqual({
      id: 'preferences',
      language: 'en-GB',
      listMode: 'grid',
      workerUrl: 'https://min-filmsamling-api.min-filmsamling.workers.dev',
    });
    expect(settings).toEqual({ id: 'preferences', language: 'en-GB', listMode: 'grid' });
  });
});
