import { normalizeBarcode } from '../shared/barcode.js';

const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_OUTPUT_BYTES = 1_500_000;
const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a'];

export function validateImageInput(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0)
    throw new Error('Billedfilen er tom. Vælg et andet billede.');
  if (file.size > MAX_INPUT_BYTES)
    throw new Error('Billedfilen er for stor. Vælg et billede under 30 MB.');
  if (!/^image\/(?:jpeg|png|webp|gif|heic|heif)$/i.test(file.type)) {
    throw new Error('Vælg en billedfil i JPEG-, PNG-, WebP- eller HEIC-format.');
  }
}

function validateDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('Billedet har ugyldige dimensioner. Vælg et andet billede.');
  }
  if (width * height > MAX_INPUT_PIXELS)
    throw new Error('Billedets opløsning er for høj. Vælg et billede under 40 megapixel.');
}

/** Coordinates refer to the browser-decoded image, after EXIF orientation. */
export function imageGeometry(width, height, crop) {
  validateDimensions(width, height);
  const rect = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (
    !values.every(Number.isFinite) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > 1 + Number.EPSILON ||
    rect.y + rect.height > 1 + Number.EPSILON
  ) {
    throw new Error('Ugyldig beskæring. Vælg et område inden for billedet.');
  }
  const source = {
    x: rect.x * width,
    y: rect.y * height,
    width: rect.width * width,
    height: rect.height * height,
  };
  const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
  return {
    source,
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/** Read only encoded dimensions; never rotate pixels from EXIF ourselves. */
export function readImageDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length >= 24 && bytes[0] === 137 && text(1, 3) === 'PNG' && text(12, 4) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(text(0, 6))) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length >= 25 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const type = text(12, 4);
    if (type === 'VP8X' && bytes.length >= 30) {
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    }
    if (type === 'VP8 ' && bytes.length >= 30)
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    if (type === 'VP8L' && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      };
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 7
      ) {
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
  }
  if (bytes.length >= 24 && text(4, 4) === 'ftyp') {
    // HEIC stores each item's pixel dimensions in an ispe full box.
    let largest;
    for (let offset = 8; offset + 16 <= bytes.length; offset += 1) {
      if (text(offset, 4) !== 'ispe') continue;
      const dimensions = { width: view.getUint32(offset + 8), height: view.getUint32(offset + 12) };
      if (!largest || dimensions.width * dimensions.height > largest.width * largest.height)
        largest = dimensions;
    }
    if (largest) return largest;
  }
  throw new Error(
    'Billedets dimensioner kunne ikke læses. Vælg et andet billede, gerne JPEG eller PNG.',
  );
}

async function decodeOrientedImage(file) {
  validateImageInput(file);
  const header = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const dimensions = readImageDimensions(header);
  validateDimensions(dimensions.width, dimensions.height);
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const bitmap = await globalThis.createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      /* Safari supports some image formats only through HTMLImageElement. */
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    if (typeof image.decode === 'function') {
      image.src = url;
      await image.decode();
    } else {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
    }
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => {
        image.src = '';
        URL.revokeObjectURL(url);
      },
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Billedet kunne ikke åbnes. Prøv at tage et nyt foto eller vælge JPEG.');
  }
}

function jpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('Billedet kunne ikke komprimeres. Prøv et andet billede.')),
      'image/jpeg',
      quality,
    );
  });
}

export async function compressImage(file, { crop } = {}) {
  const decoded = await decodeOrientedImage(file);
  let canvas;
  try {
    const geometry = imageGeometry(decoded.width, decoded.height, crop);
    canvas = document.createElement('canvas');
    canvas.width = geometry.width;
    canvas.height = geometry.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Browseren kunne ikke behandle billedet. Prøv igen.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const rect = geometry.source;
    context.drawImage(
      decoded.image,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    // Re-encoding canvas pixels strips GPS, EXIF and all source metadata.
    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]) {
      const blob = await jpegBlob(canvas, quality);
      if (blob.size <= MAX_OUTPUT_BYTES) return blob;
    }
    throw new Error(
      'Billedet kunne ikke komprimeres til 1,5 MB. Vælg et mindre udsnit eller et andet billede.',
    );
  } finally {
    decoded.release();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

export async function blobToDataURL(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(parts.join(''))}`;
}

async function zxingReader() {
  const [{ BrowserMultiFormatReader }, library] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map([
    [
      library.DecodeHintType.POSSIBLE_FORMATS,
      [library.BarcodeFormat.EAN_13, library.BarcodeFormat.EAN_8, library.BarcodeFormat.UPC_A],
    ],
    [library.DecodeHintType.TRY_HARDER, true],
  ]);
  return {
    reader: new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 200,
      delayBetweenScanSuccess: 500,
    }),
    library,
  };
}

export async function decodeBarcodeFile(file) {
  const image = await compressImage(file);
  const { reader } = await zxingReader();
  const url = URL.createObjectURL(image);
  try {
    const result = await reader.decodeFromImageUrl(url);
    return normalizeBarcode(result.getText());
  } catch {
    throw new Error(
      'Der blev ikke fundet en gyldig stregkode på billedet. Tag et skarpere billede tættere på stregkoden, eller skriv koden manuelt.',
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cameraError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return new Error(
      'Kameraadgang blev afvist. Tillad kameraet i Safari, eller tag et billede af stregkoden.',
    );
  }
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
    return new Error('Der blev ikke fundet et kamera. Vælg et billede af stregkoden.');
  }
  return new Error('Kameraet kunne ikke startes. Prøv igen, eller vælg et billede af stregkoden.');
}

/** The optional signal also cancels permission/setup work before a stop function is available. */
export async function startBarcodeScanner(video, onCode, onError = () => {}, { signal } = {}) {
  let stopped = false;
  let delivered = false;
  let stream;
  let timer;
  let controls;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    if (controls) {
      controls.stop();
      controls = undefined;
    }
    if (stream) {
      const ownedStream = stream;
      stream = undefined;
      ownedStream.getTracks().forEach((track) => track.stop());
      if (video.srcObject === ownedStream) {
        video.pause();
        video.srcObject = null;
      }
    }
  };
  const fail = (error) => {
    if (stopped || delivered) return;
    stop();
    onError(cameraError(error));
  };
  const deliver = (raw) => {
    if (stopped || delivered) return false;
    let code;
    try {
      code = normalizeBarcode(raw);
    } catch {
      return false;
    }
    delivered = true;
    stop();
    onCode(code);
    return true;
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) {
    stop();
    return stop;
  }
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
    if (stopped) {
      stop();
      return stop;
    }
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    if (stopped) return stop;

    let detector;
    if (typeof globalThis.BarcodeDetector === 'function') {
      try {
        const supported = await globalThis.BarcodeDetector.getSupportedFormats();
        const formats = SCAN_FORMATS.filter((format) => supported.includes(format));
        if (formats.length === SCAN_FORMATS.length)
          detector = new globalThis.BarcodeDetector({ formats });
      } catch {
        /* Safari and unsupported detector implementations use local ZXing. */
      }
    }
    if (stopped) return stop;
    if (detector) {
      const scan = async () => {
        if (stopped) return;
        let results;
        try {
          results = video.readyState >= 2 ? await detector.detect(video) : [];
        } catch (error) {
          fail(error);
          return;
        }
        if (stopped) return;
        for (const result of results) if (deliver(result.rawValue)) return;
        if (!stopped) timer = setTimeout(scan, 200);
      };
      timer = setTimeout(scan, 0);
    } else {
      const { reader, library } = await zxingReader();
      if (stopped) return stop;
      const activeControls = await reader.decodeFromVideoElement(
        video,
        (result, error, callbackControls) => {
          if (stopped) {
            callbackControls?.stop();
            return;
          }
          controls = callbackControls;
          if (result) {
            // ZXing schedules its next timer after this callback. Stop after that scheduling too.
            if (deliver(result.getText())) queueMicrotask(() => callbackControls?.stop());
          } else if (
            error &&
            !(error instanceof library.NotFoundException) &&
            !(error instanceof library.ChecksumException) &&
            !(error instanceof library.FormatException)
          ) {
            fail(error);
          }
        },
      );
      if (stopped) activeControls.stop();
      else controls = activeControls;
    }
  } catch (error) {
    fail(error);
  }
  return stop;
}
