import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { decodeBarcodeFile, startBarcodeScanner } from '../../src/camera.js';

const boundary = vi.hoisted(() => ({ scan: vi.fn(), photo: vi.fn(), construct: vi.fn() }));
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    constructor(hints, options) {
      boundary.construct(hints, options);
    }
    decodeFromVideoElement(...args) {
      return boundary.scan(...args);
    }
    decodeFromImageUrl(...args) {
      return boundary.photo(...args);
    }
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('locally bundled ZXing fallback', () => {
  function camera() {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    const video = {
      play: vi.fn().mockResolvedValue(),
      pause: vi.fn(),
      setAttribute: vi.fn(),
      srcObject: null,
      readyState: 4,
    };
    vi.stubGlobal('BarcodeDetector', undefined);
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    return { video, track };
  }

  it('validates a ZXing result, delivers it once and stops camera tracks', async () => {
    const setup = camera();
    const controls = { stop: vi.fn() };
    let report;
    boundary.scan.mockImplementation(async (_video, callback) => {
      report = callback;
      return controls;
    });
    const onCode = vi.fn();
    await startBarcodeScanner(setup.video, onCode, vi.fn());
    report({ getText: () => '036000291452' }, undefined, controls);
    report({ getText: () => '7393834487707' }, undefined, controls);
    expect(onCode).toHaveBeenCalledExactlyOnceWith('0036000291452');
    expect(setup.video.srcObject).toBeNull();
    expect(setup.track.stop).toHaveBeenCalledOnce();
    expect(controls.stop).toHaveBeenCalled();
    const hints = boundary.construct.mock.calls[0][0];
    expect(hints.get(DecodeHintType.POSSIBLE_FORMATS)).toEqual([
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
    ]);
  });

  it('disposes ZXing controls that resolve after cancellation', async () => {
    const setup = camera();
    const controls = { stop: vi.fn() };
    const controller = new AbortController();
    let finish;
    boundary.scan.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = startBarcodeScanner(setup.video, vi.fn(), vi.fn(), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort();
    finish(controls);
    await pending;
    expect(setup.track.stop).toHaveBeenCalledOnce();
    expect(controls.stop).toHaveBeenCalledOnce();
  });

  it('uses ZXing when the native detector cannot cover every required retail format', async () => {
    const setup = camera();
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        static getSupportedFormats() {
          return Promise.resolve(['ean_13']);
        }
        detect() {
          return Promise.resolve([]);
        }
      },
    );
    const controls = { stop: vi.fn() };
    boundary.scan.mockResolvedValue(controls);
    const stop = await startBarcodeScanner(setup.video, vi.fn(), vi.fn());
    stop();
    expect(boundary.scan).toHaveBeenCalledOnce();
    expect(setup.track.stop).toHaveBeenCalledOnce();
  });

  function photo() {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.set([73, 72, 68, 82], 12);
    new DataView(bytes.buffer).setUint32(16, 600);
    new DataView(bytes.buffer).setUint32(20, 900);
    const bitmap = { width: 600, height: 900, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const context = { drawImage: vi.fn(), fillRect: vi.fn() };
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => context,
        toBlob: (callback) => callback(new Blob(['jpeg'], { type: 'image/jpeg' })),
      }),
    });
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:local-photo', revokeObjectURL: revoke });
    return { file: new Blob([bytes], { type: 'image/png' }), bitmap, revoke };
  }

  it('decodes a photo and returns the canonical identity without retaining its URL', async () => {
    const setup = photo();
    boundary.photo.mockResolvedValue({ getText: () => '036000291452' });
    expect(await decodeBarcodeFile(setup.file)).toBe('0036000291452');
    expect(setup.bitmap.close).toHaveBeenCalledOnce();
    expect(setup.revoke).toHaveBeenCalledExactlyOnceWith('blob:local-photo');
  });

  it('gives a Danish photo error and revokes the URL when no barcode is found', async () => {
    const setup = photo();
    boundary.photo.mockRejectedValue(new Error('Not found'));
    await expect(decodeBarcodeFile(setup.file)).rejects.toThrow(/stregkode/i);
    expect(setup.revoke).toHaveBeenCalledExactlyOnceWith('blob:local-photo');
  });
});
