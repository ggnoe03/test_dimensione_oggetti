/* ═══════════════════════════════════════════════════════════════
   ObjectMeter — Frontend Script

   Gestisce:
   1. Upload/drop immagine
   2. Disegno bounding box via Canvas (mouse + touch)
   3. Invio dati al backend e visualizzazione risultati
   4. Modalità editing: spostamento e ridimensionamento bbox
   ═══════════════════════════════════════════════════════════════ */

/* ── State ───────────────────────────────────────────────────── */
let loadedImage = null;       // HTMLImageElement caricata
let imageB64 = null;          // base64 string dell'immagine
let drawState = null;         // { startX, startY } durante il drag
let userBbox = null;          // { x, y, w, h } in coordinate immagine
let canvasScale = 1;          // rapporto canvas_display / image_real
let savedImagePath = null;    // percorso immagine salvata dal backend
let pxPerCm = null;           // ratio pixel/cm calcolato dal backend
let canvasLocked = false;     // true dopo auto-detect, impedisce disegno manuale

// ── Edit mode state ──
let editMode = false;
let editBbox = null;          // { x, y, w, h } bbox in edit mode
let editDragState = null;     // { type: 'move'|'resize-XX', offsetX, offsetY }
let editOriginalImage = null; // HTMLImageElement dell'immagine originale per edit
const HANDLE_SIZE = 14;       // dimensione handle in pixel CSS

/* ── DOM refs ────────────────────────────────────────────────── */
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const canvasWrapper = document.getElementById('canvas-wrapper');
const mainCanvas = document.getElementById('main-canvas');
const canvasHint = document.getElementById('canvas-hint');
const actionBar = document.getElementById('action-bar');
const btnClear = document.getElementById('btn-clear');
const btnMeasure = document.getElementById('btn-measure');
const resultCard = document.getElementById('result-card');
const annotatedWrapper = document.getElementById('annotated-wrapper');
const annotatedImg = document.getElementById('annotated-img');
const refInfo = document.getElementById('ref-info');
const refBadge = document.getElementById('ref-badge');
const detectionsDetails = document.getElementById('detections-details');
const detectionsList = document.getElementById('detections-list');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toast-msg');

// Edit mode elements
const editCanvasWrapper = document.getElementById('edit-canvas-wrapper');
const editCanvas = document.getElementById('edit-canvas');
const editActionBar = document.getElementById('edit-action-bar');
const editBar = document.getElementById('edit-bar');
const btnEdit = document.getElementById('btn-edit');
const btnSaveEdit = document.getElementById('btn-save-edit');
const btnCancelEdit = document.getElementById('btn-cancel-edit');

let toastTimer = null;

// Camera DOM refs
const btnCamera = document.getElementById('btn-camera');
const cameraActionWrapper = document.getElementById('camera-action-wrapper');
const cameraModal = document.getElementById('camera-modal');
const cameraStream = document.getElementById('camera-stream');
const btnTakePhoto = document.getElementById('btn-take-photo');
const btnCloseCamera = document.getElementById('btn-close-camera');
let cameraMediaStream = null;

/* ── File upload / drop ──────────────────────────────────────── */
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
    imageB64 = e.target.result;
    const img = new Image();
    img.onload = () => {
      loadedImage = img;
      initCanvas();
      dropZone.style.display = 'none';
      cameraActionWrapper.style.display = 'none';
      canvasWrapper.style.display = 'block';
      actionBar.style.display = 'flex';
      resultCard.classList.remove('visible');
      userBbox = null;
      pxPerCm = null;
      canvasLocked = false;
      btnMeasure.disabled = true;
      btnMeasure.style.display = '';
      mainCanvas.style.cursor = 'crosshair';
      exitEditMode();
      autoDetect();
    };
    img.src = imageB64;
  };
  reader.readAsDataURL(file);
}

/* ── Clear / new photo ───────────────────────────────────────── */
btnClear.addEventListener('click', () => {
  loadedImage = null;
  imageB64 = null;
  userBbox = null;
  savedImagePath = null;
  pxPerCm = null;
  canvasLocked = false;
  fileInput.value = '';
  canvasWrapper.style.display = 'none';
  actionBar.style.display = 'none';
  dropZone.style.display = 'flex';
  cameraActionWrapper.style.display = 'flex';
  resultCard.classList.remove('visible');
  canvasHint.classList.remove('hidden');
  btnMeasure.disabled = true;
  exitEditMode();
});

/* ── Camera feature ──────────────────────────────────────────── */
btnCamera.addEventListener('click', openCamera);
btnCloseCamera.addEventListener('click', closeCamera);
btnTakePhoto.addEventListener('click', takePhoto);

async function openCamera() {
  try {
    cameraMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    cameraStream.srcObject = cameraMediaStream;
    cameraModal.style.display = 'flex';
  } catch (err) {
    showToast('Impossibile accedere alla fotocamera. Verifica i permessi.');
  }
}

function closeCamera() {
  if (cameraMediaStream) {
    cameraMediaStream.getTracks().forEach(track => track.stop());
    cameraMediaStream = null;
  }
  cameraModal.style.display = 'none';
}

function takePhoto() {
  if (!cameraStream.videoWidth) return;

  const canvas = document.createElement('canvas');
  canvas.width = cameraStream.videoWidth;
  canvas.height = cameraStream.videoHeight;
  const ctx = canvas.getContext('2d');

  // Rovesciamo l'immagine in caso di fotocamera frontale (selfie), ma qui usiamo environment quindi no
  ctx.drawImage(cameraStream, 0, 0);

  imageB64 = canvas.toDataURL('image/jpeg', 0.9);

  const img = new Image();
  img.onload = () => {
    loadedImage = img;
    initCanvas();
    dropZone.style.display = 'none';
    cameraActionWrapper.style.display = 'none';
    canvasWrapper.style.display = 'block';
    actionBar.style.display = 'flex';
    resultCard.classList.remove('visible');
    userBbox = null;
    pxPerCm = null;
    canvasLocked = false;
    btnMeasure.disabled = true;
    btnMeasure.style.display = '';
    mainCanvas.style.cursor = 'crosshair';
    exitEditMode();
    autoDetect();
  };
  img.src = imageB64;

  closeCamera();
}

/* ── Canvas setup ────────────────────────────────────────────── */
function initCanvas() {
  if (!loadedImage) return;

  // Imposta la dimensione del canvas alla dimensione reale dell'immagine
  mainCanvas.width = loadedImage.naturalWidth;
  mainCanvas.height = loadedImage.naturalHeight;

  canvasScale = mainCanvas.width / mainCanvas.getBoundingClientRect().width;
  drawCanvas();
}

function drawCanvas() {
  const ctx = mainCanvas.getContext('2d');
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);

  // Disegna l'immagine
  ctx.drawImage(loadedImage, 0, 0);

  // Disegna il bounding box dell'utente (se presente)
  if (userBbox) {
    const { x, y, w, h } = userBbox;

    // Overlay semitrasparente fuori dal bbox
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    // Sopra
    ctx.fillRect(0, 0, mainCanvas.width, y);
    // Sotto
    ctx.fillRect(0, y + h, mainCanvas.width, mainCanvas.height - y - h);
    // Sinistra
    ctx.fillRect(0, y, x, h);
    // Destra
    ctx.fillRect(x + w, y, mainCanvas.width - x - w, h);

    // Rettangolo dorato
    const lineW = Math.max(2, Math.min(mainCanvas.width, mainCanvas.height) / 200);
    ctx.strokeStyle = '#d4a853';
    ctx.lineWidth = lineW;
    ctx.strokeRect(x, y, w, h);

    // Angoli accentuati
    const cornerLen = Math.max(12, Math.min(w, h) / 5);
    ctx.lineWidth = lineW * 2.5;

    // Top-left
    ctx.beginPath(); ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y); ctx.stroke();
    // Top-right
    ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen); ctx.stroke();
    // Bottom-left
    ctx.beginPath(); ctx.moveTo(x, y + h - cornerLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLen, y + h); ctx.stroke();
    // Bottom-right
    ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerLen); ctx.stroke();

    // Dimensioni in pixel
    ctx.lineWidth = 1;
    const fontSize = Math.max(14, Math.min(mainCanvas.width, mainCanvas.height) / 40);
    ctx.font = `600 ${fontSize}px Inter, sans-serif`;
    const label = pxPerCm ? `${(w / pxPerCm).toFixed(1)} × ${(h / pxPerCm).toFixed(1)} cm` : `${Math.round(w)} × ${Math.round(h)} px`;
    const metrics = ctx.measureText(label);
    const lx = x + (w - metrics.width) / 2;
    const ly = y + h + fontSize + 8;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(lx - 6, ly - fontSize - 2, metrics.width + 12, fontSize + 10);
    ctx.fillStyle = '#d4a853';
    ctx.fillText(label, lx, ly);
  }
}

/* ── Canvas interaction (mouse + touch) ──────────────────────── */
function getCanvasPos(e) {
  const rect = mainCanvas.getBoundingClientRect();
  const scaleX = mainCanvas.width / rect.width;
  const scaleY = mainCanvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

mainCanvas.addEventListener('mousedown', onDrawStart);
mainCanvas.addEventListener('touchstart', onDrawStart, { passive: false });

function onDrawStart(e) {
  if (!loadedImage || canvasLocked) return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  drawState = { startX: pos.x, startY: pos.y };
  userBbox = null;
  canvasHint.classList.add('hidden');
}

function onDrawMove(e) {
  if (!drawState) return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  const x = Math.min(drawState.startX, pos.x);
  const y = Math.min(drawState.startY, pos.y);
  const w = Math.abs(pos.x - drawState.startX);
  const h = Math.abs(pos.y - drawState.startY);
  userBbox = { x, y, w, h };
  drawCanvas();
}

function onDrawEnd() {
  if (!drawState) return;
  drawState = null;
  // Abilita il pulsante solo se il bbox è abbastanza grande
  if (userBbox && userBbox.w > 5 && userBbox.h > 5) {
    btnMeasure.disabled = false;
  } else {
    userBbox = null;
    btnMeasure.disabled = true;
    drawCanvas();
  }
}

window.addEventListener('mousemove', onDrawMove);
window.addEventListener('mouseup', onDrawEnd);
window.addEventListener('touchmove', onDrawMove, { passive: false });
window.addEventListener('touchend', onDrawEnd);

// Aggiorna la scala quando la finestra cambia dimensione
window.addEventListener('resize', () => {
  if (loadedImage) {
    canvasScale = mainCanvas.width / mainCanvas.getBoundingClientRect().width;
  }
});

/* ── Measure ─────────────────────────────────────────────────── */
btnMeasure.addEventListener('click', measure);

async function measure() {
  if (!imageB64 || !userBbox) return;

  btnMeasure.disabled = true;
  btnMeasure.classList.add('show-spin');
  resultCard.classList.remove('visible');
  exitEditMode();

  try {
    const res = await fetch('/measure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageB64,
        bbox_x: userBbox.x,
        bbox_y: userBbox.y,
        bbox_w: userBbox.w,
        bbox_h: userBbox.h,
      }),
    });
    const data = await res.json();

    // Salva il path dell'immagine persistita
    if (data.saved_path) {
      savedImagePath = data.saved_path;
    }

    if (data.error) {
      showToast(data.error);
      // Mostra comunque l'immagine annotata se presente
      if (data.annotated_image) {
        annotatedImg.src = data.annotated_image;
        annotatedWrapper.style.display = 'block';
        resultCard.classList.add('visible');
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      // Mostra pulsante Modifica anche in caso di errore (se abbiamo saved_path)
      if (savedImagePath) {
        editBar.style.display = 'flex';
      }
      return;
    }

    if (data.px_per_cm) {
      pxPerCm = data.px_per_cm;
    }
    showResults(data);

  } catch (e) {
    showToast('Errore di rete: ' + e.message);
  } finally {
    btnMeasure.disabled = false;
    btnMeasure.classList.remove('show-spin');
  }
}

/* ── Auto Detect — chiamato automaticamente al caricamento immagine ── */
async function autoDetect() {
  if (!imageB64) return;

  btnMeasure.disabled = true;
  btnMeasure.classList.add('show-spin');
  canvasHint.textContent = '🔍 Rilevamento automatico in corso…';
  canvasHint.classList.remove('hidden');

  try {
    const res = await fetch('/auto_detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageB64 }),
    });
    const data = await res.json();

    // Salva il path dell'immagine persistita
    if (data.saved_path) {
      savedImagePath = data.saved_path;
    }

    if (data.error) {
      // Se c'è un bbox rilevato ma senza misure, mostralo comunque
      if (data.bbox_x !== undefined) {
        userBbox = {
          x: data.bbox_x,
          y: data.bbox_y,
          w: data.bbox_w,
          h: data.bbox_h,
        };
        drawCanvas();
        btnMeasure.disabled = false;
      }
      showToast(data.error);
      canvasHint.textContent = '✏️ Clicca e trascina per disegnare il rettangolo sull\'oggetto da misurare';
      canvasHint.classList.add('hidden');
      return;
    }

    // Imposta bbox auto-rilevato
    userBbox = {
      x: data.bbox_x,
      y: data.bbox_y,
      w: data.bbox_w,
      h: data.bbox_h,
    };

    if (data.px_per_cm) {
      pxPerCm = data.px_per_cm;
    }

    // Disegna il bbox sul canvas
    drawCanvas();
    canvasHint.classList.add('hidden');
    canvasLocked = true;
    mainCanvas.style.cursor = 'default';

    // Nascondi il pulsante Misura (auto-detect lo sostituisce)
    btnMeasure.style.display = 'none';

    // Mostra i risultati
    showResults(data);

    // Carica immagine originale per l'editing
    editOriginalImage = new Image();
    editOriginalImage.src = imageB64;

    btnMeasure.disabled = false;

  } catch (e) {
    showToast('Errore di rete: ' + e.message);
    canvasHint.textContent = '✏️ Clicca e trascina per disegnare il rettangolo sull\'oggetto da misurare';
    canvasHint.classList.add('hidden');
  } finally {
    btnMeasure.classList.remove('show-spin');
  }
}

/* ── Show results ────────────────────────────────────────────── */
function showResults(data) {
  // Mostra risultati
  document.getElementById('res-width').textContent = data.width_cm;
  document.getElementById('res-height').textContent = data.height_cm;

  // Immagine annotata
  annotatedImg.src = data.annotated_image;
  annotatedWrapper.style.display = 'block';

  // Info oggetto di riferimento
  refBadge.textContent = `★ Riferimento: ${data.reference_object} (confidenza: ${Math.round(data.reference_confidence * 100)}%)`;
  refInfo.style.display = 'block';

  // Lista detections
  if (data.all_detections && data.all_detections.length > 0) {
    detectionsList.innerHTML = '';
    for (const det of data.all_detections) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${det.name}</span><span class="det-conf">${Math.round(det.confidence * 100)}%</span>`;
      detectionsList.appendChild(li);
    }
    detectionsDetails.style.display = 'block';
  } else {
    detectionsDetails.style.display = 'none';
  }

  // Pulsante Modifica
  if (savedImagePath) {
    editBar.style.display = 'flex';
  }

  resultCard.classList.add('visible');
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


/* ══════════════════════════════════════════════════════════════
   EDIT MODE — Bounding Box trascinabile e ridimensionabile
   ══════════════════════════════════════════════════════════════ */

btnEdit.addEventListener('click', enterEditMode);
btnCancelEdit.addEventListener('click', exitEditMode);
btnSaveEdit.addEventListener('click', saveEdit);

function enterEditMode() {
  editMode = true;
  // Usa il bbox corrente come punto di partenza
  editBbox = userBbox ? { ...userBbox } : { x: 50, y: 50, w: 200, h: 200 };

  // Carica l'immagine originale nel canvas di editing
  if (!editOriginalImage && imageB64) {
    editOriginalImage = new Image();
    editOriginalImage.src = imageB64;
  }

  // Nascondi immagine annotata, mostra canvas di editing
  annotatedWrapper.style.display = 'none';
  editCanvasWrapper.style.display = 'block';
  editActionBar.style.display = 'flex';
  editBar.style.display = 'none';

  // Attendi che l'immagine sia caricata per inizializzare il canvas
  if (editOriginalImage && editOriginalImage.complete) {
    initEditCanvas();
  } else if (editOriginalImage) {
    editOriginalImage.onload = () => initEditCanvas();
  }
}

function exitEditMode() {
  editMode = false;
  editDragState = null;
  editCanvasWrapper.style.display = 'none';
  editActionBar.style.display = 'none';
}

function initEditCanvas() {
  if (!editOriginalImage) return;
  editCanvas.width = editOriginalImage.naturalWidth;
  editCanvas.height = editOriginalImage.naturalHeight;
  drawEditCanvas();
}

function drawEditCanvas() {
  const ctx = editCanvas.getContext('2d');
  ctx.clearRect(0, 0, editCanvas.width, editCanvas.height);

  // Immagine di sfondo
  ctx.drawImage(editOriginalImage, 0, 0);

  if (!editBbox) return;

  const { x, y, w, h } = editBbox;

  // Overlay semitrasparente fuori dal bbox
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, editCanvas.width, y);
  ctx.fillRect(0, y + h, editCanvas.width, editCanvas.height - y - h);
  ctx.fillRect(0, y, x, h);
  ctx.fillRect(x + w, y, editCanvas.width - x - w, h);

  // Rettangolo principale
  const lineW = Math.max(2, Math.min(editCanvas.width, editCanvas.height) / 200);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = lineW;
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Angoli accentuati
  const cornerLen = Math.max(12, Math.min(w, h) / 5);
  ctx.lineWidth = lineW * 2.5;
  ctx.strokeStyle = '#38bdf8';

  ctx.beginPath(); ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y + h - cornerLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLen, y + h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerLen); ctx.stroke();

  // Handle di ridimensionamento (cerchi agli angoli)
  const handleR = Math.max(6, Math.min(editCanvas.width, editCanvas.height) / 100);
  const handles = [
    { cx: x, cy: y },  // TL
    { cx: x + w, cy: y },  // TR
    { cx: x, cy: y + h },  // BL
    { cx: x + w, cy: y + h },  // BR
  ];

  for (const hl of handles) {
    ctx.beginPath();
    ctx.arc(hl.cx, hl.cy, handleR, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Label dimensioni
  ctx.lineWidth = 1;
  const fontSize = Math.max(14, Math.min(editCanvas.width, editCanvas.height) / 40);
  ctx.font = `600 ${fontSize}px Inter, sans-serif`;
  const label = pxPerCm ? `${(w / pxPerCm).toFixed(1)} × ${(h / pxPerCm).toFixed(1)} cm` : `${Math.round(w)} × ${Math.round(h)} px`;
  const metrics = ctx.measureText(label);
  const lx = x + (w - metrics.width) / 2;
  const ly = y + h + fontSize + 8;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(lx - 6, ly - fontSize - 2, metrics.width + 12, fontSize + 10);
  ctx.fillStyle = '#38bdf8';
  ctx.fillText(label, lx, ly);
}

/* ── Edit Canvas interaction ─────────────────────────────────── */
function getEditCanvasPos(e) {
  const rect = editCanvas.getBoundingClientRect();
  const scaleX = editCanvas.width / rect.width;
  const scaleY = editCanvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function getHandleHitZone(pos) {
  if (!editBbox) return null;
  const { x, y, w, h } = editBbox;
  const hitR = Math.max(15, Math.min(editCanvas.width, editCanvas.height) / 60);
  const corners = [
    { name: 'tl', cx: x, cy: y },
    { name: 'tr', cx: x + w, cy: y },
    { name: 'bl', cx: x, cy: y + h },
    { name: 'br', cx: x + w, cy: y + h },
  ];
  for (const c of corners) {
    const dist = Math.sqrt((pos.x - c.cx) ** 2 + (pos.y - c.cy) ** 2);
    if (dist <= hitR) return c.name;
  }
  // Check if inside bbox for move
  if (pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h) {
    return 'move';
  }
  return null;
}

editCanvas.addEventListener('mousedown', onEditStart);
editCanvas.addEventListener('touchstart', onEditStart, { passive: false });

function onEditStart(e) {
  if (!editMode || !editBbox) return;
  e.preventDefault();
  const pos = getEditCanvasPos(e);
  const hit = getHandleHitZone(pos);
  if (!hit) return;

  editDragState = {
    type: hit,
    startX: pos.x,
    startY: pos.y,
    origBbox: { ...editBbox },
  };
}

function onEditMove(e) {
  if (!editMode || !editDragState || !editBbox) return;
  e.preventDefault();
  const pos = getEditCanvasPos(e);
  const dx = pos.x - editDragState.startX;
  const dy = pos.y - editDragState.startY;
  const ob = editDragState.origBbox;

  if (editDragState.type === 'move') {
    editBbox.x = Math.max(0, Math.min(ob.x + dx, editCanvas.width - ob.w));
    editBbox.y = Math.max(0, Math.min(ob.y + dy, editCanvas.height - ob.h));
  } else if (editDragState.type === 'br') {
    editBbox.w = Math.max(20, ob.w + dx);
    editBbox.h = Math.max(20, ob.h + dy);
  } else if (editDragState.type === 'bl') {
    const newX = ob.x + dx;
    editBbox.x = Math.max(0, newX);
    editBbox.w = Math.max(20, ob.w - dx);
    editBbox.h = Math.max(20, ob.h + dy);
  } else if (editDragState.type === 'tr') {
    const newY = ob.y + dy;
    editBbox.y = Math.max(0, newY);
    editBbox.w = Math.max(20, ob.w + dx);
    editBbox.h = Math.max(20, ob.h - dy);
  } else if (editDragState.type === 'tl') {
    const newX = ob.x + dx;
    const newY = ob.y + dy;
    editBbox.x = Math.max(0, newX);
    editBbox.y = Math.max(0, newY);
    editBbox.w = Math.max(20, ob.w - dx);
    editBbox.h = Math.max(20, ob.h - dy);
  }

  drawEditCanvas();
}

function onEditEnd() {
  editDragState = null;
}

// Cursor update for edit canvas
editCanvas.addEventListener('mousemove', (e) => {
  if (editDragState) {
    onEditMove(e);
    return;
  }
  if (!editMode || !editBbox) return;
  const pos = getEditCanvasPos(e);
  const hit = getHandleHitZone(pos);
  if (hit === 'tl' || hit === 'br') editCanvas.style.cursor = 'nwse-resize';
  else if (hit === 'tr' || hit === 'bl') editCanvas.style.cursor = 'nesw-resize';
  else if (hit === 'move') editCanvas.style.cursor = 'move';
  else editCanvas.style.cursor = 'crosshair';
});

window.addEventListener('mousemove', (e) => {
  if (editMode && editDragState) onEditMove(e);
});
window.addEventListener('mouseup', onEditEnd);
window.addEventListener('touchmove', (e) => {
  if (editMode && editDragState) onEditMove(e);
}, { passive: false });
window.addEventListener('touchend', onEditEnd);


/* ── Save edit (remeasure) ───────────────────────────────────── */
async function saveEdit() {
  if (!savedImagePath || !editBbox) return;

  btnSaveEdit.disabled = true;
  btnSaveEdit.classList.add('show-spin');

  try {
    const res = await fetch('/remeasure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        saved_path: savedImagePath,
        bbox_x: editBbox.x,
        bbox_y: editBbox.y,
        bbox_w: editBbox.w,
        bbox_h: editBbox.h,
      }),
    });
    const data = await res.json();

    // Aggiorna il saved_path se restituito
    if (data.saved_path) {
      savedImagePath = data.saved_path;
    }

    // Aggiorna il userBbox con il nuovo
    userBbox = { ...editBbox };

    // Esci dalla modalità editing
    exitEditMode();

    if (data.error) {
      showToast(data.error);
      // Mostra immagine annotata anche in caso di errore
      if (data.annotated_image) {
        annotatedImg.src = data.annotated_image;
        annotatedWrapper.style.display = 'block';
      }
      // Resetta dimensioni
      document.getElementById('res-width').textContent = '—';
      document.getElementById('res-height').textContent = '—';
      refInfo.style.display = 'none';
      detectionsDetails.style.display = 'none';
      // Ripristina pulsante modifica
      editBar.style.display = 'flex';
      return;
    }
    if (data.px_per_cm) {
      pxPerCm = data.px_per_cm;
    }
    showResults(data);

  } catch (e) {
    showToast('Errore di rete: ' + e.message);
  } finally {
    btnSaveEdit.disabled = false;
    btnSaveEdit.classList.remove('show-spin');
  }
}

/* ── Toast ───────────────────────────────────────────────────── */
function showToast(msg) {
  toastMsg.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}
