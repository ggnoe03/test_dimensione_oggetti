"""
ObjectMeter — Backend FastAPI + YOLOv8

Flusso:
1. L'utente carica un'immagine e disegna un bounding box sull'oggetto da misurare.
2. Il backend riceve immagine + coordinate del bbox utente.
3. YOLOv8 rileva tutti gli oggetti nella scena.
4. Il sistema cerca l'oggetto rilevato più vicino spazialmente al bbox utente
   che abbia una dimensione di riferimento nota (dizionario REFERENCE_SIZES).
5. Calcola il rapporto pixel/cm usando l'oggetto di riferimento.
6. Applica il rapporto al bbox utente per stimare le dimensioni reali.
"""

import base64
import math
from io import BytesIO

import cv2
import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from ultralytics import YOLO

# ── App setup ────────────────────────────────────────────────────
app = FastAPI(title="ObjectMeter")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# ── Load YOLO model (scaricato automaticamente al primo avvio) ───
model = YOLO("yolov8n.pt")

# ══════════════════════════════════════════════════════════════════
# REFERENCE_SIZES — Dimensioni medie reali (in cm) degli oggetti
# che YOLO (COCO) sa riconoscere.
#
# ⚠️  PERSONALIZZABILE: Aggiungi/modifica le voci qui sotto.
#     La chiave è il nome della classe COCO (inglese, minuscolo).
#     Il valore è un dizionario con:
#       - "width":  larghezza media in cm
#       - "height": altezza media in cm
#
# Se un oggetto non è presente in questo dizionario, verrà ignorato
# come possibile riferimento.
# ══════════════════════════════════════════════════════════════════
REFERENCE_SIZES = {
    # ── Persone ──
    "person":       {"width": 45,   "height": 170},

    # ── Veicoli ──
    "car":          {"width": 180,  "height": 150},
    "truck":        {"width": 250,  "height": 300},
    "bus":          {"width": 250,  "height": 300},
    "motorcycle":   {"width": 80,   "height": 110},
    "bicycle":      {"width": 60,   "height": 100},

    # ── Oggetti da interno ──
    "laptop":       {"width": 35,   "height": 24},
    "keyboard":     {"width": 45,   "height": 15},
    "mouse":        {"width": 6,    "height": 10},
    "cell phone":   {"width": 7,    "height": 15},
    "remote":       {"width": 5,    "height": 20},
    "cup":          {"width": 8,    "height": 10},
    "bottle":       {"width": 7,    "height": 25},
    "book":         {"width": 15,   "height": 23},
    "tv":           {"width": 100,  "height": 60},
    "monitor":      {"width": 60,   "height": 35},

    # ── Mobili ──
    "chair":        {"width": 45,   "height": 85},
    "couch":        {"width": 200,  "height": 85},
    "dining table": {"width": 120,  "height": 75},
    "bed":          {"width": 140,  "height": 200},
    "toilet":       {"width": 40,   "height": 40},
    "refrigerator": {"width": 60,   "height": 170},
    "oven":         {"width": 60,   "height": 60},
    "microwave":    {"width": 50,   "height": 30},

    # ── Animali ──
    "cat":          {"width": 20,   "height": 25},
    "dog":          {"width": 30,   "height": 50},

    # ── Accessori ──
    "backpack":     {"width": 30,   "height": 45},
    "umbrella":     {"width": 100,  "height": 100},
    "handbag":      {"width": 30,   "height": 25},
    "suitcase":     {"width": 45,   "height": 65},

    # ── Sport ──
    "sports ball":  {"width": 22,   "height": 22},
    "tennis racket":{"width": 27,   "height": 68},
    "skateboard":   {"width": 20,   "height": 80},

    # ── Cibo ──
    "banana":       {"width": 4,    "height": 20},
    "apple":        {"width": 8,    "height": 8},
    "pizza":        {"width": 30,   "height": 30},

    # ── Strutture (approssimazioni) ──
    "door":         {"width": 80,   "height": 200},
    "clock":        {"width": 25,   "height": 25},
    "vase":         {"width": 15,   "height": 25},
}


# ── Request model ────────────────────────────────────────────────
class MeasureRequest(BaseModel):
    image: str             # base64-encoded image (con o senza prefisso data URI)
    bbox_x: float          # coordinate del bounding box disegnato dall'utente
    bbox_y: float          # (in pixel, rispetto all'immagine originale)
    bbox_w: float
    bbox_h: float


# ── Helper functions ─────────────────────────────────────────────

def decode_image(b64_string: str) -> np.ndarray:
    """Decodifica un'immagine base64 in un array OpenCV (BGR)."""
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    img_bytes = base64.b64decode(b64_string)
    arr = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def bbox_center(x, y, w, h):
    """Restituisce il centro di un bounding box."""
    return (x + w / 2, y + h / 2)


def distance_between_centers(box1, box2):
    """Distanza euclidea tra i centri di due bbox (x, y, w, h)."""
    c1 = bbox_center(*box1)
    c2 = bbox_center(*box2)
    return math.sqrt((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2)


def encode_image(img: np.ndarray) -> str:
    """Codifica un'immagine OpenCV in base64 JPEG con prefisso data URI."""
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64 = base64.b64encode(buf).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"


def draw_detections(img: np.ndarray, detections: list, user_bbox: tuple,
                    best_ref: dict | None) -> np.ndarray:
    """
    Disegna sull'immagine:
    - Il bbox dell'utente (oro)
    - Tutti gli oggetti rilevati da YOLO che sono nel dizionario (verde chiaro)
    - L'oggetto di riferimento scelto (ciano, più spesso)
    """
    annotated = img.copy()
    gold = (83, 168, 212)       # BGR for #d4a853
    green = (120, 200, 120)     # verde chiaro
    cyan = (220, 200, 50)       # ciano
    thickness = max(2, min(img.shape[:2]) // 250)

    # Disegna bbox utente
    ux, uy, uw, uh = [int(v) for v in user_bbox]
    cv2.rectangle(annotated, (ux, uy), (ux + uw, uy + uh), gold, thickness + 1)

    # Disegna label "Il tuo oggetto"
    font = cv2.FONT_HERSHEY_SIMPLEX
    fs = max(0.45, min(img.shape[:2]) / 1200)
    ft = max(1, int(fs * 2))
    cv2.putText(annotated, "Il tuo oggetto", (ux, max(uy - 8, 15)),
                font, fs, gold, ft, cv2.LINE_AA)

    # Disegna tutti gli oggetti di riferimento rilevati
    for det in detections:
        x, y, w, h = [int(v) for v in det["bbox"]]
        is_best = best_ref and det is best_ref
        color = cyan if is_best else green
        t = thickness + 2 if is_best else thickness
        cv2.rectangle(annotated, (x, y), (x + w, y + h), color, t)

        label = f"{det['name']} ({det['conf']:.0%})"
        if is_best:
            label += " ★ REF"
        cv2.putText(annotated, label, (x, max(y - 8, 15)),
                    font, fs, color, ft, cv2.LINE_AA)

    return annotated


# ── Routes ───────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/measure")
async def measure(req: MeasureRequest):
    # 1. Decodifica immagine
    img = decode_image(req.image)
    if img is None:
        return {"error": "Impossibile decodificare l'immagine."}

    img_h, img_w = img.shape[:2]
    user_bbox = (req.bbox_x, req.bbox_y, req.bbox_w, req.bbox_h)

    # 2. Esegui YOLO detection
    results = model.predict(img, conf=0.3, verbose=False)

    # 3. Filtra detections: solo oggetti nel dizionario REFERENCE_SIZES
    detections = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            cls_name = model.names[cls_id]
            if cls_name in REFERENCE_SIZES:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                detections.append({
                    "name": cls_name,
                    "conf": float(box.conf[0]),
                    "bbox": (x1, y1, x2 - x1, y2 - y1),  # (x, y, w, h)
                    "ref": REFERENCE_SIZES[cls_name],
                })

    if not detections:
        # Nessun oggetto di riferimento trovato
        annotated = draw_detections(img, [], user_bbox, None)
        return {
            "error": "Nessun oggetto di riferimento riconosciuto nella scena. "
                     "Assicurati che nella foto ci sia almeno un oggetto comune "
                     "(persona, bottiglia, laptop, sedia, ecc.).",
            "annotated_image": encode_image(annotated),
        }

    # 4. Trova l'oggetto di riferimento più vicino al bbox utente
    best_ref = min(detections, key=lambda d: distance_between_centers(user_bbox, d["bbox"]))

    # 5. Calcola px/cm usando l'oggetto di riferimento
    ref_bbox_w = best_ref["bbox"][2]
    ref_bbox_h = best_ref["bbox"][3]
    ref_real_w = best_ref["ref"]["width"]
    ref_real_h = best_ref["ref"]["height"]

    # Usa la media dei rapporti larghezza e altezza per più accuratezza
    px_per_cm_w = ref_bbox_w / ref_real_w
    px_per_cm_h = ref_bbox_h / ref_real_h
    # Media pesata (se uno dei due è molto piccolo, l'altro è più affidabile)
    px_per_cm = (px_per_cm_w + px_per_cm_h) / 2

    # 6. Calcola dimensioni dell'oggetto dell'utente
    user_w_cm = round(req.bbox_w / px_per_cm, 1)
    user_h_cm = round(req.bbox_h / px_per_cm, 1)

    # 7. Genera immagine annotata
    annotated = draw_detections(img, detections, user_bbox, best_ref)

    return {
        "width_cm": user_w_cm,
        "height_cm": user_h_cm,
        "reference_object": best_ref["name"],
        "reference_confidence": round(best_ref["conf"], 2),
        "all_detections": [
            {"name": d["name"], "confidence": round(d["conf"], 2)} for d in detections
        ],
        "annotated_image": encode_image(annotated),
        "px_per_cm": round(px_per_cm, 4),
    }


# ── Entry point ──────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
