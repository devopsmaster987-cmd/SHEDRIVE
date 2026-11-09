"""Environment-driven configuration for the face service.

Every value can be overridden with an environment variable; `.env.example`
documents the defaults. Nothing secret is hard-coded.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load face-service/.env when running locally. Docker supplies real env vars.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    conf_threshold: float = 0.85
    max_upload_mb: float = 5.0
    max_upload_bytes: int = 5 * 1024 * 1024
    max_image_pixels: int = 25_000_000
    face_model: str = "Facenet512"
    detector_backend: str = "opencv"
    verify_timeout_seconds: float = 20.0
    preload_models: bool = True
    max_concurrent_verifications: int = 1
    allowed_mime_types: frozenset[str] = field(
        default_factory=lambda: frozenset({"image/jpeg", "image/png"})
    )

    @classmethod
    def from_env(cls) -> "Settings":
        max_upload_mb = max(0.1, _float("MAX_UPLOAD_MB", 5.0))
        threshold = min(1.0, max(0.0, _float("CONF_THRESHOLD", 0.85)))

        return cls(
            conf_threshold=threshold,
            max_upload_mb=max_upload_mb,
            max_upload_bytes=int(max_upload_mb * 1024 * 1024),
            max_image_pixels=max(1_000_000, _int("MAX_IMAGE_PIXELS", 25_000_000)),
            face_model=os.getenv("FACE_MODEL", "Facenet512"),
            detector_backend=os.getenv("DETECTOR_BACKEND", "opencv"),
            verify_timeout_seconds=max(1.0, _float("VERIFY_TIMEOUT_SECONDS", 20.0)),
            preload_models=_bool("PRELOAD_MODELS", True),
            max_concurrent_verifications=max(1, _int("MAX_CONCURRENT_VERIFICATIONS", 1)),
        )


settings = Settings.from_env()
