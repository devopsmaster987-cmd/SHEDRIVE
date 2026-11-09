# SheDrive security checklist

Verified during Phase 10. Each item lists the control, where it lives, and the result.

## 1. Authentication and authorisation

| Check | Status | Evidence |
|---|---|---|
| Passwords hashed with bcrypt | Pass | `bcryptjs`, `BCRYPT_ROUNDS=12` in production (4 in tests) |
| JWT access token with expiry | Pass | `JWT_EXPIRES_IN=7d`; secret required at startup in `backend/src/config/env.js` |
| No JWT issued before OTP verification | Pass | `authController.signup` returns no token; `verifyOtp` issues it |
| Phone verification enforced at login | Pass | `403 PHONE_NOT_VERIFIED` |
| Role-based access control | Pass | `requireRole` on admin and driver routes |
| Verification gate on ride actions | Pass | `requireVerified` on book, offer, pay, rate, SOS and online status |
| Banned accounts blocked | Pass | `authenticate` rejects `isBanned`; login returns `ACCOUNT_SUSPENDED` |
| Admins protected from self-suspension and admin suspension | Pass | `ADMIN_SELF_PROTECTED`, `ADMIN_PROTECTED` |
| Ride participation checked | Pass | `RIDE_FORBIDDEN` on ride, payment, rating and SOS access |
| Socket handshake authenticated | Pass | JWT checked in `src/sockets/index.js`; ride rooms require participation |

## 2. Input validation and uploads

| Check | Status | Evidence |
|---|---|---|
| Body and query validation | Pass | Joi schemas in `backend/src/validation/`; `validateBody`/`validateQuery` |
| Unknown fields rejected | Pass | Joi default behaviour (no `allowUnknown`) |
| Mongo injection protection | Pass | Typed Joi values; regex search input escaped in `adminRepository` |
| Malformed ObjectIds handled | Pass | `CastError` normalised to `400 INVALID_ID` |
| JSON body limit | Pass | `express.json({ limit: "1mb" })` |
| Selfie type and size limits | Pass | JPEG/PNG only, 5 MB, `multer.memoryStorage()` |
| Licence type and size limits | Pass | PDF/JPEG/PNG, 5 MB |
| Face-service upload limits | Pass | MIME check, 5 MB, pixel cap, decompression-bomb guard |
| Filename/path traversal protection | Pass | UUID filename regex; storage path checked in `storageService` |
| Rate limiting | Pass | 20 signup, 10 login, 10 OTP attempts per 15 minutes per IP |

## 3. Secrets and configuration

| Check | Status | Evidence |
|---|---|---|
| No secrets in source | Pass | `.env` ignored; `.env.example` placeholders only |
| Required JWT secret | Pass | Startup throws if `JWT_SECRET` is empty |
| CORS restricted | Pass | `CORS_ORIGINS` allow-list |
| Security headers | Pass | `helmet()` |
| Kubernetes secrets templated | Pass | `k8s/secrets.example.yaml`; real Secret not committed |
| GitHub Actions uses OIDC | Pass | `deploy.yml` assumes an AWS role; no long-lived keys |
| Proxy trust configured | Pass | `app.set("trust proxy", 1)` for correct client IPs |

## 4. Privacy

| Check | Status | Evidence |
|---|---|---|
| Raw selfies never persisted | Pass | Face service decodes in memory; backend never writes the selfie buffer |
| Raw selfies never logged | Pass | Logs contain decision, face_detected and confidence only |
| Only embeddings stored | Pass | `User.faceEmbedding` with `select: false` |
| Password and embedding excluded from JSON | Pass | `select: false` plus `toJSON` transform and serializers |
| OTP hashed | Pass | HMAC-SHA256 with `JWT_SECRET`; plain code never stored |
| OTP expiry and attempt cap | Pass | 10-minute TTL index; 5 attempts then `OTP_LOCKED` |
| Licence documents private | Pass | Stored outside the web root; read through an admin JWT route with `no-store` |
| Masked phone numbers in demo dispatch | Pass | `maskPhone` in `otpService`; SOS adapter does not log full numbers |
| SOS and review actions audited | Pass | `handledBy`, `reviewedBy`, `reviewedAt`, notes |

## 5. Dependency audit

Run on the Phase 10 tree:

```bash
cd backend && npm audit --omit=dev
cd frontend && npm audit --omit=dev
cd face-service && pip-audit
```

| Ecosystem | Runtime result | Notes |
|---|---|---|
| Backend | 0 vulnerabilities | Joi upgraded to 17.13.9 and Multer to 2.5.0 during Phase 10 |
| Frontend | 0 vulnerabilities | Static build dependencies only at runtime |
| Face service | 0 application vulnerabilities | FastAPI 0.162.0, Starlette 1.10.0, python-multipart 0.0.32, python-dotenv 1.2.2, pytest 9.0.3, prometheus-fastapi-instrumentator 8.1.0 |

Development-only findings (not shipped):

- Backend: 20 low/moderate advisories from the Jest test tooling. The production
  dependency tree is clean; fixing them requires major Jest upgrades.
- Frontend: one moderate advisory in the Vite/esbuild development server. It does not
  affect the static production build; the fix is Vite 8 (a breaking major upgrade).

`pip-audit` still reports a vulnerability in `pip` itself when auditing the development
virtualenv. `pip` is a build tool, not a runtime dependency of the service image.

## 6. Network and deployment

| Check | Status | Evidence |
|---|---|---|
| Face service not public | Pass | `ClusterIP` Service; NetworkPolicy allows backend ingress only |
| Redis not public | Pass | ClusterIP; NetworkPolicy allows backend ingress only |
| Backend readiness gates traffic | Pass | `/health/ready` returns 503 until MongoDB connects |
| Liveness does not restart on DB outage | Pass | `/health` ignores DB state; readiness handles routing |
| Non-root containers | Pass | Backend and face-service run as non-root users |
| Dropped capabilities / seccomp | Pass | Kubernetes security contexts |
| Resource requests and limits | Pass | `k8s/backend.yaml`, `k8s/face-service.yaml` |
| EFS shared safely | Pass | `ReadWriteMany` for licence documents |
| Images scanned on push | Pass | ECR `scanOnPush=true` in the setup guide |

## 7. Error handling

| Check | Status | Evidence |
|---|---|---|
| Consistent error envelope | Pass | `{ success, data, error }` for every route |
| No stack traces exposed | Pass | `errorHandler` hides 5xx internals |
| Unknown routes handled | Pass | `notFound` returns `404 NOT_FOUND` |
| Upload errors normalised | Pass | Multer errors mapped to 400/413 |
| Duplicate key errors mapped | Pass | `11000` mapped to `EMAIL_TAKEN`/`PHONE_TAKEN` |

## 8. Remaining risks accepted for the demo

| Risk | Why it remains | Mitigation / next step |
|---|---|---|
| No liveness detection | Adds cost/complexity; demo only | Integrate a liveness SDK or challenge-response |
| Mock OTP logs codes | No SMS provider configured | Add Twilio/Fast2SMS credentials; keep the log mock dev-only |
| Mock payments | No gateway account | Use a payment sandbox with webhooks and signature checks |
| Mock SOS contact dispatch | Safety and cost | Integrate a real on-call/emergency provider |
| `/metrics` public in the demo cluster | Convenient for the viva | Restrict at the load balancer or expose on an internal service |
| Per-process rate limiting | Single Redis-less local setup | Use a shared store (Redis) for distributed limits |
| No refresh-token revocation | Simplicity | Short-lived tokens, refresh rotation, denylist |
| Model fairness not measured | No labelled evaluation set | Run a documented accuracy/bias study before real use |
| Embedding not used for duplicate detection yet | Out of scope | Add a similarity threshold with human review |

## 9. Commands used to verify Phase 10

```bash
cd backend
npm run lint                 # 85 files pass
npm test                     # 90 passing
npm audit --omit=dev         # 0 vulnerabilities

cd ../face-service
./.venv/Scripts/python.exe -m pytest   # 26 passing
./.venv/Scripts/python.exe -m pip_audit

cd ../frontend
npm run build                # 11 pages built
npm audit --omit=dev         # 0 vulnerabilities

cd ..
kubectl kustomize k8s > /dev/null
kubectl kustomize k8s/monitoring > /dev/null
```
