import { el, button, field } from './ui.js';
import { startBarcodeScanner, decodeBarcodeFile, compressImage } from './camera.js';
let cleanup = () => {};
export function closeModal() {
  cleanup();
  cleanup = () => {};
  document.querySelector('#modal').replaceChildren();
}
export function showSheet(title, ...children) {
  closeModal();
  const sheet = el(
    'section',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    el('h2', {}, title),
    ...children,
  );
  document.querySelector('#modal').replaceChildren(el('div', { class: 'overlay' }, sheet));
  sheet.focus();
  return sheet;
}
export function showCandidates(candidates, choose, extras = []) {
  showSheet(
    'Vælg den rigtige film',
    el('p', {}, 'Der er flere mulige film. Tryk på den rigtige titel.'),
    el(
      'div',
      { class: 'candidates' },
      candidates
        .slice(0, 5)
        .map((candidate) =>
          button(`${candidate.title}${candidate.year ? ' · ' + candidate.year : ''}`, () =>
            choose(candidate),
          ),
        ),
    ),
    ...extras,
  );
}
export async function openScanner(onCode, onCancel) {
  const video = el('video', { playsinline: '', muted: '', 'aria-label': 'Stregkodekamera' });
  const help = el('p', {}, 'Starter bagkameraet…');
  const code = field('Stregkodenummer', 'barcode', '', {
    inputmode: 'numeric',
    autocomplete: 'off',
  });
  const controller = new AbortController();
  let photoAttempt = 0;
  const use = (raw) => {
    if (controller.signal.aborted) return;
    closeModal();
    onCode(raw);
  };
  const photo = el('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    'aria-label': 'Tag foto af stregkoden',
    onchange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const attempt = ++photoAttempt;
      help.textContent = 'Læser stregkoden på fotoet…';
      try {
        const result = await decodeBarcodeFile(file);
        if (attempt === photoAttempt) use(result);
      } catch (error) {
        help.textContent = error.message;
      }
    },
  });
  showSheet(
    'Scan stregkode',
    el('div', { class: 'camera-view' }, video),
    help,
    el('label', { class: 'field' }, el('span', {}, 'Tag foto af stregkoden'), photo),
    code,
    el(
      'div',
      { class: 'actions' },
      button('Brug nummer', () => use(code.querySelector('input').value)),
      button('Annuller', () => {
        closeModal();
        onCancel();
      }),
    ),
  );
  cleanup = () => controller.abort();
  await startBarcodeScanner(
    video,
    use,
    (error) => {
      help.textContent = error.message;
    },
    { signal: controller.signal },
  );
}
export async function openCoverCamera({
  message = 'Tag et billede af hele forsiden. AI læser titel, grafik og covertekst.',
  onBlob,
  onCancel,
  own = false,
  onStart = () => {},
}) {
  onStart();
  const controller = new AbortController();
  let stream,
    attempt = 0,
    captured = false,
    lastBlob,
    previewUrl;
  const video = el('video', { playsinline: '', muted: '', 'aria-label': 'Coverkamera' });
  video.muted = true;
  const cameraView = el('div', { class: 'camera-view' }, video);
  const help = el('p', {}, 'Starter bagkameraet…');
  const capture = button(
    'Tag billede',
    async () => {
      if (!stream || !video.videoWidth || controller.signal.aborted) {
        help.textContent = 'Kameraet er ikke klar. Brug fotoknappen nedenfor.';
        return;
      }
      const shotAttempt = attempt;
      capture.disabled = true;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      canvas.width = 0;
      canvas.height = 0;
      if (controller.signal.aborted || shotAttempt !== attempt) return;
      if (blob) await use(blob);
      else {
        capture.disabled = false;
        help.textContent = 'Billedet kunne ikke tages. Prøv igen eller vælg et foto nedenfor.';
      }
    },
    { class: 'primary', disabled: '' },
  );
  const retry = button(
    own ? 'Prøv at gemme fotoet igen' : 'Prøv analysen igen',
    () => {
      if (lastBlob && !controller.signal.aborted) {
        onStart();
        submit(lastBlob, ++attempt);
      }
    },
    { class: 'primary', hidden: '' },
  );
  const crop = button(
    'Beskær titelområdet og prøv igen',
    () => lastBlob && openCrop(lastBlob, onBlob, onCancel, onStart),
    { hidden: '' },
  );
  const photo = el('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    'aria-label': 'Tag eller vælg coverfoto',
    onchange: (event) => {
      const chosen = event.target.files?.[0];
      event.target.value = '';
      if (chosen) use(chosen);
    },
  });
  function stop() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
    capture.disabled = true;
    capture.hidden = true;
    cameraView.hidden = !previewUrl;
  }
  function showRetry() {
    retry.hidden = !lastBlob;
    crop.hidden = own || !lastBlob;
  }
  async function submit(blob, ownAttempt) {
    retry.hidden = true;
    crop.hidden = true;
    help.replaceChildren(
      el('span', { class: 'spinner' }),
      own ? 'Gemmer dit coverfoto…' : 'Uploader coveret og analyserer filmen…',
    );
    try {
      await onBlob(blob, {
        retry: () => openCoverCamera({ message, onBlob, onCancel, own, onStart }),
        crop: () => openCrop(blob, onBlob, onCancel, onStart),
      });
    } catch (error) {
      if (!controller.signal.aborted && ownAttempt === attempt && error.name !== 'AbortError') {
        help.textContent = error.message;
        showRetry();
      }
    }
  }
  async function use(chosen) {
    if (controller.signal.aborted) return;
    const ownAttempt = ++attempt;
    captured = true;
    onStart();
    capture.disabled = true;
    retry.hidden = true;
    crop.hidden = true;
    help.textContent = 'Klargør og komprimerer billedet…';
    try {
      const blob = await compressImage(chosen);
      if (controller.signal.aborted || ownAttempt !== attempt) return;
      lastBlob = blob;
      stop();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      cameraView.replaceChildren(el('img', { src: previewUrl, alt: 'Dit coverfoto' }));
      cameraView.hidden = false;
      await submit(blob, ownAttempt);
    } catch (error) {
      if (!controller.signal.aborted && ownAttempt === attempt) {
        help.textContent = error.message;
        showRetry();
      }
    } finally {
      if (!controller.signal.aborted && ownAttempt === attempt) capture.disabled = !stream;
    }
  }
  showSheet(
    own ? 'Eget coverfoto' : 'Find film fra cover',
    el('p', {}, message),
    cameraView,
    help,
    el(
      'div',
      { class: 'actions' },
      capture,
      retry,
      crop,
      button('Tag nyt billede', () => openCoverCamera({ message, onBlob, onCancel, own, onStart })),
      button('Annuller – behold kladden', () => {
        closeModal();
        onCancel();
      }),
    ),
    el('label', { class: 'field' }, el('span', {}, 'Tag eller vælg coverfoto'), photo),
  );
  cleanup = () => {
    controller.abort();
    stop();
    lastBlob = undefined;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
    if (controller.signal.aborted || captured) {
      stop();
      return;
    }
    video.srcObject = stream;
    await video.play();
    if (controller.signal.aborted || captured) return;
    capture.disabled = false;
    help.textContent = 'Hold hele forsiden roligt i billedet.';
  } catch {
    stop();
    if (!controller.signal.aborted && !captured) {
      cameraView.hidden = true;
      help.textContent = 'Brug fotoknappen nedenfor, hvis livekameraet ikke starter.';
    }
  }
}
export async function openCrop(file, onBlob, onCancel, onStart = () => {}) {
  onStart();
  const controller = new AbortController();
  let bitmap, previewUrl, canvas;
  const dispose = () => {
    controller.abort();
    bitmap?.close?.();
    bitmap = null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  };
  const loading = el('p', {}, 'Klargør billedet til beskæring…');
  const cancel = () => {
    closeModal();
    onCancel();
  };
  showSheet('Beskær titelområdet', loading, button('Annuller – behold kladden', cancel));
  cleanup = dispose;
  try {
    const full = await compressImage(file);
    if (controller.signal.aborted) return;
    if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(full);
    else {
      previewUrl = URL.createObjectURL(full);
      bitmap = new Image();
      bitmap.src = previewUrl;
      await bitmap.decode();
    }
    if (controller.signal.aborted) {
      dispose();
      return;
    }
    canvas = el('canvas', {});
    canvas.width = bitmap.width || bitmap.naturalWidth;
    canvas.height = bitmap.height || bitmap.naturalHeight;
    const sliders = [
      ['Venstre', 'left', 0],
      ['Højre', 'right', 100],
      ['Top', 'top', 0],
      ['Bund', 'bottom', 100],
    ].map(([label, name, value]) =>
      field(label, name, value, { type: 'range', min: 0, max: 100, step: 1 }),
    );
    const rect = () => {
      const values = sliders.map((s) => Number(s.querySelector('input').value) / 100);
      return {
        x: values[0],
        y: values[2],
        width: values[1] - values[0],
        height: values[3] - values[2],
      };
    };
    const draw = () => {
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const area = rect();
      context.strokeStyle = '#b99bff';
      context.lineWidth = 6;
      context.strokeRect(
        area.x * canvas.width,
        area.y * canvas.height,
        area.width * canvas.width,
        area.height * canvas.height,
      );
    };
    sliders.forEach((s) => s.addEventListener('input', draw));
    const help = el('p', {}, 'Afgræns titelområdet med de fire skydeknapper.');
    // Replacing our loading sheet must preserve the same cancellation controller.
    cleanup = () => {};
    showSheet(
      'Beskær titelområdet',
      el('div', { class: 'crop-preview' }, canvas),
      help,
      ...sliders,
      el(
        'div',
        { class: 'actions' },
        button(
          'Beskær og prøv igen',
          async () => {
            try {
              help.textContent = 'Komprimerer udsnittet og analyserer…';
              const blob = await compressImage(file, { crop: rect() });
              if (controller.signal.aborted) return;
              await onBlob(blob, {
                retry: () => openCoverCamera({ onBlob, onCancel, onStart }),
                crop: () => openCrop(file, onBlob, onCancel, onStart),
              });
            } catch (error) {
              if (!controller.signal.aborted) help.textContent = error.message;
            }
          },
          { class: 'primary' },
        ),
        button('Annuller – behold kladden', cancel),
      ),
    );
    cleanup = dispose;
    draw();
  } catch (error) {
    bitmap?.close?.();
    bitmap = null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    if (!controller.signal.aborted) loading.textContent = error.message;
  }
}
