# SheDrive

SheDrive is a women-only ride-hailing web platform built as a final-year project. Riders and
drivers are both women. At signup a selfie is checked by a Python face-verification service,
and the fare is agreed by negotiation rather than set by an algorithm, inspired by inDrive.

> **Important limitation:** automated gender classification is only a first-pass filter and is
> not 100% accurate. Anyone the model is unsure about is sent to a human admin review queue with
> an ID-document fallback. We never say "rejected" in the signup UI; the copy is
> "Your account is under review". Raw selfies are processed in memory and never stored long-term.

## Tech stack

| Area | Choice |
|---|---|
| Frontend | Vite, HTML/CSS/JS (ES modules), Tailwind CSS, Three.js, GSAP + ScrollTrigger, Lenis, Leaflet/MapLibre |
| Backend | Node.js 20, Express, Socket.IO, Mongoose |
| Face service | Python, FastAPI, DeepFace, OpenCV |
| Database | MongoDB (local container in dev, Atlas in production) |
| Auth | JWT access tokens + bcrypt |
| OTP | Provider-agnostic; mock provider in dev, Twilio/Fast2SMS adapter stubbed |
| Containers | Docker, Docker Compose |
| Cloud | AWS EKS, ECR, S3 + CloudFront |
| Observability | Prometheus + Grafana, prom-client, prometheus-fastapi-instrumentator |

## Repository layout

```
shedrive/
├── frontend/        # Vite app, design system, Three.js scenes, 11 pages
├── backend/         # Express API, Socket.IO, models, services
├── face-service/    # FastAPI gender-verification microservice
├── k8s/             # Kubernetes manifests and monitoring values
├── docs/            # architecture, design notes, API reference, viva notes
├── .github/         # CI and deploy workflows
└── docker-compose.yml
```

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env and replace JWT_SECRET with a long random value.
docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:8080 |
| Backend health | http://localhost:5000/health |
| Backend readiness | http://localhost:5000/health/ready |
| Backend metrics | http://localhost:5000/metrics |
| Face service health | http://localhost:8000/health |
| MongoDB | mongodb://localhost:27017/shedrive |

The first face-service build downloads DeepFace ONNX weights (gender + Facenet512) at build
time, so the image is large but starts with models already cached.

A one-shot `seed` service creates the demo accounts and sample ride data automatically
before the backend starts. The seed script is idempotent; run it again if needed:

```bash
docker compose run --rm seed
```

Demo accounts:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@shedrive.test` | `Admin@12345` |
| Human review | `review@shedrive.test` | `Review@12345` |
| Rider | `rider@shedrive.test` | `Rider@12345` |
| Driver (Car) | `driver@shedrive.test` | `Driver@12345` |
| Driver (Auto) | `driver2@shedrive.test` | `Driver@12345` |
| Driver (Bike) | `driver3@shedrive.test` | `Driver@12345` |

The review account sits in the human queue. The driver accounts include sample completed
rides for earnings, and the demo rider wallet starts with ₹1,500 for Phase 6 payment flows.
Change all defaults before any real deployment.

## Local development

Prerequisites: Node.js 20+, Python 3.11 (face service), MongoDB (or Docker).

```bash
# Frontend (Vite dev server on http://localhost:5173)
cd frontend
npm install
npm run dev

# Backend (http://localhost:5000)
cd backend
npm install
cp .env.example .env
npm run dev

# Face service (http://localhost:8000)
cd face-service
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Vite proxies `/api` and `/socket.io` to `http://localhost:5000`, so the browser always talks
to the same origin in development and production.

## Environment variables

Copy each `.env.example` to `.env`. Never commit real secrets.

- `.env.example` - Compose JWT secret and allowed browser origins.
- `backend/.env.example` - port, MongoDB URI, CORS origins, required JWT secret, optional Redis URL for multi-replica Socket.IO, OTP provider/expiry/attempts, bcrypt rounds, storage directory, face-service URL, fare rules and ride matching TTLs/radius.
- `face-service/.env.example` - confidence threshold, upload limit, embedding model, ONNX backend, preload and concurrency limits.

## Rider and driver ride flow

- `/book.html` lets approved riders search or tap a pickup and drop on an OpenStreetMap
  map, choose Car/Auto/Bike, see distance, ETA and a suggested fare, then send a real ride
  request with their own offer.
- `/ride.html` compares live driver offers, accepts one, tracks the assigned driver and
  shows the journey stages. Polling keeps the page usable when WebSockets are unavailable.
- `/driver.html` is the driver cockpit: online/offline toggle, live browser geolocation,
  manual map positioning, earnings summary, licence/account status and a nearby-request
  radar. Drivers can accept the rider's fare or send a counter-offer.
- `/driver-ride.html` handles the active trip: route, rider details, arrival/start/complete
  controls, cancellation and live location sharing.
- `/summary.html` shows the final fare breakdown after completion, records a mock cash or
  wallet payment, and collects one rating per participant. Ratings update the driver's
  average score.
- `/history.html` lists every ride with status filters, totals, completed-trip summary links,
  the demo wallet balance, quick/custom top-ups and the transaction ledger.
- `/ride.html` and `/driver-ride.html` expose a pulsing SOS orb during an active trip. A
  two-step confirmation sends the live ride, last known location and emergency-contact
  dispatch to the safety team without leaving the journey view.
- `/admin.html` is the operations console: live SOS queue, 3D city analytics, account
  moderation and recent rides. `/admin-review.html` handles identity and licence reviews
  with private document previews.
- A notification inbox in the shared shell carries SOS, account, payment and ride updates;
  unread counts refresh while the page is open.
- Socket.IO rooms (`user:<id>`, `ride:<id>`, `admins`) carry new requests, offers, accepted
  offers, status changes, driver location and live SOS events. JWT auth is required on the
  handshake.
- Fare estimation uses a base fare, per-km rate, road-distance factor and vehicle
  multiplier. Nearby drivers and rides are queried with MongoDB `$geoNear`; active drivers
  are excluded from new matches.

## Auth and verification

- Signup is multipart: profile fields, a selfie, and (for drivers) a licence document.
- The backend calls the face service before creating the account. `no_face` returns a
  friendly retake error; `needs_review` or an unavailable face service creates the
  account as `pending_review` and adds it to the admin queue; a confident female result
  is `approved`.
- Phone verification uses a 6-digit HMAC-hashed OTP. The `mock` provider prints the code
  in the backend log; Twilio/Fast2SMS adapters are stubs until configured.
- No JWT is issued at signup. `POST /api/auth/verify-otp` marks the phone verified and
  returns the token; login is blocked with `PHONE_NOT_VERIFIED` until then.
- `npm run seed` in `backend/` creates the demo admin, review account, rider, three
  drivers and sample completed rides.

```bash
cd backend
npm run seed
npm test
```

## Testing

```bash
cd backend && npm run lint    # syntax-check backend JavaScript
cd backend && npm test        # 90 API and Socket.IO tests with mocked repositories
cd face-service && pytest     # 26 face-service tests
cd frontend && npm run build  # production build check for all 11 pages
```

An importable Postman collection for the main REST flow lives in
[docs/shedrive.postman_collection.json](docs/shedrive.postman_collection.json).

Dependency audits: `npm audit --omit=dev` is clean in `backend/` and `frontend/`, and
`pip-audit` is clean for the face-service runtime after the Phase 10 upgrades. Development
tooling advisories and accepted demo risks are listed in
[docs/security-checklist.md](docs/security-checklist.md).

## CI/CD

- `.github/workflows/ci.yml` runs backend syntax checks and Jest, face-service syntax
  checks and pytest, the frontend production build, and a kustomize render on every pull
  request and push to `dev`/`main`.
- `.github/workflows/deploy.yml` uses GitHub OIDC to assume an AWS role, builds and pushes
  both images to ECR with commit-SHA and `latest` tags and GitHub Actions layer caching,
  updates the EKS deployments, waits for rollout, syncs the frontend to S3 and invalidates
  CloudFront.

Configure these repository secrets for deployment: `AWS_ROLE_TO_ASSUME`, `AWS_REGION`,
`EKS_CLUSTER_NAME`, `FRONTEND_BUCKET` and `CLOUDFRONT_DISTRIBUTION_ID`. Prefer OIDC over
long-lived access keys. See [docs/aws-setup.md](docs/aws-setup.md).

## Monitoring

`k8s/monitoring/` contains `kube-prometheus-stack` values, ServiceMonitors, alert rules and
a provisioned **SheDrive Operations** Grafana dashboard. It covers request rate, p95
latency, 5xx rate, active sockets, online drivers, open SOS alerts, face decisions and pod
CPU/memory.

```bash
kubectl port-forward svc/grafana 3000:80 -n monitoring
```

Installation and alert details are in
[k8s/monitoring/README.md](k8s/monitoring/README.md).

## Kubernetes and AWS

Production manifests live in `k8s/`: two backend replicas behind a `LoadBalancer`,
two internal face-service replicas, Redis for cross-pod Socket.IO rooms, probes and
resource limits, an EFS-backed licence-document volume, and restricted pod security.
The backend readiness probe uses `/health/ready`, which returns `503` until MongoDB is
connected.

Follow [docs/aws-setup.md](docs/aws-setup.md) for billing alarms, ECR, EKS, EFS, Atlas,
S3/CloudFront and cleanup. The EKS control plane and worker nodes are paid resources;
delete the cluster after the demo.

## Implementation phases

- [x] Phase 1 - scaffold, design system, Docker Compose skeleton, health endpoints, landing 3D hero
- [x] Phase 2 - face-service verification, tests, container
- [x] Phase 3 - auth and signup with face check, OTP mock, login, admin review queue
- [x] Phase 4 - rider/driver core pages, maps, fare estimate, driver online toggle and location
- [x] Phase 5 - ride flow, driver offers/counters, Socket.IO realtime offers and live tracking
- [x] Phase 6 - payments, ratings, history and wallet
- [x] Phase 7 - admin and safety, SOS flow, notifications
- [x] Phase 8 - containerization and Kubernetes
- [x] Phase 9 - CI/CD and monitoring
- [x] Phase 10 - hardening, docs, viva notes

## Design

The visual direction is "Neon Midnight City": a cinematic procedural night city with neon
routes, glassmorphism panels, magenta/cyan bloom, custom cursor, and scroll-driven camera
movement. See [docs/design-notes.md](docs/design-notes.md). The site falls back to a static
gradient when WebGL is unavailable and respects `prefers-reduced-motion` and the in-page
"Reduce effects" toggle.

## Security and privacy notes

- Passwords are hashed with bcrypt and secrets live only in environment variables.
- Raw selfies are never written to disk or logged; only numeric embeddings and results are stored.
- OTPs are HMAC-hashed with a 10-minute expiry and 5-attempt limit; the mock provider is for demos only.
- Driver licence documents are stored privately under `backend/storage/` (outside the web root) and are never served as static files.
- Admin and driver routes are role-guarded; auth and OTP routes are rate-limited.
- SOS emergency-contact delivery is a clearly labelled demo adapter: it logs masked phone
  numbers inside the process and sends nothing externally. Admins still receive an in-app
  alert immediately and every moderation/SOS action is stored with its actor and note.
- The face model is an existing open-source model (DeepFace/Facenet); we do not train one.

## Documentation

- [docs/architecture.md](docs/architecture.md) - components, request flows, state machines, deployment and failure handling.
- [docs/er-diagram.md](docs/er-diagram.md) - Mermaid ER diagram, collection rules and indexes.
- [docs/api.md](docs/api.md) - REST reference, error codes, Socket.IO events and cURL examples.
- [docs/security-checklist.md](docs/security-checklist.md) - verified controls, dependency audits and accepted demo risks.
- [docs/viva-notes.md](docs/viva-notes.md) - demo script, design decisions, limitations and likely viva questions.
- [docs/design-notes.md](docs/design-notes.md) - visual concept, palette, 3D modules, performance.
- [docs/aws-setup.md](docs/aws-setup.md) - ECR, EKS, EFS, Atlas, S3/CloudFront, monitoring and cleanup.
- [docs/shedrive.postman_collection.json](docs/shedrive.postman_collection.json) - importable API collection.
