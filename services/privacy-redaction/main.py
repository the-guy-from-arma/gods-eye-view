"""Detector-only privacy worker. This service never imports or executes an OCR model."""

import os
import secrets

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request, Response
from open_image_models import LicensePlateDetector

app = FastAPI(title="ThunderLink Privacy Redaction", docs_url=None, redoc_url=None)
_detector = None


def detector() -> LicensePlateDetector:
    global _detector
    if _detector is None:
        _detector = LicensePlateDetector(
            detection_model=os.getenv(
                "PLATE_DETECTOR_MODEL", "yolo-v9-t-384-license-plate-end2end"
            ),
            conf_thresh=float(os.getenv("PLATE_DETECTOR_CONFIDENCE", "0.40")),
            providers=["CPUExecutionProvider"],
        )
    return _detector


def authorize(request: Request) -> None:
    expected = os.getenv("PRIVACY_REDACTION_WORKER_TOKEN", "")
    supplied = request.headers.get("authorization", "").removeprefix("Bearer ")
    if not expected or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


def redact_region(image: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> None:
    height, width = image.shape[:2]
    region_width = max(1, x2 - x1)
    region_height = max(1, y2 - y1)
    pad_x = max(8, round(region_width * 0.45))
    pad_y = max(6, round(region_height * 0.65))
    left, top = max(0, x1 - pad_x), max(0, y1 - pad_y)
    right, bottom = min(width, x2 + pad_x), min(height, y2 + pad_y)
    region = image[top:bottom, left:right]
    if region.size == 0:
        return
    # Two destructive passes: collapse detail to a tiny pixel grid, then blur.
    tiny = cv2.resize(region, (3, 2), interpolation=cv2.INTER_AREA)
    pixelated = cv2.resize(tiny, (right - left, bottom - top), interpolation=cv2.INTER_NEAREST)
    kernel = max(9, min(51, ((min(right - left, bottom - top) // 2) * 2) + 1))
    image[top:bottom, left:right] = cv2.GaussianBlur(pixelated, (kernel, kernel), 0)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ready", "mode": "detector-only", "ocr": "absent"}


@app.post("/v1/redact")
async def redact(request: Request) -> Response:
    authorize(request)
    content_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="unsupported image type")
    body = await request.body()
    if not body or len(body) > 4_800_000:
        raise HTTPException(status_code=413, detail="invalid frame size")
    image = cv2.imdecode(np.frombuffer(body, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=415, detail="invalid image")
    detections = detector().predict(image)
    boxes = []
    for detection in detections[:50]:
        box = detection.bounding_box
        boxes.append((int(box.x1), int(box.y1), int(box.x2), int(box.y2)))
    if not boxes:
        # Fail closed: a frame is never returned for archival without a verified redaction.
        raise HTTPException(status_code=422, detail="no verified redaction regions")
    for box in boxes:
        redact_region(image, *box)
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 76])
    if not ok:
        raise HTTPException(status_code=500, detail="redaction encoding failed")
    return Response(
        content=encoded.tobytes(),
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store",
            "X-Redaction-Verified": "true",
            "X-Redacted-Region-Count": str(len(boxes)),
            "X-Redaction-Model": "open-image-models-detector-only",
        },
    )
