import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  imageGeometry,
  validateImageInput,
  startBarcodeScanner,
  compressImage,
  blobToDataURL,
  readImageDimensions,
} from '../../src/camera.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('cover image geometry', () => {
  it('reduces a landscape image to a longest side of 1600 pixels', () => {
    expect(imageGeometry(4032, 3024)).toEqual({
      source: { x: 0, y: 0, width: 4032, height: 3024 },
      width: 1600,
      height: 1200,
    });
  });

  it('crops on an already oriented portrait image before resizing', () => {
    expect(imageGeometry(3024, 4032, { x: 0.25, y: 0.125, width: 0.5, height: 0.75 })).toEqual({
      source: { x: 756, y: 504, width: 1512, height: 3024 },
      width: 800,
      height: 1600,
    });
  });

  it('preserves a small image without upscaling', () => {
    expect(imageGeometry(600, 900)).toMatchObject({ width: 600, height: 900 });
  });

  it.each([
    { x: -0.1, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0.8, y: 0, width: 0.3, height: 1 },
    { x: 0, y: 0, width: NaN, height: 1 },
  ])('rejects an invalid normalized crop %s', (crop) => {
    expect(() => imageGeometry(600, 900, crop)).toThrow(/beskæring/i);
  });

  it.each([
    [0, 200],
    [200, Infinity],
    [10000, 10000],
  ])('rejects unsafe image dimensions %s x %s', (width, height) => {
    expect(() => imageGeometry(width, height)).toThrow(/billede|opløsning/i);
  });

  it('rejects oversized input before decoding it', () => {
    expect(() => validateImageInput({ size: 31 * 1024 * 1024, type: 'image/jpeg' })).toThrow(
      /stor/i,
    );
  });

  it('rejects non-image and empty files', () => {
    expect(() => validateImageInput({ size: 10, type: 'text/plain' })).toThrow(/billed/i);
    expect(() => validateImageInput({ size: 0, type: 'image/jpeg' })).toThrow(/tom/i);
  });
});

describe('image processing and resource limits', () => {
  function png(width, height) {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.set([73, 72, 68, 82], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return new Blob([bytes], { type: 'image/png' });
  }

  function canvas(outputs = [new Blob(['jpeg bytes'], { type: 'image/jpeg' })]) {
    const context = { drawImage: vi.fn(), fillRect: vi.fn() };
    const surface = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: vi.fn((callback) => callback(outputs.length > 1 ? outputs.shift() : outputs[0])),
    };
    vi.stubGlobal('document', { createElement: () => surface });
    return { context, surface };
  }

  it('reads encoded dimensions before the browser allocates pixels', () => {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.set([73, 72, 68, 82], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 4032);
    view.setUint32(20, 3024);
    expect(readImageDimensions(bytes)).toEqual({ width: 4032, height: 3024 });
  });

  it('reads JPEG frame dimensions independently of EXIF orientation', () => {
    const bytes = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 11, 208, 15, 192, 1]);
    expect(readImageDimensions(bytes)).toEqual({ width: 4032, height: 3024 });
  });

  it('accepts a tiny lossless WebP header without requiring a lossy frame size', () => {
    const bytes = new Uint8Array(26);
    bytes.set([82, 73, 70, 70], 0);
    bytes.set([87, 69, 66, 80, 86, 80, 56, 76], 8);
    bytes[20] = 0x2f;
    expect(readImageDimensions(bytes)).toEqual({ width: 1, height: 1 });
  });

  it('rejects an unreadable header before decoding pixels', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    await expect(
      compressImage(new Blob(['not really an image'], { type: 'image/jpeg' })),
    ).rejects.toThrow(/dimensioner/i);
    expect(decode).not.toHaveBeenCalled();
  });

  it('rejects a decompression bomb before starting browser decoding', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    await expect(compressImage(png(10000, 10000))).rejects.toThrow(/opløsning/i);
    expect(decode).not.toHaveBeenCalled();
  });

  it('uses the oriented browser image once and releases its bitmap', async () => {
    const bitmap = { width: 3024, height: 4032, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const { context, surface } = canvas();
    const output = await compressImage(png(4032, 3024), {
      crop: { x: 0.25, y: 0.125, width: 0.5, height: 0.75 },
    });
    expect(output.type).toBe('image/jpeg');
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(
      bitmap,
      756,
      504,
      1512,
      3024,
      0,
      0,
      800,
      1600,
    );
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(surface.width).toBe(0);
    expect(surface.height).toBe(0);
  });

  it('lowers JPEG quality when the first encoding exceeds the byte limit', async () => {
    const bitmap = { width: 600, height: 900, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const { surface } = canvas([
      new Blob([new Uint8Array(1_600_000)], { type: 'image/jpeg' }),
      new Blob([new Uint8Array(800_000)], { type: 'image/jpeg' }),
    ]);
    const output = await compressImage(png(600, 900));
    expect(output.size).toBeLessThanOrEqual(1_500_000);
    expect(surface.toBlob.mock.calls[1][2]).toBeLessThan(surface.toBlob.mock.calls[0][2]);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('closes a decoded bitmap if crop validation fails', async () => {
    const bitmap = { width: 600, height: 900, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    await expect(
      compressImage(png(600, 900), { crop: { x: 0, y: 0, width: 2, height: 1 } }),
    ).rejects.toThrow(/beskæring/i);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('uses Safari image decoding with oriented natural dimensions and revokes its URL', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:safari-photo', revokeObjectURL: revoke });
    let decodedImage;
    vi.stubGlobal(
      'Image',
      class {
        constructor() {
          decodedImage = this;
        }
        naturalWidth = 3024;
        naturalHeight = 4032;
        decode = vi.fn().mockResolvedValue();
      },
    );
    const { context } = canvas();
    await compressImage(png(4032, 3024));
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(
      decodedImage,
      0,
      0,
      3024,
      4032,
      0,
      0,
      1200,
      1600,
    );
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:safari-photo');
    expect(decodedImage.src).toBe('');
  });

  it('releases the bitmap when JPEG encoding cannot meet the hard byte limit', async () => {
    const bitmap = { width: 600, height: 900, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    canvas([new Blob([new Uint8Array(1_600_000)], { type: 'image/jpeg' })]);
    await expect(compressImage(png(600, 900))).rejects.toThrow(/1,5 MB/i);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('creates a usable image data URL from the compressed Blob', async () => {
    expect(await blobToDataURL(new Blob(['abc'], { type: 'image/jpeg' }))).toBe(
      'data:image/jpeg;base64,YWJj',
    );
  });
});

describe('native camera scanner lifecycle', () => {
  function camera(detector) {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    const video = {
      play: vi.fn().mockResolvedValue(),
      pause: vi.fn(),
      setAttribute: vi.fn(),
      srcObject: null,
      readyState: 4,
    };
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        static getSupportedFormats() {
          return Promise.resolve(['ean_13', 'ean_8', 'upc_a']);
        }
        detect = detector;
      },
    );
    return { track, stream, video };
  }

  it('delivers a normalized barcode once and releases the camera', async () => {
    vi.useFakeTimers();
    const setup = camera(vi.fn().mockResolvedValue([{ rawValue: '036000291452' }]));
    const onCode = vi.fn();
    const stop = await startBarcodeScanner(setup.video, onCode, vi.fn());
    await vi.runOnlyPendingTimersAsync();
    expect(onCode).toHaveBeenCalledExactlyOnceWith('0036000291452');
    expect(setup.track.stop).toHaveBeenCalledOnce();
    expect(setup.video.srcObject).toBeNull();
    stop();
    await vi.runOnlyPendingTimersAsync();
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(setup.track.stop).toHaveBeenCalledTimes(1);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
  });

  it('ignores invalid detected checksums and continues scanning', async () => {
    vi.useFakeTimers();
    const setup = camera(
      vi
        .fn()
        .mockResolvedValueOnce([{ rawValue: '7393834487708' }])
        .mockResolvedValue([{ rawValue: '7393834487707' }]),
    );
    const onCode = vi.fn();
    const stop = await startBarcodeScanner(setup.video, onCode, vi.fn());
    await vi.runOnlyPendingTimersAsync();
    expect(onCode).not.toHaveBeenCalled();
    await vi.runOnlyPendingTimersAsync();
    expect(onCode).toHaveBeenCalledExactlyOnceWith('7393834487707');
    stop();
  });

  it('suppresses a detector result that arrives after cancellation', async () => {
    vi.useFakeTimers();
    let finish;
    const setup = camera(
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const onCode = vi.fn();
    const stop = await startBarcodeScanner(setup.video, onCode, vi.fn());
    await vi.runOnlyPendingTimersAsync();
    stop();
    finish([{ rawValue: '7393834487707' }]);
    await Promise.resolve();
    expect(onCode).not.toHaveBeenCalled();
    expect(setup.track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a stream that arrives after aborting a pending permission request', async () => {
    let finish;
    const setup = camera(vi.fn());
    navigator.mediaDevices.getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const onCode = vi.fn();
    const pending = startBarcodeScanner(setup.video, onCode, vi.fn(), {
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    finish(setup.stream);
    await pending;
    expect(setup.track.stop).toHaveBeenCalledOnce();
    expect(setup.video.srcObject).toBeNull();
    expect(onCode).not.toHaveBeenCalled();
  });
});
