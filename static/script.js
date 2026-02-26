/* ── State ───────────────────────────────────────────────────── */
let stream = null;
let uploadedImageB64 = null;  // base64 of uploaded file
let currentMode = 'upload';   // 'upload' | 'camera'
let shootingMode = 'topdown'; // 'topdown' | 'frontal'

// Editor state
let editorActive = false;
let editorData = null; // { bbox, imgW, imgH, pxPerCmH, pxPerCmV }
let dragState = null;  // { type, startX, startY, origBbox }

/* ── DOM refs ────────────────────────────────────────────────── */
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const flash = document.getElementById('flash');
const resultCard = document.getElementById('result-card');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toast-msg');
const placeholder = document.getElementById('cam-placeholder');

const btnStart = document.getElementById('btn-start');
const btnMeasure = document.getElementById('btn-measure');
const inputPersonHeight = document.getElementById('input-person-height');
const inputDistance = document.getElementById('input-distance');
const inputFov = document.getElementById('input-fov');
const phoneHeightHint = document.getElementById('phone-height-hint');
const frontalDistHint = document.getElementById('frontal-dist-hint');

// Upload elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewWrapper = document.getElementById('preview-wrapper');
const previewImg = document.getElementById('preview-img');
const btnRemoveImg = document.getElementById('btn-remove-img');

// Tabs
const tabUpload = document.getElementById('tab-upload');
const tabCamera = document.getElementById('tab-camera');
const panelUpload = document.getElementById('panel-upload');
const panelCamera = document.getElementById('panel-camera');

// Shooting mode
const modeTopdown = document.getElementById('mode-topdown');
const modeFrontal = document.getElementById('mode-frontal');
const modeDesc = document.getElementById('mode-desc');
const guideTopdown = document.getElementById('guide-topdown');
const guideFrontal = document.getElementById('guide-frontal');
const inputBarFrontal = document.getElementById('input-bar-frontal');

// Editor
const editorWrapper = document.getElementById('editor-wrapper');
const editorBg = document.getElementById('editor-bg');
const editorCanvas = document.getElementById('editor-canvas');
const btnEditToggle = document.getElementById('btn-edit-toggle');
const editHint = document.getElementById('edit-hint');

let toastTimer = null;

/* ── Shooting Mode Toggle ────────────────────────────────────── */
function switchShootingMode(mode) {
  shootingMode = mode;
  modeTopdown.classList.toggle('active', mode === 'topdown');
  modeFrontal.classList.toggle('active', mode === 'frontal');

  guideTopdown.style.display = mode === 'topdown' ? '' : 'none';
  guideFrontal.style.display = mode === 'frontal' ? '' : 'none';

  // Person height is always visible; distance only for frontal
  inputBarFrontal.style.display = mode === 'frontal' ? '' : 'none';

  // Update hints
  phoneHeightHint.textContent = mode === 'topdown'
    ? `📱 Altezza telefono stimata: ${getPhoneHeightCm()} cm`
    : `📐 Usata per calcolare la distanza reale camera→oggetto`;

  modeDesc.textContent = mode === 'topdown'
    ? 'Telefono puntato verso il basso, oggetto a terra'
    : 'Telefono puntato in avanti verso l\'oggetto';

  if (mode === 'frontal') updateFrontalHint();
}

modeTopdown.addEventListener('click', () => switchShootingMode('topdown'));
modeFrontal.addEventListener('click', () => switchShootingMode('frontal'));

/* ── Input Tabs ──────────────────────────────────────────────── */
function switchTab(mode) {
  currentMode = mode;
  tabUpload.classList.toggle('active', mode === 'upload');
  tabCamera.classList.toggle('active', mode === 'camera');
  panelUpload.classList.toggle('active', mode === 'upload');
  panelCamera.classList.toggle('active', mode === 'camera');
  updateMeasureButton();
}

function updateMeasureButton() {
  if (currentMode === 'upload') {
    btnMeasure.disabled = !uploadedImageB64;
  } else {
    btnMeasure.disabled = !stream;
  }
}

tabUpload.addEventListener('click', () => switchTab('upload'));
tabCamera.addEventListener('click', () => switchTab('camera'));

/* ── File upload (drag & drop + click) ───────────────────────── */
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Seleziona un file immagine (JPG, PNG).');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedImageB64 = e.target.result;
    previewImg.src = uploadedImageB64;
    dropZone.style.display = 'none';
    previewWrapper.style.display = 'block';
    updateMeasureButton();
  };
  reader.readAsDataURL(file);
}

btnRemoveImg.addEventListener('click', () => {
  uploadedImageB64 = null;
  fileInput.value = '';
  previewImg.src = '';
  previewWrapper.style.display = 'none';
  dropZone.style.display = 'flex';
  updateMeasureButton();
  resultCard.classList.remove('visible');
});

/* ── Camera ─────────────────────────────────────────────────── */
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    placeholder.style.display = 'none';
    btnStart.style.display = 'none';
    updateMeasureButton();
  } catch (err) {
    showToast('Impossibile accedere alla fotocamera: ' + err.message);
  }
}

function captureFrame() {
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function doFlash() {
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 180);
}

/* ── Phone height from person height ─────────────────────────── */
function getPhoneHeightCm() {
  const personH = parseFloat(inputPersonHeight.value) || 170;
  return Math.round(personH * 0.935);
}

function updatePhoneHint() {
  const h = getPhoneHeightCm();
  if (shootingMode === 'topdown') {
    phoneHeightHint.textContent = `📱 Altezza telefono stimata: ${h} cm`;
  }
  if (shootingMode === 'frontal') updateFrontalHint();
}

function updateFrontalHint() {
  const d = getFrontalRealDistance();
  frontalDistHint.textContent = `📐 Distanza reale camera→oggetto: ${d} cm`;
}

inputPersonHeight.addEventListener('input', updatePhoneHint);
inputDistance.addEventListener('input', updateFrontalHint);

/* ── Get distance based on shooting mode ─────────────────────── */
function getFrontalRealDistance() {
  const eyeH = getPhoneHeightCm();
  const horizDist = parseFloat(inputDistance.value) || 100;
  // Hypotenuse: actual distance from camera (at eye level) to object on ground
  return Math.round(Math.sqrt(horizDist * horizDist + eyeH * eyeH));
}

function getDistanceCm() {
  if (shootingMode === 'topdown') {
    return getPhoneHeightCm();
  } else {
    return getFrontalRealDistance();
  }
}

/* ── Measure ─────────────────────────────────────────────────── */
async function measure() {
  let image;

  if (currentMode === 'upload') {
    if (!uploadedImageB64) { showToast('Carica prima un\'immagine.'); return; }
    image = uploadedImageB64;
  } else {
    if (!stream) { showToast('Avvia prima la fotocamera.'); return; }
    doFlash();
    image = captureFrame();
  }

  const heightCm = getDistanceCm();
  const hFovDeg = parseFloat(inputFov.value) || 70;

  btnMeasure.disabled = true;
  btnMeasure.classList.add('show-spin');
  resultCard.classList.remove('visible');
  setEditorMode(false);

  try {
    const res = await fetch('/measure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: image,
        height_cm: heightCm,
        h_fov_deg: hFovDeg,
      }),
    });
    const data = await res.json();

    if (data.error) { showToast(data.error); return; }

    if (data.auto_detected === false) {
      showToast('⚠️ Nessun oggetto rilevato in automatico. Regola il riquadro manualmente.', 'warn');
      setEditorMode(true);
    }

    // Store editor data for interactive editing
    editorData = {
      bbox: { x: data.bbox[0], y: data.bbox[1], w: data.bbox[2], h: data.bbox[3] },
      imgW: data.img_w,
      imgH: data.img_h,
      pxPerCmH: data.px_per_cm_h,
      pxPerCmV: data.px_per_cm_v,
    };

    // Show original image as background
    editorBg.src = data.original_image;
    editorBg.onload = () => {
      // Wait for layout to settle before drawing canvas
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          initEditorCanvas();
          drawBbox();
        });
      });
    };

    updateDimensionDisplay(data.width_cm, data.height_cm, data.px_w, data.px_h);

    resultCard.classList.add('visible');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    showToast('Errore di rete.');
  } finally {
    btnMeasure.disabled = false;
    btnMeasure.classList.remove('show-spin');
  }
}

function updateDimensionDisplay(wCm, hCm, pxW, pxH) {
  document.getElementById('res-width').textContent = wCm;
  document.getElementById('res-height').textContent = hCm;
  document.getElementById('res-px').textContent =
    `Dimensione in pixel: ${pxW} × ${pxH} px`;
}

/* ── Editor Canvas ────────────────────────────────────────────── */
const HANDLE_SIZE = 15;
const GOLD = '#d4a853';
const GOLD_FILL = 'rgba(212, 168, 83, 0.15)';

function initEditorCanvas() {
  // Match canvas pixel size to the actual displayed size of the wrapper
  const rect = editorWrapper.getBoundingClientRect();
  editorCanvas.width = rect.width;
  editorCanvas.height = rect.height;
}

/**
 * Compute the actual displayed image rect within the wrapper,
 * accounting for object-fit: contain letterboxing.
 */
function getImageDisplayRect() {
  const wrapperRect = editorWrapper.getBoundingClientRect();
  const wW = wrapperRect.width;
  const wH = wrapperRect.height;

  if (!editorData || !editorData.imgW || !editorData.imgH) {
    return { x: 0, y: 0, w: wW, h: wH };
  }

  const imgAspect = editorData.imgW / editorData.imgH;
  const wrapperAspect = wW / wH;

  let displayW, displayH, offsetX, offsetY;

  if (imgAspect > wrapperAspect) {
    // Image is wider than wrapper → fits width, letterboxed top/bottom
    displayW = wW;
    displayH = wW / imgAspect;
    offsetX = 0;
    offsetY = (wH - displayH) / 2;
  } else {
    // Image is taller/same → fits height, letterboxed left/right
    displayH = wH;
    displayW = wH * imgAspect;
    offsetX = (wW - displayW) / 2;
    offsetY = 0;
  }

  return { x: offsetX, y: offsetY, w: displayW, h: displayH };
}

function imgToCanvas(x, y) {
  if (!editorData) return { x: 0, y: 0 };
  const disp = getImageDisplayRect();
  const scaleX = disp.w / editorData.imgW;
  const scaleY = disp.h / editorData.imgH;
  return { x: disp.x + x * scaleX, y: disp.y + y * scaleY };
}

function canvasToImg(cx, cy) {
  if (!editorData) return { x: 0, y: 0 };
  const disp = getImageDisplayRect();
  const scaleX = editorData.imgW / disp.w;
  const scaleY = editorData.imgH / disp.h;
  return { x: (cx - disp.x) * scaleX, y: (cy - disp.y) * scaleY };
}

function drawBbox() {
  if (!editorData) return;
  const ctx = editorCanvas.getContext('2d');
  const rect = editorWrapper.getBoundingClientRect();
  editorCanvas.width = rect.width;
  editorCanvas.height = rect.height;
  ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);

  const b = editorData.bbox;
  const tl = imgToCanvas(b.x, b.y);
  const br = imgToCanvas(b.x + b.w, b.y + b.h);
  const cw = br.x - tl.x;
  const ch = br.y - tl.y;

  // Semi-transparent fill
  ctx.fillStyle = GOLD_FILL;
  ctx.fillRect(tl.x, tl.y, cw, ch);

  // Rectangle border
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.strokeRect(tl.x, tl.y, cw, ch);

  // Corner accents
  const cornerLen = Math.max(10, Math.min(cw, ch) / 5);
  ctx.lineWidth = 4;
  // Top-left
  ctx.beginPath(); ctx.moveTo(tl.x, tl.y + cornerLen); ctx.lineTo(tl.x, tl.y); ctx.lineTo(tl.x + cornerLen, tl.y); ctx.stroke();
  // Top-right
  ctx.beginPath(); ctx.moveTo(br.x - cornerLen, tl.y); ctx.lineTo(br.x, tl.y); ctx.lineTo(br.x, tl.y + cornerLen); ctx.stroke();
  // Bottom-left
  ctx.beginPath(); ctx.moveTo(tl.x, br.y - cornerLen); ctx.lineTo(tl.x, br.y); ctx.lineTo(tl.x + cornerLen, br.y); ctx.stroke();
  // Bottom-right
  ctx.beginPath(); ctx.moveTo(br.x - cornerLen, br.y); ctx.lineTo(br.x, br.y); ctx.lineTo(br.x, br.y - cornerLen); ctx.stroke();
  ctx.lineWidth = 2;

  // Dimension labels
  const wCm = (b.w / editorData.pxPerCmH).toFixed(1);
  const hCm = (b.h / editorData.pxPerCmV).toFixed(1);

  ctx.font = '600 13px Inter, sans-serif';

  // Width label (bottom center)
  const wLabel = `${wCm} cm`;
  const wMetrics = ctx.measureText(wLabel);
  const wLabelX = tl.x + (cw - wMetrics.width) / 2;
  const wLabelY = br.y + 18;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(wLabelX - 4, wLabelY - 14, wMetrics.width + 8, 20);
  ctx.fillStyle = GOLD;
  ctx.fillText(wLabel, wLabelX, wLabelY);

  // Height label (right center)
  const hLabel = `${hCm} cm`;
  const hMetrics = ctx.measureText(hLabel);
  const hLabelX = br.x + 8;
  const hLabelY = tl.y + ch / 2 + 5;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(hLabelX - 4, hLabelY - 14, hMetrics.width + 8, 20);
  ctx.fillStyle = GOLD;
  ctx.fillText(hLabel, hLabelX, hLabelY);

  if (!editorActive) return;

  // Draw handles when editing
  ctx.fillStyle = GOLD;
  const handles = getHandles(tl, br);
  for (const h of handles) {
    ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }
}

function getHandles(tl, br) {
  const mx = (tl.x + br.x) / 2;
  const my = (tl.y + br.y) / 2;
  return [
    { x: tl.x, y: tl.y, type: 'tl' },
    { x: br.x, y: tl.y, type: 'tr' },
    { x: tl.x, y: br.y, type: 'bl' },
    { x: br.x, y: br.y, type: 'br' },
    { x: mx, y: tl.y, type: 'tm' },
    { x: mx, y: br.y, type: 'bm' },
    { x: tl.x, y: my, type: 'ml' },
    { x: br.x, y: my, type: 'mr' },
  ];
}

function hitTestHandle(cx, cy) {
  if (!editorData) return null;
  const b = editorData.bbox;
  const tl = imgToCanvas(b.x, b.y);
  const br = imgToCanvas(b.x + b.w, b.y + b.h);
  const handles = getHandles(tl, br);
  const hitRadius = HANDLE_SIZE + 6;
  for (const h of handles) {
    if (Math.abs(cx - h.x) < hitRadius && Math.abs(cy - h.y) < hitRadius) {
      return h.type;
    }
  }
  // Check if inside bbox for move
  if (cx >= tl.x && cx <= br.x && cy >= tl.y && cy <= br.y) {
    return 'move';
  }
  return null;
}

function getCursorForHandle(type) {
  const cursors = {
    tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize',
    tm: 'ns-resize', bm: 'ns-resize', ml: 'ew-resize', mr: 'ew-resize',
    move: 'move',
  };
  return cursors[type] || 'default';
}

/* ── Editor toggle ────────────────────────────────────────────── */
function setEditorMode(active) {
  editorActive = active;
  btnEditToggle.textContent = active ? '✅ Fatto' : '✏️ Modifica riquadro';
  editHint.style.display = active ? '' : 'none';
  editorCanvas.style.pointerEvents = active ? 'auto' : 'none';
  editorCanvas.style.cursor = active ? 'crosshair' : 'default';
  drawBbox();
}

btnEditToggle.addEventListener('click', () => {
  setEditorMode(!editorActive);
});

/* ── Editor drag interaction ──────────────────────────────────── */
function getEventPos(e) {
  const rect = editorCanvas.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

function onDragStart(e) {
  if (!editorActive || !editorData) return;
  e.preventDefault();
  const pos = getEventPos(e);
  const handleType = hitTestHandle(pos.x, pos.y);
  if (!handleType) return;

  dragState = {
    type: handleType,
    startX: pos.x,
    startY: pos.y,
    origBbox: { ...editorData.bbox },
  };
}

function onDragMove(e) {
  if (!editorActive || !editorData) return;

  const pos = getEventPos(e);

  // Update cursor
  if (!dragState) {
    const ht = hitTestHandle(pos.x, pos.y);
    editorCanvas.style.cursor = ht ? getCursorForHandle(ht) : 'crosshair';
    return;
  }

  e.preventDefault();

  // Convert canvas-space delta to image-space delta
  const startImg = canvasToImg(dragState.startX, dragState.startY);
  const curImg = canvasToImg(pos.x, pos.y);
  const dix = curImg.x - startImg.x;
  const diy = curImg.y - startImg.y;

  const ob = dragState.origBbox;
  const b = editorData.bbox;
  const MIN_SIZE = 10;

  switch (dragState.type) {
    case 'move':
      b.x = Math.max(0, Math.min(editorData.imgW - ob.w, ob.x + dix));
      b.y = Math.max(0, Math.min(editorData.imgH - ob.h, ob.y + diy));
      b.w = ob.w;
      b.h = ob.h;
      break;
    case 'tl':
      b.x = Math.min(ob.x + ob.w - MIN_SIZE, Math.max(0, ob.x + dix));
      b.y = Math.min(ob.y + ob.h - MIN_SIZE, Math.max(0, ob.y + diy));
      b.w = ob.x + ob.w - b.x;
      b.h = ob.y + ob.h - b.y;
      break;
    case 'tr':
      b.y = Math.min(ob.y + ob.h - MIN_SIZE, Math.max(0, ob.y + diy));
      b.w = Math.max(MIN_SIZE, Math.min(editorData.imgW - ob.x, ob.w + dix));
      b.h = ob.y + ob.h - b.y;
      break;
    case 'bl':
      b.x = Math.min(ob.x + ob.w - MIN_SIZE, Math.max(0, ob.x + dix));
      b.w = ob.x + ob.w - b.x;
      b.h = Math.max(MIN_SIZE, Math.min(editorData.imgH - ob.y, ob.h + diy));
      break;
    case 'br':
      b.w = Math.max(MIN_SIZE, Math.min(editorData.imgW - ob.x, ob.w + dix));
      b.h = Math.max(MIN_SIZE, Math.min(editorData.imgH - ob.y, ob.h + diy));
      break;
    case 'tm':
      b.y = Math.min(ob.y + ob.h - MIN_SIZE, Math.max(0, ob.y + diy));
      b.h = ob.y + ob.h - b.y;
      break;
    case 'bm':
      b.h = Math.max(MIN_SIZE, Math.min(editorData.imgH - ob.y, ob.h + diy));
      break;
    case 'ml':
      b.x = Math.min(ob.x + ob.w - MIN_SIZE, Math.max(0, ob.x + dix));
      b.w = ob.x + ob.w - b.x;
      break;
    case 'mr':
      b.w = Math.max(MIN_SIZE, Math.min(editorData.imgW - ob.x, ob.w + dix));
      break;
  }

  // Live recalculation
  const wCm = (b.w / editorData.pxPerCmH).toFixed(1);
  const hCm = (b.h / editorData.pxPerCmV).toFixed(1);
  updateDimensionDisplay(wCm, hCm, Math.round(b.w), Math.round(b.h));
  drawBbox();
}

function onDragEnd() {
  if (dragState) {
    dragState = null;
  }
}

// Mouse events
editorCanvas.addEventListener('mousedown', onDragStart);
window.addEventListener('mousemove', onDragMove);
window.addEventListener('mouseup', onDragEnd);

// Touch events
editorCanvas.addEventListener('touchstart', onDragStart, { passive: false });
window.addEventListener('touchmove', onDragMove, { passive: false });
window.addEventListener('touchend', onDragEnd);

// Resize observer
new ResizeObserver(() => {
  if (editorData) {
    initEditorCanvas();
    drawBbox();
  }
}).observe(editorWrapper);

/* ── Toast ───────────────────────────────────────────────────── */
function showToast(msg, type) {
  toastMsg.textContent = msg;
  toast.style.background = type === 'ok' ? '#0d1f15' : '#2a1515';
  toast.style.borderColor = type === 'ok' ? 'rgba(76,175,119,0.4)' : 'rgba(224,89,89,0.4)';
  toast.style.color = type === 'ok' ? '#4caf77' : '#e05959';
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

/* ── Event listeners ─────────────────────────────────────────── */
btnStart.addEventListener('click', startCamera);
btnMeasure.addEventListener('click', measure);
