"""Selfie validation, face analysis, and confidence decisions.

Decoded images stay in memory and application code never writes image data to
disk. Raw bytes and filenames are never logged. DeepFace is imported lazily so
the HTTP layer and unit tests do not require the full model runtime.
"""

from __future__ import annotations

import logging
from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import settings

logger = logging.getLogger("shedrive.face.verify")

# Reject enormous decompression bombs before allocating pixel buffers.
Image.MAX_IMAGE_PIXELS = settings.max_image_pixels

_models_loaded = False


class ImageValidationError(Exception):
    """Raised when an uploaded selfie cannot be safely decoded."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "INVALID_IMAGE",
        status_code: int = 400,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class UnsupportedImageType(ImageValidationError):
    def __init__(self, message: str = "Only JPEG and PNG selfies are accepted.") -> None:
        super().__init__(message, code="UNSUPPORTED_IMAGE_TYPE", status_code=415)


class ImageTooLarge(ImageValidationError):
    def __init__(
        self,
        message: str = "Selfie exceeds the maximum allowed size.",
        *,
        code: str = "IMAGE_TOO_LARGE",
    ) -> None:
        super().__init__(message, code=code, status_code=413)


class NoFaceDetected(Exception):
    """Raised when DeepFace finds no usable face."""


class MultipleFacesDetected(Exception):
    """Raised when more than one face is present."""


class FaceServiceError(Exception):
    """Raised when the model runtime fails in an unexpected way."""


def decode_selfie(image_bytes: bytes, content_type: str | None) -> np.ndarray:
    """Validate MIME type, size, payload, and dimensions, then return RGB pixels."""

    mime = (content_type or "").split(";")[0].strip().lower()
    if mime not in settings.allowed_mime_types:
        raise UnsupportedImageType()

    if not image_bytes:
        raise ImageValidationError("The uploaded selfie is empty.")

    if len(image_bytes) > settings.max_upload_bytes:
        max_mb = settings.max_upload_bytes / (1024 * 1024)
        raise ImageTooLarge(f"Selfie must be {max_mb:.1f} MB or smaller.")

    try:
        with Image.open(BytesIO(image_bytes)) as probe:
            image_format = probe.format
            width, height = probe.size
            probe.verify()
    except Image.DecompressionBombError as exc:
        raise ImageTooLarge(
            "Selfie dimensions are too large.",
            code="IMAGE_DIMENSIONS_TOO_LARGE",
        ) from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise ImageValidationError("The uploaded file is not a valid image.") from exc

    if image_format not in {"JPEG", "PNG"}:
        raise UnsupportedImageType("Only JPEG and PNG selfies are accepted.")

    if width < 1 or height < 1:
        raise ImageValidationError("The uploaded image has invalid dimensions.")

    if width * height > settings.max_image_pixels:
        raise ImageTooLarge(
            "Selfie dimensions are too large.",
            code="IMAGE_DIMENSIONS_TOO_LARGE",
        )

    try:
        with Image.open(BytesIO(image_bytes)) as image:
            if image.format not in {"JPEG", "PNG"}:
                raise UnsupportedImageType()
            rgb = ImageOps.exif_transpose(image).convert("RGB")
            rgb.load()
            pixels = np.asarray(rgb)
    except UnsupportedImageType:
        raise
    except (OSError, SyntaxError, ValueError) as exc:
        raise ImageValidationError("The uploaded image could not be decoded.") from exc

    if pixels.size == 0:
        raise ImageValidationError("The uploaded image has no pixels.")

    return pixels


def _as_analysis_list(results: Any) -> list[dict[str, Any]]:
    if results is None:
        return []
    if isinstance(results, dict):
        return [results]
    return [item for item in results if isinstance(item, dict)]


def _no_face(message: str = "No single face could be analyzed.") -> dict[str, Any]:
    logger.info("face verification result=no_face reason=%s", message)
    return {
        "face_detected": False,
        "gender": None,
        "confidence": 0.0,
        "decision": "no_face",
        "embedding": [],
    }


def _looks_like_no_face(message: str) -> bool:
    text = message.lower()
    return ("face" in text and ("detect" in text or "found" in text)) or "no face" in text


def analyze_gender(image_bgr: np.ndarray) -> list[dict[str, Any]]:
    """Return DeepFace analysis records for each detected face."""

    try:
        from deepface import DeepFace
    except Exception as exc:  # pragma: no cover - depends on installed runtime
        raise FaceServiceError("Face model runtime is unavailable.") from exc

    try:
        results = DeepFace.analyze(
            img_path=image_bgr,
            actions=["gender"],
            enforce_detection=True,
            detector_backend=settings.detector_backend,
            align=True,
            silent=True,
        )
    except ValueError as exc:
        if _looks_like_no_face(str(exc)):
            raise NoFaceDetected("No face detected.") from exc
        raise FaceServiceError("Face analysis failed.") from exc
    except Exception as exc:  # pragma: no cover - depends on installed runtime
        raise FaceServiceError("Face analysis failed.") from exc

    analyses = _as_analysis_list(results)
    if not analyses:
        raise NoFaceDetected("No face detected.")
    return analyses


def compute_embedding(image_bgr: np.ndarray) -> list[float]:
    """Compute a deterministic embedding for the single face in the image."""

    try:
        from deepface import DeepFace
    except Exception as exc:  # pragma: no cover - depends on installed runtime
        raise FaceServiceError("Face model runtime is unavailable.") from exc

    try:
        representations = DeepFace.represent(
            img_path=image_bgr,
            model_name=settings.face_model,
            enforce_detection=True,
            detector_backend=settings.detector_backend,
            align=True,
        )
    except ValueError as exc:
        if _looks_like_no_face(str(exc)):
            raise NoFaceDetected("No face detected.") from exc
        raise FaceServiceError("Embedding generation failed.") from exc
    except Exception as exc:  # pragma: no cover - depends on installed runtime
        raise FaceServiceError("Embedding generation failed.") from exc

    representations = _as_analysis_list(representations)
    if not representations:
        raise NoFaceDetected("No face detected.")
    if len(representations) > 1:
        raise MultipleFacesDetected("More than one face detected.")

    embedding = representations[0].get("embedding")
    if not isinstance(embedding, (list, tuple)) or not embedding:
        raise FaceServiceError("Embedding generation returned no vector.")

    try:
        return [round(float(value), 6) for value in embedding]
    except (TypeError, ValueError) as exc:
        raise FaceServiceError("Embedding generation returned an invalid vector.") from exc


def _extract_gender(analysis: dict[str, Any]) -> tuple[str, float]:
    raw = analysis.get("gender")
    woman = 0.0
    man = 0.0

    if isinstance(raw, dict):
        try:
            woman = float(raw.get("Woman", 0.0) or 0.0)
            man = float(raw.get("Man", 0.0) or 0.0)
        except (TypeError, ValueError):
            woman = man = 0.0
    elif isinstance(raw, str):
        lowered = raw.lower()
        if "woman" in lowered or "female" in lowered:
            woman = 1.0
        elif "man" in lowered or "male" in lowered:
            man = 1.0

    total = woman + man
    if total > 1.5:
        woman /= 100.0
        man /= 100.0

    woman = min(1.0, max(0.0, woman))
    man = min(1.0, max(0.0, man))

    if woman == 0.0 and man == 0.0:
        dominant = str(analysis.get("dominant_gender", "")).lower()
        if "woman" in dominant or "female" in dominant:
            return "female", 0.0
        if "man" in dominant or "male" in dominant:
            return "male", 0.0
        return "unknown", 0.0

    if woman >= man:
        return "female", round(woman, 4)
    return "male", round(man, 4)


def decide(gender: str, confidence: float, threshold: float | None = None) -> str:
    limit = settings.conf_threshold if threshold is None else threshold
    if gender == "female" and confidence >= limit:
        return "auto_approved"
    return "needs_review"


def verify_selfie(
    image_bytes: bytes,
    content_type: str | None,
    conf_threshold: float | None = None,
) -> dict[str, Any]:
    """Run the complete verification pipeline for one selfie."""

    image_rgb = decode_selfie(image_bytes, content_type)
    # DeepFace expects BGR arrays, matching OpenCV's convention.
    image_bgr = np.ascontiguousarray(image_rgb[:, :, ::-1])

    try:
        analyses = analyze_gender(image_bgr)
    except NoFaceDetected:
        return _no_face("no_face")
    except MultipleFacesDetected:
        return _no_face("multiple_faces")

    if len(analyses) == 0:
        return _no_face("no_face")
    if len(analyses) > 1:
        return _no_face("multiple_faces")

    gender, confidence = _extract_gender(analyses[0])

    try:
        embedding = compute_embedding(image_bgr)
    except (NoFaceDetected, MultipleFacesDetected):
        return _no_face("face_lost_during_embedding")

    decision = decide(gender, confidence, conf_threshold)

    return {
        "face_detected": True,
        "gender": gender,
        "confidence": confidence,
        "decision": decision,
        "embedding": embedding,
    }


def preload_models() -> None:
    """Load the detector, gender model, and embedding model into memory."""

    global _models_loaded

    from deepface import DeepFace

    DeepFace.build_model("Gender", task="facial_attribute")
    DeepFace.build_model(settings.face_model, task="facial_recognition")
    _models_loaded = True


def models_loaded() -> bool:
    return _models_loaded
