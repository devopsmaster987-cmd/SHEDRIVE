FROM python:3.11-slim
LABEL org.opencontainers.image.title="SheDrive face service" \
      org.opencontainers.image.description="FastAPI and DeepFace advisory verification service"

ARG FACE_MODEL=Facenet512

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEEPFACE_BACKEND_ENGINE=onnx \
    DEEPFACE_HOME=/home/appuser/.deepface \
    FACE_MODEL=${FACE_MODEL} \
    DETECTOR_BACKEND=opencv \
    PRELOAD_MODELS=true

WORKDIR /app

# Runtime libraries for ONNX Runtime and OpenCV headless.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Unprivileged user; preload weights into its home cache before copying app code
# so the (large) model layer is reused when only application code changes.
RUN useradd --create-home --uid 10001 appuser
USER appuser

RUN python -c "import os; from deepface import DeepFace; DeepFace.build_model('Gender', task='facial_attribute'); DeepFace.build_model(os.getenv('FACE_MODEL', 'Facenet512'), task='facial_recognition')"

COPY --chown=appuser:appuser app ./app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=6).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
