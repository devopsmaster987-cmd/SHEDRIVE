# SheDrive viva notes

A study guide for the final-year project review: what was built, why, how to demo it, and
the honest answers to the difficult questions - especially about face-verification
accuracy, privacy, and the limits of the demo.

## 1. One-minute pitch

SheDrive is a women-only ride-hailing web platform. Riders and drivers both sign up with a
selfie. A Python face-verification service predicts gender and returns a confidence score.
A confident female prediction auto-approves the account; anything uncertain goes to a human
admin review queue instead of being rejected. Once approved, a rider proposes a fare,
nearby drivers accept it or send a counter-offer, and the rider chooses. The trip then runs
over REST plus Socket.IO with live location, notifications, a two-step SOS flow, a mock
wallet or cash payment, and two-sided ratings. The app runs locally with Docker Compose and
deploys to AWS EKS with Prometheus and Grafana.

## 2. Problem and users

**Problem.** Ride-hailing safety concerns are a common reason women avoid or limit their
use of ride-hailing. Generic platforms also use opaque algorithmic pricing that riders may
distrust. SheDrive explores two ideas together: a women-only network with a verification
gate, and a negotiated fare that the rider controls.

**Primary users**

- Rider: books a trip, offers a price, tracks the driver, can trigger SOS, pays and rates.
- Driver: goes online, sees nearby requests, accepts or counters, runs the trip.
- Admin / safety reviewer: reviews uncertain signups and driver licences, moderates
  accounts, and handles the live SOS queue.

**Scope.** This is a final-year demonstration project, not a commercial service. Payments,
OTP delivery and emergency-contact dispatch are deliberately mocked or stubbed.

## 3. What is implemented

| Area | Delivered |
|---|---|
| Landing | "Neon Midnight City" procedural Three.js hero, scroll camera, bloom, fallbacks |
| Auth | Selfie signup, face decision, OTP mock, JWT login, review messaging |
| Rider | Map booking, fare estimate, custom offer, live offers, tracking, SOS, payment, rating, history, wallet |
| Driver | Online toggle, live location, request radar, accept/counter, active trip, earnings |
| Admin | Stats, 3D analytics, SOS desk, account moderation, identity queue, licence review |
| Realtime | Socket.IO rooms for requests, offers, status, location, SOS, account updates |
| Platform | Docker Compose, Kubernetes manifests, EFS/Redis/Atlas integration, CI/CD, monitoring |
| Quality | 90 backend tests, 26 face-service tests, frontend production build, lint, kustomize render |

All ten phases from the project brief are complete. Phase 10 adds the documentation in
this folder and the security review.

## 4. Ten-minute demo script

1. **Landing (1 min).** Open `http://localhost:8080`. Show the night-city hero, scroll
   camera, custom cursor, and the "Reduce effects" toggle. Reload with reduced motion to
   show the fallback.
2. **Signup + review (2 min).** Sign up as a rider with a selfie. If the face result is
   uncertain, show the friendly "under review" state. Log in as `review@shedrive.test`
   (password `Review@12345`), open the review queue and approve the account. Point out that
   the account is never called "rejected" in the signup UI.
3. **Rider books (2 min).** Log in as `rider@shedrive.test` (`Rider@12345`). On
   `/book.html`, pick two points, choose Car, show the distance/ETA/suggested fare, then
   send a custom offer (for example INR 85).
4. **Driver responds (2 min).** In a second browser profile, log in as
   `driver@shedrive.test` (`Driver@12345`). Go online, accept the request or send a counter
   offer from the radar.
5. **Rider accepts + tracks (1 min).** Accept the driver's offer on `/ride.html`, then move
   the driver on the map to show `ride:location` updates (or let the browser geolocation
   update).
6. **Trip + SOS (1 min).** On `/driver-ride.html`, mark arriving, start, then complete.
   During the trip, open the SOS orb to show the two-step confirm (do not confirm in a real
   demo unless you want to show the admin queue).
7. **Payment + rating (1 min).** On `/summary.html`, pay with cash or wallet and submit a
   star rating. Open `/history.html` to show the ledger and wallet balance.
8. **Admin (1 min).** On `/admin.html`, show the live counters, 3D city, SOS queue, account
   moderation and recent rides. On `/admin-review.html`, open a licence document through the
   authenticated preview.
9. **Ops (1 min).** Show `.github/workflows/ci.yml`, `k8s/`, and the Grafana dashboard /
   `kubectl port-forward` command. Mention the cost warning.

**Demo accounts**

| Role | Email | Password |
|---|---|---|
| Admin | `admin@shedrive.test` | `Admin@12345` |
| Human review | `review@shedrive.test` | `Review@12345` |
| Rider | `rider@shedrive.test` | `Rider@12345` |
| Driver (Car) | `driver@shedrive.test` | `Driver@12345` |
| Driver (Auto) | `driver2@shedrive.test` | `Driver@12345` |
| Driver (Bike) | `driver3@shedrive.test` | `Driver@12345` |

The seeded rider wallet starts at INR 1,500. The mock OTP appears in the backend log as
`[otp:mock] code=...`.

## 5. Architecture in plain language

```
Browser (Vite pages)
   |  REST /api + Socket.IO
   v
Express API  --->  MongoDB (users, rides, offers, payments, ratings, SOS)
   |    |
   |    +------>  Redis (optional, shares realtime rooms across replicas)
   |    +------>  EFS / local storage (private licence documents)
   v
Python face service (DeepFace, in-memory selfie processing)
```

- The API is stateless; sessions live in JWTs. That lets it run as two or more replicas.
- The face service is separate because it is Python + heavy ML, scales differently, and
  should fail independently of the API.
- Socket.IO handles realtime; Redis keeps rooms consistent when there are multiple API pods.
- MongoDB stores documents with GeoJSON points and 2D sphere indexes for nearby queries.

See [architecture.md](architecture.md) for diagrams and failure handling, and
[er-diagram.md](er-diagram.md) for the data model.

## 6. Key design decisions

| Decision | Why |
|---|---|
| Separate face-service microservice | Python ML stack, independent scaling, internal-only network, failure isolation |
| DeepFace/Facenet as a first-pass filter | Free, open-source, no training data needed, easy to explain |
| Never auto-reject on the model alone | Gender classification is probabilistic and can be wrong; a human decides |
| Human review with ID/licence fallback | Safety plus a route for false negatives and edge cases |
| Raw selfie in memory only | Privacy by design; only the embedding and decision are stored |
| Rider-set fare + driver counters | inDrive-style negotiation; rider controls price |
| Conditional Mongo updates for assignment | Prevents double booking without a distributed transaction |
| Socket.IO with polling fallback | Core trip flow still works on unreliable networks |
| Redis adapter optional | Simple local setup; multi-replica correctness in production |
| Mock OTP, payment and SOS dispatch | Keeps the project free, safe and demonstrable |
| Docker Compose + EKS manifests | Same containers locally and in the cloud |
| GitHub OIDC for deploys | No long-lived AWS access keys in GitHub |

## 7. The gender-verification limitation (most important)

### What the model actually does

`DeepFace.analyze(actions=["gender"])` returns a probability distribution over "Woman" and
"Man" for a detected face. SheDrive takes the higher value as the prediction and its
probability as the confidence. If the prediction is female and confidence is at least
`CONF_THRESHOLD` (default 0.85), the account is auto-approved. Everything else becomes
`pending_review`.

`DeepFace.represent(model_name="Facenet512")` produces a 512-float embedding. SheDrive
stores that numeric vector, not the image.

### Why this is only a first-pass filter

- The model predicts a visual gender presentation, not a person's identity or chromosomes.
- Accuracy drops with poor lighting, motion blur, occlusion, makeup, facial hair, glasses,
  head coverings, camera angle, and skin-tone/representation gaps in the training data.
- A confident wrong prediction is possible. That is exactly why the threshold is not a
  rejection rule.
- There is no liveness detection in this build, so someone could upload another person's
  photo. This is a known limitation, not a solved problem.

### What happens when the model is unsure

| Situation | System behaviour |
|---|---|
| No face / multiple faces / unreadable image | Ask the user to retake; no account is created |
| Female with confidence >= 0.85 | Auto-approve |
| Low confidence, male prediction, or unknown | Create account as `pending_review`, add to admin queue |
| Face service down or timeout | Fail safe: `pending_review`, never auto-approve |
| Admin approves | `verificationStatus = approved`; rides unlock |
| Admin rejects | `verificationStatus = rejected`; the member is told to contact support |

The signup UI never displays "rejected". It says "Your account is under review". A human
reviewer can approve an account the model was unsure about, which also handles transgender
and non-binary applicants more respectfully than an automatic rejection.

### What SheDrive does not claim

- It does not claim to measure biological sex or gender identity.
- It does not claim a measured accuracy percentage from our own validation set. We did not
  collect a labelled evaluation dataset; quoting a number would be misleading.
- It does not claim that the model is fair across all demographics.
- It does not use the embedding to identify a specific person or to match faces across
  accounts in this build.

### The honest answer to "isn't this discrimination?"

The model is a screening aid, not the final authority. Anyone can request human review, and
a human makes the final decision. The design deliberately avoids automated rejection,
avoids presenting the prediction as certainty, limits what is stored, and keeps the
verification data out of normal API responses. For a production system, the next steps would
be a documented impact assessment, a measured bias/accuracy study, liveness detection, an
appeal process, and a self-declaration plus ID-review path.

## 8. Privacy-by-design checklist

| Principle | Implementation |
|---|---|
| Data minimisation | Raw selfies are never persisted; only a numeric embedding, confidence and decision |
| Purpose limitation | Embedding is used only for the signup decision/audit; not shared with other users |
| Storage limitation | OTPs expire via a TTL index; selfies have zero retention |
| Integrity/confidentiality | Bcrypt passwords, HMAC OTP hashes, JWT auth, private licence storage, helmet |
| Accountability | Admin review records `reviewedBy`, `reviewedAt` and a note; SOS actions record the handling admin |
| Transparency | README and UI explain that the check is a first-pass filter with human review |
| User control | Profile and emergency contacts are editable; phone/email are locked to protect verification |

## 9. Security review summary

Verified during Phase 10:

- Passwords use bcrypt with 12 rounds in production (4 in tests).
- JWT expiry is set (`7d` default); the secret is required at startup.
- All routes validate bodies/queries with Joi; unknown fields are rejected.
- Auth, login and OTP routes are rate-limited.
- Uploads are MIME-checked and size-capped; selfies are JPEG/PNG only; licence docs are
  PDF/JPEG/PNG only.
- Every admin and driver route is role-guarded; ride actions also require approval.
- SOS and admin actions are authorised by ride participation or admin role.
- Licence documents are written with mode `0600`, read only through an admin JWT route, and
  served with `Cache-Control: private, no-store`.
- CORS is restricted to `CORS_ORIGINS`; helmet sets security headers.
- `npm audit --omit=dev` reports 0 vulnerabilities after upgrading Joi and Multer.
- No secrets are committed; `.env` files are ignored and `.env.example` files contain
  placeholders.

Remaining risks (documented, not hidden):

- No liveness/anti-spoof check on selfies.
- The demo OTP provider logs codes; not suitable for production.
- Payments and SOS dispatch are mocks.
- `/metrics` is publicly reachable in the demo cluster; restrict it at the load balancer
  for a real deployment.
- Rate limiting is per-IP in a single process; a distributed store is better at scale.

Full checklist: [security-checklist.md](security-checklist.md).

## 10. Testing and evidence

```bash
cd backend && npm run lint       # 85 JavaScript files pass syntax checks
cd backend && npm test           # 90 tests across 9 suites
cd face-service && pytest        # 26 tests
cd frontend && npm run build     # 11-page production build
kubectl kustomize k8s > /dev/null
kubectl kustomize k8s/monitoring > /dev/null
```

What the tests cover:

- Backend: auth/OTP, face decision handling, health/readiness, ride lifecycle, offers,
  payments/wallet, ratings, SOS, admin actions, storage path safety, Socket.IO handshake and
  room authorisation. Repositories are mocked, so tests are fast and do not need MongoDB.
- Face service: image validation (type, size, dimensions, decompression bombs), decision
  boundaries, `no_face` handling, embedding shape, health and metrics. DeepFace is mocked for
  fast unit tests; there is no real-model accuracy test.
- Frontend: production build of all eleven pages, including code-split Three.js and Leaflet.

Not covered: live end-to-end browser tests against a real MongoDB/DeepFace stack, and
real-model accuracy/bias evaluation. These are stated as limitations.

## 11. Deployment and operations

- **Local:** `cp .env.example .env`, set `JWT_SECRET`, `docker compose up --build`. Compose
  starts MongoDB, a one-shot seed job, the backend, the face service and nginx.
- **Cloud:** GitHub Actions assumes an AWS role via OIDC, builds both images, pushes
  commit-SHA and `latest` tags to ECR, updates the EKS deployments, waits for rollout, syncs
  `dist/` to S3 and invalidates CloudFront.
- **Monitoring:** Prometheus scrapes both services; Grafana shows request rate, p95 latency,
  5xx rate, active sockets, online drivers, open SOS alerts, face decisions and pod
  CPU/memory. Alerts cover scrapes down, high error rate, high latency, lingering SOS alerts
  and a `no_face` spike.
- **Cost:** the EKS control plane is about USD 0.10/hour before nodes, NAT, load balancers,
  EFS, Atlas, S3 and CloudFront. Delete the cluster after the demo.

## 12. Likely viva questions and answers

**Why MongoDB instead of PostgreSQL?**
Ride pickup/drop are GeoJSON points and `$geoNear` gives nearby-driver and nearby-ride
queries directly. Documents for rides/offers are naturally nested and change quickly. The
trade-off is weaker relational constraints, so uniqueness and state transitions are enforced
in the application and with indexes.

**Why a separate Python service for the face check?**
DeepFace/OpenCV are Python libraries. Keeping them out of Node isolates memory-heavy ML,
lets the service scale independently, and means a model failure cannot crash the API. The
service is ClusterIP-only in Kubernetes.

**How do you prevent double booking?**
Accepting an offer is a conditional update on the ride: `{ _id, status: "searching",
driver: null }`. Only one request can set the driver. Offers are then marked accepted or
rejected in one flow. A driver also has an `activeRide` guard.

**What if two riders accept the same driver?**
The second conditional update fails, and the API returns `409 RIDE_ALREADY_ACCEPTED`. The
driver's `activeRide` is checked when sending a new offer.

**How is the fare calculated?**
Straight-line distance is expanded by a road factor (1.25), then base fare plus per-km rate,
multiplied by a vehicle factor, rounded to 5, with a minimum. The rider can still offer any
integer between INR 20 and 10,000.

**How does live tracking work?**
The driver sends `driver:location` over an authenticated socket at most once per second; the
server validates the coordinates, confirms the driver is assigned to that ride, stores the
latest point and broadcasts `ride:location`. The rider page smooths the marker between
updates. If Socket.IO drops, the pages poll the REST API.

**Why Redis?**
Socket.IO's in-memory rooms live inside one pod. With two API replicas behind the load
balancer, a rider could be connected to pod A while the driver is on pod B. The Redis adapter
publishes events across pods. Local development leaves `REDIS_URL` empty and uses the
in-memory adapter.

**What happens if the face service is unavailable?**
Signup still creates the account, but always as `pending_review`, and adds a review entry
saying automatic verification was unavailable. The system fails safe; it never auto-approves
without a model result.

**Why store an embedding if you do not use it for matching?**
It is the numeric, privacy-preserving record of the verification step. It could support
duplicate-account detection or a future re-check. In this build it is not used to identify or
match people, and it is never returned by the API.

**How do you protect driver licence documents?**
They are written to private storage (EFS in production) with restricted permissions, never
served by nginx or S3, and read only through an admin-authenticated handler that validates the
UUID filename. Responses use `Cache-Control: private, no-store`.

**How do you handle the SOS path?**
Only an active-ride participant can raise an SOS. The server stores the alert, notifies the
member and every admin, broadcasts to the admin room, and lets admins acknowledge/resolve
with a note. The emergency-contact adapter is clearly labelled as a demo and masks phone
numbers; it does not contact real services.

**Why no refresh token?**
For a student demo, a single 7-day access token is simpler and avoids refresh-token rotation
and revocation storage. A production system should add short-lived access tokens, refresh
tokens, and a revocation/denylist strategy.

**How would you scale the face service?**
It is CPU/memory heavy; concurrency is limited by a semaphore. Scale replicas horizontally
and cap concurrency per pod, or add a queue. Keep the model preloaded in the image so pods do
not download weights at startup.

**What is the biggest weakness?**
Verification accuracy and the lack of liveness detection. A first-pass model plus human
review is a reasonable student design, but it is not a strong identity proof. The next steps
are liveness, ID matching, an appeal process and a measured bias/accuracy evaluation.

**What would you do with more time?**
Liveness detection and ID-document matching; a real payment gateway sandbox; a proper
end-to-end test suite with Playwright and a real MongoDB container; push notifications;
refresh tokens and a token denylist; S3 signed URLs instead of EFS; a distributed rate-limit
store; and a measured face-model evaluation across diverse images.

**What did you learn?**
How to split a system into independently deployable services, how to design fail-safe
verification, how to keep realtime state consistent across replicas, how to enforce ride
state transitions without distributed transactions, and how much of the work is
documentation, security review and honest limitation-setting rather than features.

## 13. Limitations and future work

| Limitation | Impact | Future work |
|---|---|---|
| Probabilistic gender model | False negatives/positives | Liveness, ID match, measured evaluation, appeals |
| No liveness/anti-spoof | Photo of another person could pass | Challenge-response or certified liveness SDK |
| OTP is mocked | Not production-ready | Twilio/Fast2SMS adapter with real credentials |
| Payments are recorded, not processed | No real money movement | Payment gateway sandbox + webhooks |
| SOS contacts are mocked | No external dispatch | On-call integration with a real provider |
| Wallet balance is denormalised | Concurrent writes need care | Atomic ledger-first design or database transaction |
| No refresh tokens | Long-lived token if stolen | Short access token + rotation + revocation |
| Metrics endpoint is public | Information exposure | Internal scrape only / auth at the LB |
| Dev-only Jest vulnerabilities | Only affects development tooling | Upgrade Jest when the ecosystem allows |
| No browser E2E tests | UI regressions caught late | Playwright suite in CI |

## 14. Quick commands

```bash
# Full local stack
cp .env.example .env
# edit JWT_SECRET, then:
docker compose up --build

# Backend
cd backend
npm run lint
npm test
npm run seed

# Face service
cd face-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pytest
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
npm run build

# Monitoring (after Helm install)
kubectl port-forward svc/grafana 3000:80 -n monitoring
kubectl port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090 -n monitoring
```

## 15. Glossary

| Term | Meaning |
|---|---|
| DeepFace | Open-source Python face-analysis library used for gender prediction and embeddings |
| Facenet512 | Face-embedding model that produces a 512-number vector |
| Embedding | Numeric representation of a face; not a photo |
| Confidence threshold | Minimum probability for automatic approval (0.85 by default) |
| `pending_review` | Account created but waiting for a human decision |
| `auto_approved` | Face result was female and confident enough |
| `needs_review` | Face result was uncertain or not confidently female |
| GeoJSON Point | MongoDB location format `{ type: "Point", coordinates: [lng, lat] }` |
| `$geoNear` | MongoDB aggregation stage used for nearby driver/ride queries |
| Socket.IO room | Named realtime channel; used for `user:<id>`, `ride:<id>`, `admins` |
| Redis adapter | Socket.IO adapter that shares rooms across multiple backend pods |
| OIDC | OpenID Connect; lets GitHub Actions assume an AWS role without stored keys |
