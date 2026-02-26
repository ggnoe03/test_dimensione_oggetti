/* ═══════════════════════════════════════════════════════════════
   ObjectMeter — Frontend Script
   
   Gestisce:
   1. Upload/drop immagine
   2. Disegno bounding box via Canvas (mouse + touch)
   3. Invio dati al backend e visualizzazione risultati
   ═══════════════════════════════════════════════════════════════ */

/* ── State ───────────────────────────────────────────────────── */
let loadedImage = null;       // HTMLImageElement caricata
let imageB64 = null;          // base64 string dell'immagine
let drawState = null;         // { startX, startY } durante il drag
let userBbox = null;          // { x, y, w, h } in coordinate immagine
let canvasScale = 1;          // rapporto canvas_display / image_real

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

let toastTimer = null;

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
      canvasWrapper.style.display = 'block';
      actionBar.style.display = 'flex';
      resultCard.classList.remove('visible');
      userBbox = null;
      btnMeasure.disabled = true;
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
  fileInput.value = '';
  canvasWrapper.style.display = 'none';
  actionBar.style.display = 'none';
  dropZone.style.display = 'flex';
  resultCard.classList.remove('visible');
  canvasHint.classList.remove('hidden');
  btnMeasure.disabled = true;
});

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
    const label = `${Math.round(w)} × ${Math.round(h)} px`;
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
  if (!loadedImage) return;
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

    if (data.error) {
      showToast(data.error);
      // Mostra comunque l'immagine annotata se presente
      if (data.annotated_image) {
        annotatedImg.src = data.annotated_image;
        annotatedWrapper.style.display = 'block';
        resultCard.classList.add('visible');
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }

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

    resultCard.classList.add('visible');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (e) {
    showToast('Errore di rete: ' + e.message);
  } finally {
    btnMeasure.disabled = false;
    btnMeasure.classList.remove('show-spin');
  }
}

/* ── Toast ───────────────────────────────────────────────────── */
function showToast(msg) {
  toastMsg.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}
