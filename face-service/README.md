# SheDrive face service

FastAPI microservice for first-pass selfie verification. It predicts gender,
computes a numeric face embedding, and returns an advisory decision. Images are
processed in memory only.

## Privacy by design

Raw selfies are never persisted or logged, filenames are not stored, and request
buffers are closed immediately after reading. Decoded pixels stay in memory only
for the duration of the request. The response contains only the gender prediction,
confidence, decision and embedding. Automated predictions are advisory: anything
uncertain goes to the admin review queue for a human decision.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness probe plus model/backend status |
| GET | `/metrics` | Prometheus metrics |
| POST | `/verify` | Multipart selfie verification |
| GET | `/docs` | OpenAPI documentation |

### `POST /verify`

Multipart form field: `selfie` (JPEG or PNG, max `MAX_UPLOAD_MB`).

```json
{
  "face_detected": true,
  "gender": "female",
  "confidence": 0.95,
  "decision": "auto_approved",
  "embedding": [0.0123, -0.0456]
}
```

- `decision`: `auto_approved` when gender is female and confidence is at least
  `CONF_THRESHOLD`; otherwise `needs_review`.
- No face, multiple faces, or a failed single-face embedding returns HTTP 200 with
  `face_detected: false`, `decision: "no_face"` and an empty embedding.
- Invalid payload = `400`, wrong MIME type = `415`, too large = `413`, model
  failure = `502`, timeout = `504`.

## Models

- Runtime: **ONNX Runtime** via `deepface==0.0.103` (no TensorFlow).
- Detector: OpenCV.
- Gender: DeepFace attribute model.
- Embedding: `Facenet512` by default (512 floats). The Docker build downloads the
  detector, gender and embedding weights into the unprivileged user's cache so
  containers start quickly.

## Run

The pinned runtime targets Python 3.11 (the Docker image uses `python:3.11-slim`).

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
pytest
```

Unit tests mock DeepFace, so they run without downloading model weights. Set
`PRELOAD_MODELS=false` to skip eager model loading in local HTTP-only development.

## Docker

```bash
docker build -t shedrive-face-service .
docker run --rm -p 8000:8000 --env-file .env shedrive-face-service
```

The build preloads weights with `DEEPFACE_BACKEND_ENGINE=onnx`, runs as UID 10001,
and exposes a `/health` check. Set `FACE_MODEL` as a build arg to change the
embedding model.

## Kubernetes

On EKS the service runs two replicas behind an internal `ClusterIP` only; the backend is
the only client. Requests are `1Gi` and limits `3Gi` because the ONNX models are
memory-hungry. If pods are `OOMKilled`, use larger nodes or lower the replica count. See
[`../docs/aws-setup.md`](../docs/aws-setup.md).
