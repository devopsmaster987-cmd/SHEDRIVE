"""SheDrive face-verification service.

Endpoints:
    GET  /health  liveness + model status
    GET  /metrics Prometheus metrics
    POST /verify  multipart selfie -> gender/embedding/decision

Privacy: selfies are processed in memory; raw bytes and file names are never
logged or persisted.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager

# DeepFace logs emoji; a Windows cp1252 console raises UnicodeEncodeError and
# aborts model downloads. Force UTF-8 so local runs work like the Linux containers.
for _stream in (sys.stdout, sys.stderr):
    _reconfigure = getattr(_stream, "reconfigure", None)
    if _reconfigure is not None:
        try:
            _reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import JSONResponse
from prometheus_client import Counter, Histogram
from prometheus_fastapi_instrumentator import Instrumentator
from starlette.formparsers import MultiPartParser

from . import verify as verification
from .config import settings

# Keep valid selfies in memory; Starlette otherwise spools anything over 1 MB.
MultiPartParser.max_file_size = settings.max_upload_bytes
MultiPartParser.max_part_size = 64 * 1024

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("shedrive.face")

VERIFICATIONS = Counter(
    "shedrive_face_verifications_total",
    "Completed face verifications by decision.",
    ["decision"],
)
VERIFY_LATENCY = Histogram(
    "shedrive_face_verification_seconds",
    "Time spent processing a selfie.",
    buckets=(0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.verify_semaphore = asyncio.Semaphore(settings.max_concurrent_verifications)

    if settings.preload_models:
        try:
            await asyncio.to_thread(verification.preload_models)
            logger.info(
                "Face models preloaded (model=%s detector=%s)",
                settings.face_model,
                settings.detector_backend,
            )
        except Exception:
            # Keep serving health checks so orchestration can surface the issue.
            logger.exception("Face model preload failed; verification will retry lazily")
    else:
        logger.info("Face model preload disabled")

    yield


app = FastAPI(
    title="SheDrive Face Service",
    version="0.2.0",
    description="Private selfie gender-analysis and embedding service for SheDrive.",
    lifespan=lifespan,
)

Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "data": None,
            "error": {"code": code, "message": message},
        },
    )


MULTIPART_OVERHEAD_BYTES = 1024 * 1024


@app.middleware("http")
async def reject_oversized_verify_body(request: Request, call_next):
    if request.url.path == "/verify":
        raw_length = request.headers.get("content-length")
        if raw_length is not None:
            try:
                content_length = int(raw_length)
            except ValueError:
                content_length = 0
            if content_length > settings.max_upload_bytes + MULTIPART_OVERHEAD_BYTES:
                return _error(
                    413,
                    "IMAGE_TOO_LARGE",
                    f"Selfie must be {settings.max_upload_mb:.1f} MB or smaller.",
                )
    return await call_next(request)


@app.get("/")
async def root():
    return {
        "success": True,
        "data": {
            "service": "shedrive-face-service",
            "version": "0.2.0",
            "endpoints": {"health": "/health", "metrics": "/metrics", "verify": "/verify"},
        },
        "error": None,
    }


@app.get("/health")
async def health():
    loaded = verification.models_loaded()
    return {
        "success": True,
        "data": {
            "status": "ok",
            "service": "shedrive-face-service",
            "model": settings.face_model,
            "detector_backend": settings.detector_backend,
            "model_loaded": loaded,
            "confidence_threshold": settings.conf_threshold,
        },
        "error": None,
    }


@app.post("/verify", tags=["verification"])
async def verify_endpoint(selfie: UploadFile = File(...)):
    mime = (selfie.content_type or "").split(";")[0].strip().lower()
    if mime not in settings.allowed_mime_types:
        await selfie.close()
        return _error(415, "UNSUPPORTED_IMAGE_TYPE", "Only JPEG and PNG selfies are accepted.")

    raw = await selfie.read(settings.max_upload_bytes + 1)
    await selfie.close()

    if not raw:
        return _error(400, "INVALID_IMAGE", "The uploaded selfie is empty.")
    if len(raw) > settings.max_upload_bytes:
        max_mb = settings.max_upload_bytes / (1024 * 1024)
        return _error(413, "IMAGE_TOO_LARGE", f"Selfie must be {max_mb:.1f} MB or smaller.")

    semaphore = getattr(app.state, "verify_semaphore", None)
    if semaphore is None:
        semaphore = asyncio.Semaphore(settings.max_concurrent_verifications)
        app.state.verify_semaphore = semaphore

    started = time.perf_counter()
    try:
        async with semaphore:
            result = await asyncio.wait_for(
                asyncio.to_thread(verification.verify_selfie, raw, mime),
                timeout=settings.verify_timeout_seconds,
            )
    except verification.UnsupportedImageType as exc:
        return _error(exc.status_code, exc.code, str(exc))
    except verification.ImageTooLarge as exc:
        return _error(exc.status_code, exc.code, str(exc))
    except verification.ImageValidationError as exc:
        return _error(exc.status_code, exc.code, str(exc))
    except asyncio.TimeoutError:
        logger.warning("Face verification timed out after %.1fs", settings.verify_timeout_seconds)
        return _error(504, "VERIFICATION_TIMEOUT", "Face verification timed out. Please try again.")
    except verification.FaceServiceError:
        logger.exception("Face verification runtime failure")
        return _error(502, "VERIFICATION_FAILED", "Face verification is temporarily unavailable.")
    except Exception:
        logger.exception("Unexpected face verification failure")
        return _error(500, "INTERNAL_ERROR", "Face verification failed.")
    finally:
        VERIFY_LATENCY.observe(time.perf_counter() - started)

    VERIFICATIONS.labels(decision=result["decision"]).inc()
    logger.info(
        "Face verification decision=%s face_detected=%s confidence=%s",
        result["decision"],
        result["face_detected"],
        result["confidence"],
    )
    return result
