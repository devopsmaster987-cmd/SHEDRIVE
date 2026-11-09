# SheDrive backend

Express API for SheDrive. Phase 1 added the application scaffold, standard JSON response
envelope, security headers, CORS allow-list, Prometheus metrics and health endpoint.
Phase 2 integrated the face-verification service. Phase 3 adds signup, phone OTP,
JWT login, role guards and the admin review queue. Phase 4 adds rider profile and
emergency contacts, fare estimation, nearby-driver discovery, driver dashboard,
earnings, online status and live location updates. Phase 5 adds ride requests,
driver offers/counters, rider acceptance, trip status transitions, cancellation,
history and authenticated Socket.IO delivery. Phase 6 adds mock wallet top-ups,
cash/wallet ride payments, two-sided ratings, driver rating averages and wallet
transaction history. Phase 7 adds in-ride SOS alerts, the notification inbox,
admin city statistics, account suspension, a live SOS desk and private licence
review actions. Phases 8-10 add the production Dockerfile, Kubernetes manifests,
CI/CD and monitoring integration, dependency hardening and the full documentation
set in `docs/`.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness probe with service uptime and DB state |
| GET | `/health/ready` | Readiness probe; `503` until MongoDB is connected |
| GET | `/metrics` | Prometheus metrics |
| GET | `/api` | API descriptor |
| POST | `/api/auth/signup` | Multipart signup: profile fields, `selfie`, and optional driver `licenseDoc` |
| POST | `/api/auth/verify-otp` | Verify the 6-digit code and receive a JWT |
| POST | `/api/auth/resend-otp` | Issue a fresh code for an unverified account |
| POST | `/api/auth/login` | Email/password login; requires a verified phone |
| GET | `/api/auth/me` | Current user for a bearer token |
| GET | `/api/admin/stats` | City, safety, review and revenue statistics (admin only) |
| GET | `/api/admin/users` | Search/filter accounts by role, status and text (admin only) |
| PATCH | `/api/admin/users/:id/access` | Suspend or restore a non-admin account (admin only) |
| GET | `/api/admin/review-queue` | Human identity reviews by status (admin only) |
| PATCH | `/api/admin/review-queue/:id` | Approve or reject a review item (admin only) |
| GET | `/api/admin/driver-documents` | List driver licence records by status (admin only) |
| PATCH | `/api/admin/driver-documents/:id` | Approve or reject a driving licence (admin only) |
| GET | `/api/admin/driver-documents/:filename` | Stream a private driver licence document (admin only) |
| GET | `/api/admin/sos-alerts` | Live SOS queue by status (admin only) |
| PATCH | `/api/admin/sos-alerts/:id` | Acknowledge or resolve an SOS with a note (admin only) |
| POST | `/api/sos/alerts` | Raise one SOS during an active ride (rider/driver only) |
| GET | `/api/sos/alerts/mine` | Current open/acknowledged SOS for the signed-in member |
| GET | `/api/notifications` | Latest notifications and unread count |
| PATCH | `/api/notifications/:id/read` | Mark one owned notification read |
| POST | `/api/notifications/read-all` | Mark every owned notification read |
| GET | `/api/users/me` | Current profile and emergency contacts |
| PATCH | `/api/users/me` | Update display name and up to five emergency contacts |
| POST | `/api/rides/estimate` | Rider-only distance/ETA/suggested fare estimate |
| POST | `/api/rides` | Create a ride request (approved rider) |
| GET | `/api/rides/active` | Active ride for the signed-in rider or driver |
| GET | `/api/rides/opportunities` | Nearby searching rides for an online driver |
| GET | `/api/rides` | Ride history for the signed-in user; optional `limit` |
| GET | `/api/rides/:id` | Ride details for a participant |
| GET | `/api/rides/:id/offers` | Pending offers for the rider |
| POST | `/api/rides/:id/offers` | Driver accept-or-counter offer |
| POST | `/api/rides/:id/offers/:offerId/accept` | Rider accepts one offer |
| PATCH | `/api/rides/:id/status` | Driver advances `arriving → in_progress → completed` |
| POST | `/api/rides/:id/cancel` | Rider or driver cancels an eligible ride |
| GET | `/api/payments/wallet` | Rider wallet balance and latest transactions |
| POST | `/api/payments/wallet/topup` | Add ₹100–₹10,000 of demo wallet credit |
| GET | `/api/payments/rides/:rideId` | Payment receipt/state for a ride participant |
| POST | `/api/payments/rides/:rideId` | Rider pays a completed ride by `cash` or `wallet` |
| GET | `/api/ratings/rides/:rideId` | Rating state and counterpart for a participant |
| POST | `/api/ratings/rides/:rideId` | Submit one 1–5 star rating with optional comment |
| GET | `/api/drivers/nearby` | Rider-only nearby drivers; query `lat`, `lng`, `radiusKm` |
| GET | `/api/drivers/me` | Driver profile, vehicle, location, earnings and online count |
| GET | `/api/drivers/me/earnings` | Driver earnings for today, this week and all time |
| PATCH | `/api/drivers/me/status` | Set driver online/offline (approved drivers only) |
| PATCH | `/api/drivers/me/location` | Update driver GeoJSON location (approved drivers only) |

Signup fields: `name`, `email`, `phone`, `password`, `role` (`rider`/`driver`),
`vehicleType` and `plateNumber` for drivers, plus `licenseDoc` (PDF/JPEG/PNG, 5 MB max).
`selfie` must be JPEG/PNG, 5 MB max. Successful signup returns `201` with
`phoneVerificationRequired: true` and **no token**; the token is issued only after
`verify-otp`.

OTP defaults: 6 digits, HMAC-hashed with the JWT secret, 10-minute expiry, 5 attempts.
The `mock` provider prints the code to the backend log. Twilio and Fast2SMS adapters are
explicit stubs until credentials are configured.

Fare defaults live in `.env.example`: base `40`, per-km `14`, road factor `1.25`,
minimum `50`, and vehicle multipliers Car `1`, Auto `0.72`, Bike `0.55`. A straight-line
route under `0.05 km` is rejected. Nearby-driver search uses the 2dsphere index and
returns no personal data.

Ride settings are `RIDE_SEARCH_RADIUS_KM=5`, `RIDE_OFFER_TTL_SECONDS=45` and
`RIDE_REQUEST_TTL_MINUTES=10`. Offers are upserted per driver, expire after the TTL,
and accepting one rejects the rest. The driver's `activeRide` is set on acceptance and
cleared on completion or cancellation.

Phase 6 payment rules: a ride can be paid once, only after `completed`, and the amount is
the ride's final agreed fare. Wallet payments atomically deduct the balance and write a
`ride_payment` ledger entry; cash payments record the collection without moving wallet
money. Top-ups are demo-only and limited to whole amounts from ₹100 to ₹10,000. Ratings
are one per ride per participant, 1–5 stars with a 280-character comment; a rider rating
recomputes the driver's `ratingAvg` from all received ratings.

Phase 7 safety rules: SOS is available only to a ride participant while the ride is
`accepted`, `arriving` or `in_progress`, and each member can have one `open` or
`acknowledged` alert at a time. The alert stores a GeoJSON point from the supplied
coordinates or the ride pickup. Emergency-contact delivery is a mock adapter that logs
masked phone numbers; admins receive persistent in-app notifications and a
`sos:triggered` socket event. Admins acknowledge or resolve alerts with a note, which
notifies the member and updates the `openSosAlerts` gauge. Admin suspension sets
`isBanned` with a reason, signs the member out of protected actions, takes banned drivers
offline and protects admin accounts from moderation. Licence rejection also takes the
driver offline. The seeded rider has one resolved demo SOS and a safety notification.

## Realtime

Socket.IO shares the API origin and requires the same JWT in handshake `auth.token` or
the `Authorization: Bearer` header. Each socket joins `user:<id>`; admins also join
`admins`; participants can join `ride:<id>` after a server-side membership check. Events
include `ride:request`, `offer:new`, `offer:accepted`, `ride:status`, `ride:location`,
`sos:triggered`, `sos:created` and `sos:updated`. A driver location update is persisted at
most once per second. `activeSocketConnections` and `openSosAlerts` are exposed through
Prometheus metrics.

When `REDIS_URL` is set, the server enables the Socket.IO Redis adapter so rooms and
events work across multiple backend replicas. It is blank locally; Kubernetes sets it to
the internal `shedrive-redis` service.

`npm run lint` syntax-checks all 85 JavaScript files without executing them. `npm test`
runs 90 Jest/Supertest and Socket.IO tests across 9 suites against mocked repositories;
Docker and a live MongoDB are required for true end-to-end integration.

## Run

```bash
npm install
cp .env.example .env
npm run dev     # http://localhost:5000
npm run lint    # syntax-check backend JavaScript
npm test        # Jest + Supertest
npm run seed    # demo admin + pending review item
```

`JWT_SECRET` is required before the process starts. See `.env.example` for all options.
Never commit `.env` or real secrets.

## Seed accounts

`npm run seed` creates:

| Role | Email | Password | Status |
|---|---|---|---|
| Admin | `admin@shedrive.test` | `Admin@12345` | Approved |
| Human review | `review@shedrive.test` | `Review@12345` | Under human review |
| Rider | `rider@shedrive.test` | `Rider@12345` | Approved |
| Driver (Car) | `driver@shedrive.test` | `Driver@12345` | Approved, offline |
| Driver (Auto) | `driver2@shedrive.test` | `Driver@12345` | Approved, online |
| Driver (Bike) | `driver3@shedrive.test` | `Driver@12345` | Approved, offline |

The rider and drivers have sample emergency-contact, licence-document and completed-ride
data. The rider wallet is seeded with ₹1,500 and a `TOP-SEED-DEMO` ledger entry, plus a
resolved SOS alert and its safety notification. Override
the admin/review accounts with `ADMIN_*` and `DEMO_REVIEW_*`. Passwords are
only printed outside production; change the defaults before deploying.

## Storage and privacy

- Raw selfies are streamed to the face service and never written to disk by the backend.
- Only the numeric embedding and verification result are stored on the user.
- Driver licence documents are written under `STORAGE_DIR/license-docs` with `0600`
  permissions (outside the web root) and are only referenced by admin-only APIs.
- Auth and OTP routes are rate-limited. Admin routes require a valid JWT with the admin
  role.
- SOS dispatch does not contact an external provider in this build; only masked demo
  deliveries are logged. Admin notifications, moderation reasons and SOS handling notes
  remain in MongoDB for the audit trail.

## Docker

```bash
docker build -t shedrive-backend .
docker run --rm -p 5000:5000 --env-file .env \
  -v shedrive-storage:/app/storage shedrive-backend
```

The image runs as the unprivileged `node` user and includes a container healthcheck on
`/health/ready`.

For EKS, ECR, EFS, Atlas and CloudFront deployment steps, see
[`../docs/aws-setup.md`](../docs/aws-setup.md). The backend runs two replicas behind a
`LoadBalancer`, uses Redis for Socket.IO fan-out, and mounts shared EFS storage for
driver licence documents.
