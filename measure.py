import cv2
import numpy as np
import base64
import math


# ── Default assumptions ──────────────────────────────────────────
DEFAULT_HEIGHT_CM = 159.0       # 170cm person × 0.935 (eye level)
DEFAULT_H_FOV_DEG = 70.0        # average horizontal FOV of smartphone camera

# ── Image decoding ───────────────────────────────────────────────

def decode_image(b64_string: str) -> np.ndarray:
    """Decode a base64-encoded PNG/JPEG string into an OpenCV image."""
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    img_bytes = base64.b64decode(b64_string)
    arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


# ── px/cm calculation from height + FOV ──────────────────────────

def compute_px_per_cm(image_width_px: int, image_height_px: int,
                       height_cm: float = DEFAULT_HEIGHT_CM,
                       h_fov_deg: float = DEFAULT_H_FOV_DEG):
    """
    Compute pixels-per-cm for the ground plane, assuming the phone is
    pointing straight down from `height_cm`.

    The visible width at ground level:
        visible_w = 2 * height_cm * tan(h_fov / 2)
    And since the image maps that visible width to image_width_px:
        px_per_cm_h = image_width_px / visible_w

    Vertical FOV is derived from horizontal FOV + aspect ratio.
    """
    h_fov_rad = math.radians(h_fov_deg)
    visible_w = 2 * height_cm * math.tan(h_fov_rad / 2)
    px_per_cm_h = image_width_px / visible_w

    # Derive vertical FOV from aspect ratio
    aspect = image_height_px / image_width_px
    v_fov_rad = 2 * math.atan(aspect * math.tan(h_fov_rad / 2))
    visible_h = 2 * height_cm * math.tan(v_fov_rad / 2)
    px_per_cm_v = image_height_px / visible_h

    return px_per_cm_h, px_per_cm_v


# ── Contour detection ────────────────────────────────────────────

def find_object_bbox(img: np.ndarray):
    """
    Detect the largest contour in the image (the object on a contrasting
    background) and return its bounding box (x, y, w, h) in pixels.
    Returns None if nothing meaningful is found.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)

    thresh = cv2.adaptiveThreshold(
        blurred, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=21, C=4
    )

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    img_area = img.shape[0] * img.shape[1]
    valid = [
        c for c in contours
        if 0.01 * img_area < cv2.contourArea(c) < 0.95 * img_area
    ]
    if not valid:
        return None

    largest = max(valid, key=cv2.contourArea)
    return cv2.boundingRect(largest)


# ── Annotated image ──────────────────────────────────────────────

def draw_annotated_image(img: np.ndarray, bbox: tuple,
                         width_cm: float, height_cm: float) -> str:
    """
    Draw a gold bounding box with dimension labels on the image.
    Returns base64-encoded JPEG string (with data URI prefix).
    """
    annotated = img.copy()
    x, y, w, h = bbox
    gold = (83, 168, 212)  # BGR for #d4a853

    # Draw rectangle
    thickness = max(2, min(img.shape[0], img.shape[1]) // 200)
    cv2.rectangle(annotated, (x, y), (x + w, y + h), gold, thickness)

    # Corner accents (thicker, shorter lines)
    corner_len = max(15, min(w, h) // 6)
    ct = thickness * 2
    # Top-left
    cv2.line(annotated, (x, y), (x + corner_len, y), gold, ct)
    cv2.line(annotated, (x, y), (x, y + corner_len), gold, ct)
    # Top-right
    cv2.line(annotated, (x + w, y), (x + w - corner_len, y), gold, ct)
    cv2.line(annotated, (x + w, y), (x + w, y + corner_len), gold, ct)
    # Bottom-left
    cv2.line(annotated, (x, y + h), (x + corner_len, y + h), gold, ct)
    cv2.line(annotated, (x, y + h), (x, y + h - corner_len), gold, ct)
    # Bottom-right
    cv2.line(annotated, (x + w, y + h), (x + w - corner_len, y + h), gold, ct)
    cv2.line(annotated, (x + w, y + h), (x + w, y + h - corner_len), gold, ct)

    # Labels
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(0.5, min(img.shape[0], img.shape[1]) / 1000)
    font_thick = max(1, int(font_scale * 2))

    # Width label (bottom of bbox)
    w_label = f"{width_cm} cm"
    (tw, th), _ = cv2.getTextSize(w_label, font, font_scale, font_thick)
    lx = x + (w - tw) // 2
    ly = y + h + th + 8
    cv2.rectangle(annotated, (lx - 4, ly - th - 4), (lx + tw + 4, ly + 4),
                  (0, 0, 0), -1)
    cv2.putText(annotated, w_label, (lx, ly), font, font_scale, gold, font_thick,
                cv2.LINE_AA)

    # Height label (right of bbox)
    h_label = f"{height_cm} cm"
    (tw2, th2), _ = cv2.getTextSize(h_label, font, font_scale, font_thick)
    hx = x + w + 8
    hy = y + (h + th2) // 2
    cv2.rectangle(annotated, (hx - 4, hy - th2 - 4), (hx + tw2 + 4, hy + 4),
                  (0, 0, 0), -1)
    cv2.putText(annotated, h_label, (hx, hy), font, font_scale, gold, font_thick,
                cv2.LINE_AA)

    # Encode to JPEG base64
    _, buf = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64 = base64.b64encode(buf).decode('utf-8')
    return f"data:image/jpeg;base64,{b64}"


# ── Main measurement function ────────────────────────────────────

def measure_image(b64_string: str, height_cm: float = DEFAULT_HEIGHT_CM,
                  h_fov_deg: float = DEFAULT_H_FOV_DEG):
    """
    Detect the object in the image and return its real-world dimensions
    using the phone's distance from the ground and horizontal FOV.

    Returns a dict with:
        width_cm, height_cm, px_w, px_h, annotated_image
    or raises ValueError.
    """
    img = decode_image(b64_string)
    if img is None:
        raise ValueError("Impossibile decodificare l'immagine.")

    bbox = find_object_bbox(img)
    auto_detected = True
    img_h, img_w = img.shape[:2]

    if bbox is None:
        # Provide a default bounding box in the center (50% of the image)
        auto_detected = False
        default_w = img_w // 2
        default_h = img_h // 2
        default_x = (img_w - default_w) // 2
        default_y = (img_h - default_h) // 2
        bbox = (default_x, default_y, default_w, default_h)

    _, _, w_px, h_px = bbox

    px_per_cm_h, px_per_cm_v = compute_px_per_cm(
        img_w, img_h, height_cm, h_fov_deg
    )

    width_cm = round(w_px / px_per_cm_h, 1)
    obj_height_cm = round(h_px / px_per_cm_v, 1)

    annotated = draw_annotated_image(img, bbox, width_cm, obj_height_cm)

    # Encode original image for interactive editing
    _, orig_buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    orig_b64 = base64.b64encode(orig_buf).decode('utf-8')
    original_image = f"data:image/jpeg;base64,{orig_b64}"

    return {
        "width_cm": width_cm,
        "height_cm": obj_height_cm,
        "px_w": w_px,
        "px_h": h_px,
        "annotated_image": annotated,
        "original_image": original_image,
        "bbox": list(bbox),  # [x, y, w, h]
        "img_w": img_w,
        "img_h": img_h,
        "px_per_cm_h": round(px_per_cm_h, 4),
        "px_per_cm_v": round(px_per_cm_v, 4),
        "auto_detected": auto_detected,
    }
