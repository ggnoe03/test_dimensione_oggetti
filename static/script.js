/* ══════════════════════════════════════════════════════════════
   ObjectMeter AR — WebXR + Three.js Measurement App
   
   Flusso:
   1. L'utente avvia la sessione AR (immersive-ar + hit-test)
   2. Un mirino (reticle) si muove sulle superfici rilevate
   3. Tap 1 → posiziona punto di partenza (sfera verde)
   4. Tap 2 → posiziona punto di arrivo (sfera rossa),
              traccia linea, calcola distanza in cm
   5. Tap 3 → pulisce la scena, pronto per ricominciare
   ══════════════════════════════════════════════════════════════ */

import * as THREE from 'three';

/* ── State ───────────────────────────────────────────────────── */
let renderer, scene, camera;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let localReferenceSpace = null;

// Measurement state: 0 = waiting 1st tap, 1 = waiting 2nd tap, 2 = result shown
let measureState = 0;
let startMarker = null;
let endMarker = null;
let measureLine = null;
let sceneObjects = [];  // track objects (markers + line) for cleanup

/* ── DOM refs ────────────────────────────────────────────────── */
const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const statusMsg = document.getElementById('status');
const overlay = document.getElementById('overlay');
const measValue = document.getElementById('meas-value');
const instruction = document.getElementById('instruction');
const btnExitAR = document.getElementById('btn-exit-ar');

/* ══════════════════════════════════════════════════════════════
   INIT — Check WebXR support
   ══════════════════════════════════════════════════════════════ */

async function init() {
  if (!navigator.xr) {
    disableAR('Il tuo browser non supporta WebXR. Usa Chrome 79+ su Android.');
    return;
  }

  const supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!supported) {
    disableAR('La Realtà Aumentata (AR) non è supportata su questo dispositivo. Serve un telefono Android con Google Play Services for AR.');
    return;
  }

  // Everything OK — setup Three.js
  setupThreeJS();
  startBtn.addEventListener('click', startARSession);
}

function disableAR(msg) {
  startBtn.disabled = true;
  startBtn.textContent = 'AR non disponibile';
  statusMsg.textContent = msg;
  statusMsg.classList.add('error');
}

/* ══════════════════════════════════════════════════════════════
   THREE.JS SETUP
   ══════════════════════════════════════════════════════════════ */

function setupThreeJS() {
  // ── Scene ──
  scene = new THREE.Scene();

  // ── Camera (WebXR gestirà posizione e proiezione) ──
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  // ── Lighting ──
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
  hemiLight.position.set(0.5, 1, 0.25);
  scene.add(hemiLight);

  // ── Renderer ──
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  // ── Reticle (mirino ad anello che si appoggia sulle superfici) ──
  const reticleGeo = new THREE.RingGeometry(0.03, 0.04, 32).rotateX(-Math.PI / 2);
  const reticleMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
  });
  reticle = new THREE.Mesh(reticleGeo, reticleMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // ── Resize handler ──
  window.addEventListener('resize', onResize);
}

function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ══════════════════════════════════════════════════════════════
   START / STOP AR SESSION
   ══════════════════════════════════════════════════════════════ */

async function startARSession() {
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: overlay },
    });

    // Show overlay, hide start screen
    startScreen.style.display = 'none';
    overlay.style.display = 'flex';

    // Append renderer canvas to body
    document.body.appendChild(renderer.domElement);

    // Configure session
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);

    // Get reference space
    localReferenceSpace = await session.requestReferenceSpace('local');

    // Listen for tap (select event from XR controller)
    const controller = renderer.xr.getController(0);
    controller.addEventListener('select', onTap);
    scene.add(controller);

    // Session end cleanup
    session.addEventListener('end', onSessionEnd);

    // Exit button
    btnExitAR.onclick = () => session.end();

    // Reset state
    measureState = 0;
    hitTestSourceRequested = false;
    hitTestSource = null;
    updateUI('search');

    // Start render loop
    renderer.setAnimationLoop(onXRFrame);

  } catch (err) {
    statusMsg.textContent = `Errore avvio AR: ${err.message}`;
    statusMsg.classList.add('error');
  }
}

function onSessionEnd() {
  // Cleanup
  clearMeasurements();
  hitTestSource = null;
  hitTestSourceRequested = false;
  reticle.visible = false;

  // Remove canvas
  if (renderer.domElement.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  // Show start screen again
  overlay.style.display = 'none';
  startScreen.style.display = 'flex';
  renderer.setAnimationLoop(null);
}

/* ══════════════════════════════════════════════════════════════
   RENDER LOOP (called every XR frame)
   ══════════════════════════════════════════════════════════════ */

function onXRFrame(timestamp, frame) {
  if (!frame) {
    renderer.render(scene, camera);
    return;
  }

  const session = renderer.xr.getSession();
  const refSpace = renderer.xr.getReferenceSpace();

  // ── Request hit-test source (once) ──
  if (!hitTestSourceRequested) {
    session.requestReferenceSpace('viewer').then((viewerSpace) => {
      session.requestHitTestSource({ space: viewerSpace }).then((source) => {
        hitTestSource = source;
      });
    });
    hitTestSourceRequested = true;
  }

  // ── Perform hit-test ──
  if (hitTestSource) {
    const results = frame.getHitTestResults(hitTestSource);
    if (results.length > 0) {
      const hit = results[0];
      const pose = hit.getPose(refSpace);
      if (pose) {
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);

        // Update instruction if we were searching
        if (measureState === 0 && instruction.dataset.state === 'search') {
          updateUI('ready');
        }
      }
    } else {
      reticle.visible = false;
    }
  }

  renderer.render(scene, camera);
}

/* ══════════════════════════════════════════════════════════════
   TAP HANDLER — Measurement logic
   ══════════════════════════════════════════════════════════════ */

function onTap() {
  if (!reticle.visible) return;

  // Get world position from reticle matrix
  const position = new THREE.Vector3();
  position.setFromMatrixPosition(reticle.matrix);

  if (measureState === 0) {
    // ── 1° Tap: punto di partenza ──
    startMarker = createMarker(0x4ade80);  // verde
    startMarker.position.copy(position);
    scene.add(startMarker);
    sceneObjects.push(startMarker);

    measureState = 1;
    updateUI('endpoint');

  } else if (measureState === 1) {
    // ── 2° Tap: punto di arrivo + linea + calcolo distanza ──
    endMarker = createMarker(0xf87171);  // rosso
    endMarker.position.copy(position);
    scene.add(endMarker);
    sceneObjects.push(endMarker);

    // Traccia la linea tra i due punti
    measureLine = createLine(startMarker.position, endMarker.position);
    scene.add(measureLine);
    sceneObjects.push(measureLine);

    // Calcola distanza — WebXR usa i metri come unità
    const distMeters = startMarker.position.distanceTo(endMarker.position);
    const distCm = (distMeters * 100).toFixed(1);

    measureState = 2;
    updateUI('result', distCm);

  } else {
    // ── 3° Tap: reset ──
    clearMeasurements();
    measureState = 0;
    updateUI('ready');
  }
}

/* ══════════════════════════════════════════════════════════════
   HELPERS — Markers, Lines, Cleanup
   ══════════════════════════════════════════════════════════════ */

function createMarker(color) {
  const geo = new THREE.SphereGeometry(0.012, 20, 20);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);

  // Anello di contorno attorno al marker
  const ringGeo = new THREE.RingGeometry(0.018, 0.024, 32).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  mesh.add(ring);

  return mesh;
}

function createLine(pointA, pointB) {
  const points = [pointA.clone(), pointB.clone()];
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8,
  });
  return new THREE.Line(geo, mat);
}

function clearMeasurements() {
  for (const obj of sceneObjects) {
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
    // Dispose children (ring around marker)
    if (obj.children) {
      for (const child of obj.children) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      }
    }
  }
  sceneObjects = [];
  startMarker = null;
  endMarker = null;
  measureLine = null;
}

/* ══════════════════════════════════════════════════════════════
   UI UPDATE — Overlay text updates
   ══════════════════════════════════════════════════════════════ */

function updateUI(state, value) {
  instruction.dataset.state = state;

  switch (state) {
    case 'search':
      measValue.textContent = '— cm';
      measValue.classList.remove('active');
      instruction.innerHTML = '<span class="instr-dot"></span> Muovi il telefono per rilevare superfici';
      break;

    case 'ready':
      measValue.textContent = '— cm';
      measValue.classList.remove('active');
      instruction.innerHTML = '<span class="instr-dot" style="background:#4ade80"></span> Tocca lo schermo per il punto di partenza';
      break;

    case 'endpoint':
      measValue.textContent = '— cm';
      measValue.classList.remove('active');
      instruction.innerHTML = '<span class="instr-dot" style="background:#f87171"></span> Tocca lo schermo per il punto di arrivo';
      break;

    case 'result':
      measValue.textContent = `${value} cm`;
      measValue.classList.add('active');
      instruction.innerHTML = '<span class="instr-dot" style="background:#d4a853"></span> Tocca di nuovo per ricominciare';
      break;
  }
}

/* ── Start ────────────────────────────────────────────────── */
init();
