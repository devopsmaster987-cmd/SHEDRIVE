# SheDrive API reference

Base URLs:

| Environment | API base | Realtime |
|---|---|---|
| Docker Compose | `http://localhost:5000/api` | `http://localhost:5000/socket.io` |
| Vite dev | `/api` (proxied to `:5000`) | `/socket.io` (proxied) |
| AWS | CloudFront path `/api/*` forwarded to the EKS load balancer | `/socket.io/*` forwarded with WebSocket support |

All responses use the same envelope:

```json
{ "success": true, "data": { }, "error": null }
```

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Enter a valid phone number.",
    "details": [{ "field": "phone", "message": "Enter a valid phone number." }]
  }
}
```

`details` is optional. Server errors never expose internal stack traces.

## 1. Conventions

### Authentication

Send the JWT access token on every protected request:

```
Authorization: Bearer <token>
```

Tokens are issued only after phone OTP verification, last `JWT_EXPIRES_IN` (7 days by
default). A missing or invalid token returns `401 AUTH_REQUIRED`, `INVALID_TOKEN` or
`TOKEN_EXPIRED`.

### Roles and verification

| Role | Can do |
|---|---|
| `rider` | Estimate, book, accept offers, pay, rate, view wallet/history |
| `driver` | Go online, publish location, see opportunities, send offers, update trip status |
| `admin` | Stats, moderation, review queues, driver documents, SOS desk |

`requireVerified` gates ride actions:

| `verificationStatus` | Result |
|---|---|
| `approved` | Allowed |
| `pending`, `pending_review` | `403 ACCOUNT_PENDING_REVIEW` |
| `rejected` | `403 ACCOUNT_REJECTED` |
| `isBanned` | `401 ACCOUNT_UNAVAILABLE` |

### Rate limits

Applied per client IP with a 15-minute window (disabled in tests):

| Route group | Limit | Error code |
|---|---|---|
| `POST /auth/signup` | 20 | `AUTH_RATE_LIMITED` |
| `POST /auth/login` | 10 | `LOGIN_RATE_LIMITED` |
| `POST /auth/verify-otp`, `/auth/resend-otp` | 10 | `OTP_RATE_LIMITED` |

Standard `RateLimit-*` headers are returned.

### Uploads and body limits

- JSON bodies: 1 MB.
- `selfie`: JPEG or PNG, 5 MB maximum.
- `licenseDoc`: PDF, JPEG or PNG, 5 MB maximum.
- Signup is `multipart/form-data`; all other write routes are JSON.

### Pagination

Admin list routes accept `page` (1-based) and `limit` (max 100) and return
`{ items, total, page, limit }`. Ride history and notifications accept `limit` only.

## 2. Health and metrics

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Liveness with uptime and MongoDB state |
| GET | `/health/ready` | None | Readiness; `503 NOT_READY` until MongoDB is connected |
| GET | `/metrics` | None | Prometheus metrics |
| GET | `/api` | None | API name, version and phase |

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "backend",
    "uptimeSeconds": 128,
    "database": "connected",
    "timestamp": "2026-01-01T10:00:00.000Z"
  }
}
```

## 3. Auth

### POST /api/auth/signup

`multipart/form-data`, no auth.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | 2-80 characters |
| `email` | string | Yes | Lower-cased, unique |
| `phone` | string | Yes | Digits, spaces, `-`, optional leading `+` |
| `password` | string | Yes | 8-72 characters, at least one letter and one number |
| `role` | string | Yes | `rider` or `driver` |
| `selfie` | file | Yes | JPEG/PNG, 5 MB |
| `vehicleType` | string | Drivers | `Car`, `Auto` or `Bike` |
| `plateNumber` | string | Drivers | 4-14 letters, digits, spaces or hyphens |
| `licenseDoc` | file | Drivers | PDF/JPEG/PNG, 5 MB |

The selfie is verified before the account is created. No JWT is returned here.

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "66f1c0a1e2b3c4d5e6f7a8b9",
      "name": "Aisha Khan",
      "email": "aisha@example.com",
      "phone": "+919876543210",
      "role": "rider",
      "verificationStatus": "pending_review",
      "phoneVerified": false,
      "emergencyContacts": [],
      "walletBalance": 0,
      "isBanned": false,
      "createdAt": "2026-01-01T10:00:00.000Z"
    },
    "phoneVerificationRequired": true,
    "otpExpiresInSeconds": 600,
    "reviewRequired": true
  }
}
```

Signup errors:

| Status | Code | Meaning |
|---|---|---|
| 409 | `EMAIL_TAKEN`, `PHONE_TAKEN` | Duplicate account |
| 415 | `UNSUPPORTED_FILE_TYPE` | Wrong upload type |
| 422 | `SELFIE_REQUIRED` | No selfie attached |
| 422 | `FACE_NOT_DETECTED`, `INVALID_SELFIE` | Retake needed |
| 422 | `LICENSE_DOCUMENT_REQUIRED` | Driver without licence |

The mock OTP is printed in the backend log, for example:

```
[otp:mock] code=123456 phone=********3210
```

### POST /api/auth/verify-otp

```json
{ "email": "aisha@example.com", "otp": "123456" }
```

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "id": "...", "phoneVerified": true, "verificationStatus": "approved" }
  }
}
```

Errors: `400 OTP_INVALID`, `410 OTP_EXPIRED`, `429 OTP_LOCKED` (5 failed attempts),
`409 PHONE_ALREADY_VERIFIED`.

### POST /api/auth/resend-otp

```json
{ "email": "aisha@example.com" }
```

Always returns `202` with `{ sent: true, otpExpiresInSeconds }` so it does not reveal
whether an account exists. The old code is deleted and replaced.

### POST /api/auth/login

```json
{ "email": "aisha@example.com", "password": "Example123" }
```

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "id": "...", "role": "rider" }
  }
}
```

Errors: `401 INVALID_CREDENTIALS`, `403 PHONE_NOT_VERIFIED`, `403 ACCOUNT_SUSPENDED`.

### GET /api/auth/me

Returns `{ user }` for the authenticated account.

## 4. Users

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| GET | `/api/users/me` | Any | - | Current profile |
| PATCH | `/api/users/me` | Any | `{ name, emergencyContacts }` | Update name and up to five contacts |

```json
{
  "name": "Aisha Khan",
  "emergencyContacts": [
    { "name": "Mariam Khan", "phone": "+919876543211", "relationship": "Sister" }
  ]
}
```

Email, phone, role and verification status are intentionally not editable.

## 5. Drivers

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/drivers/nearby?lat=&lng=&radiusKm=` | Rider | Nearby online drivers (1-25 km, default 5) |
| GET | `/api/drivers/me` | Driver | Dashboard: user, driver profile, earnings, online count |
| GET | `/api/drivers/me/earnings` | Driver | Today, week and total earnings |
| PATCH | `/api/drivers/me/status` | Driver (verified) | `{ isOnline: true }` |
| PATCH | `/api/drivers/me/location` | Driver (verified) | `{ lat, lng }` |

Nearby response:

```json
{
  "success": true,
  "data": {
    "radiusKm": 5,
    "drivers": [
      {
        "id": "...",
        "vehicleType": "Car",
        "ratingAvg": 4.8,
        "distanceKm": 1.2,
        "currentLocation": { "lng": 72.8777, "lat": 19.076 }
      }
    ]
  }
}
```

Earnings response:

```json
{
  "success": true,
  "data": {
    "earnings": { "today": 0, "week": 450, "total": 450, "trips": 3, "currency": "INR" }
  }
}
```

A driver with a rejected licence cannot go online (`403 LICENCE_REJECTED`).

## 6. Rides and offers

### POST /api/rides/estimate

Rider only.

```json
{
  "pickup": { "lat": 19.076, "lng": 72.8777, "label": "Bandra Station" },
  "drop": { "lat": 19.1197, "lng": 72.8464, "label": "Andheri West" },
  "vehicleType": "Car"
}
```

```json
{
  "success": true,
  "data": {
    "estimate": {
      "vehicleType": "Car",
      "distanceKm": 3.4,
      "straightLineKm": 2.7,
      "durationMinutes": 10,
      "suggestedFare": 90,
      "currency": "INR",
      "pickup": { "lat": 19.076, "lng": 72.8777, "label": "Bandra Station" },
      "drop": { "lat": 19.1197, "lng": 72.8464, "label": "Andheri West" }
    }
  }
}
```

Errors: `422 ROUTE_TOO_SHORT` when points are closer than 50 m.

### POST /api/rides

Rider only, verified. Creates a `searching` ride and notifies online drivers of the same
vehicle type within `RIDE_SEARCH_RADIUS_KM`.

```json
{
  "pickup": { "lat": 19.076, "lng": 72.8777, "label": "Bandra Station" },
  "drop": { "lat": 19.1197, "lng": 72.8464, "label": "Andheri West" },
  "vehicleType": "Car",
  "offeredPrice": 85
}
```

Returns `201` with `{ ride, driversNotified }`. Errors: `409 RIDE_ALREADY_ACTIVE`,
`422 VALIDATION_ERROR`, `403 ACCOUNT_PENDING_REVIEW`.

A serialized ride looks like:

```json
{
  "id": "66f1c0a1e2b3c4d5e6f7a8b9",
  "status": "searching",
  "rider": { "id": "...", "name": "Aisha Khan" },
  "driver": null,
  "pickup": { "lng": 72.8777, "lat": 19.076, "label": "Bandra Station" },
  "drop": { "lng": 72.8464, "lat": 19.1197, "label": "Andheri West" },
  "vehicleType": "Car",
  "distanceKm": 3.4,
  "durationMinutes": 10,
  "offeredPrice": 85,
  "finalPrice": null,
  "acceptedOffer": null,
  "canCancel": true,
  "createdAt": "2026-01-01T10:05:00.000Z",
  "acceptedAt": null,
  "arrivedAt": null,
  "startedAt": null,
  "completedAt": null,
  "cancelledAt": null,
  "cancelledBy": null,
  "cancellationReason": ""
}
```

When the authenticated user is the rider and there are pending offers, `offers` is added
to the ride object.

### Other ride routes

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/rides/active` | Any | Active ride or `{ ride: null }` |
| GET | `/api/rides?limit=` | Any | Ride history, newest first (max 50) |
| GET | `/api/rides/:id` | Participant | One ride with pending offers for the rider |
| GET | `/api/rides/opportunities` | Driver (verified) | Nearby searching rides for an online driver |
| GET | `/api/rides/:id/offers` | Rider | Pending offers, cheapest first |
| POST | `/api/rides/:id/offers` | Driver (verified) | Send or update a pending offer |
| POST | `/api/rides/:id/offers/:offerId/accept` | Rider (verified) | Accept one offer atomically |
| PATCH | `/api/rides/:id/status` | Assigned driver | `arriving`, `in_progress` or `completed` |
| POST | `/api/rides/:id/cancel` | Participant (verified) | `{ reason }`; allowed while searching/accepted/arriving |

Create offer body:

```json
{ "offerPrice": 95, "note": "Two minutes away" }
```

Offer response:

```json
{
  "success": true,
  "data": {
    "offer": {
      "id": "...",
      "rideId": "...",
      "driver": {
        "id": "...",
        "name": "Priya Sharma",
        "vehicleType": "Car",
        "plateNumber": "MH01AB1234",
        "ratingAvg": 4.9
      },
      "offerPrice": 95,
      "note": "Two minutes away",
      "status": "pending",
      "expiresAt": "2026-01-01T10:06:00.000Z",
      "respondedAt": null,
      "createdAt": "2026-01-01T10:05:15.000Z"
    }
  }
}
```

Offer errors: `409 DRIVER_OFFLINE`, `409 DRIVER_ACTIVE_RIDE`, `422 VEHICLE_MISMATCH`,
`409 RIDE_NOT_OPEN`, `409 OFFER_UNAVAILABLE`, `403 LICENCE_REJECTED`.

Status transitions are strictly `accepted -> arriving -> in_progress -> completed`; any
other transition returns `409 INVALID_RIDE_TRANSITION`. Completing a ride frees the
driver's `activeRide`.

## 7. Payments and wallet

| Method | Path | Role | Body | Description |
|---|---|---|---|---|
| GET | `/api/payments/wallet` | Rider | - | Balance plus the last 30 ledger entries |
| POST | `/api/payments/wallet/topup` | Rider (verified) | `{ amount }` (100-10,000) | Mock top-up |
| GET | `/api/payments/rides/:rideId` | Participant | - | Payment for a completed ride |
| POST | `/api/payments/rides/:rideId` | Rider (verified) | `{ method: "cash" }` or `{ method: "wallet" }` | Record payment |

Payment response:

```json
{
  "success": true,
  "data": {
    "payment": {
      "id": "...",
      "rideId": "...",
      "amount": 95,
      "currency": "INR",
      "method": "wallet",
      "status": "paid",
      "reference": "PAY-...",
      "paidAt": "2026-01-01T10:20:00.000Z",
      "createdAt": "2026-01-01T10:20:00.000Z"
    },
    "transaction": {
      "id": "...",
      "type": "ride_payment",
      "amount": 95,
      "balanceAfter": 1405,
      "currency": "INR",
      "rideId": "...",
      "description": "Ride fare",
      "reference": "PAY-...",
      "createdAt": "2026-01-01T10:20:00.000Z"
    },
    "wallet": { "balance": 1405, "currency": "INR" }
  }
}
```

Errors: `409 RIDE_NOT_COMPLETED`, `409 PAYMENT_ALREADY_COMPLETE`,
`402 INSUFFICIENT_WALLET_BALANCE`, `404 RIDE_NOT_FOUND`, `403 RIDE_FORBIDDEN`.

## 8. Ratings

| Method | Path | Role | Body | Description |
|---|---|---|---|---|
| GET | `/api/ratings/rides/:rideId` | Participant | - | `{ canRate, counterpart, rating }` |
| POST | `/api/ratings/rides/:rideId` | Participant (verified) | `{ stars, comment }` | Rate the other side once |

```json
{ "stars": 5, "comment": "Safe and punctual" }
```

When a rider rates a driver, the response includes `driverRating: { ratingAvg, count }`
and the driver's average is recomputed. Errors: `409 RIDE_NOT_COMPLETED`,
`409 RATING_ALREADY_SUBMITTED`, `403 RIDE_FORBIDDEN`.

## 9. SOS

| Method | Path | Role | Body | Description |
|---|---|---|---|---|
| GET | `/api/sos/alerts/mine` | Any | - | The caller's open or acknowledged alert |
| POST | `/api/sos/alerts` | Rider/driver (verified) | `{ rideId, lat?, lng?, message? }` | Raise an SOS |

```json
{
  "success": true,
  "data": {
    "alert": {
      "id": "...",
      "status": "open",
      "message": "Need help",
      "note": "",
      "contactsNotified": 1,
      "location": { "lng": 72.88, "lat": 19.07 },
      "user": { "id": "...", "name": "Aisha Khan", "phone": "+919876543210", "role": "rider" },
      "ride": { "id": "...", "status": "in_progress" },
      "handledBy": null,
      "raisedAt": "2026-01-01T10:30:00.000Z"
    },
    "notifications": { "contactsNotified": 1, "channels": ["mock-sms"] }
  }
}
```

`lat` and `lng` must be supplied together; otherwise the ride pickup is used. Errors:
`409 SOS_RIDE_NOT_ACTIVE`, `409 SOS_ALREADY_OPEN`, `422 SOS_LOCATION_REQUIRED`.

The emergency-contact adapter is a demo and sends nothing externally.

## 10. Notifications

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/api/notifications?limit=` | - | Notifications plus unread count (max 50) |
| PATCH | `/api/notifications/:id/read` | - | Mark one as read |
| POST | `/api/notifications/read-all` | - | Mark all as read |

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "...",
        "type": "sos",
        "title": "SOS shared with the safety desk",
        "message": "Your safety desk alert is active...",
        "readStatus": false,
        "rideId": "...",
        "sosAlertId": "...",
        "readAt": null,
        "createdAt": "2026-01-01T10:30:00.000Z"
      }
    ],
    "unread": 1
  }
}
```

## 11. Admin

All admin routes require `role = admin`.

### GET /api/admin/stats

```json
{
  "success": true,
  "data": {
    "stats": {
      "users": 12,
      "riders": 5,
      "drivers": 6,
      "bannedUsers": 0,
      "onlineDrivers": 2,
      "rides": 18,
      "activeRides": 1,
      "completedRides": 15,
      "cancelledRides": 2,
      "openSos": 0,
      "pendingReviews": 1,
      "pendingDocs": 1,
      "revenue": 1450,
      "currency": "INR"
    },
    "recentSos": [],
    "recentRides": [
      {
        "id": "...",
        "status": "completed",
        "rider": { "id": "...", "name": "Aisha Khan" },
        "driver": { "id": "...", "name": "Priya Sharma" },
        "pickupLabel": "Bandra Station",
        "dropLabel": "Andheri West",
        "finalPrice": 95,
        "createdAt": "2026-01-01T10:05:00.000Z"
      }
    ]
  }
}
```

### Account moderation

| Method | Path | Body / query | Description |
|---|---|---|---|
| GET | `/api/admin/users?role=&status=&search=&page=&limit=` | - | Filtered account list |
| PATCH | `/api/admin/users/:id/access` | `{ banned, reason }` | Suspend or restore a rider/driver |

`role` is `rider`, `driver`, `admin` or `all`. `status` is `active`, `banned`,
`approved`, `pending`, `pending_review`, `rejected` or `all`. Admins cannot suspend
themselves or another admin (`409 ADMIN_SELF_PROTECTED`, `403 ADMIN_PROTECTED`).
Suspending a driver also sets them offline and clears their active ride.

### Identity review queue

| Method | Path | Body / query | Description |
|---|---|---|---|
| GET | `/api/admin/review-queue?status=&page=&limit=` | - | Queue (default `pending`) |
| PATCH | `/api/admin/review-queue/:id` | `{ status: "approved" or "rejected", note }` | Decide a review |

Approving sets the user's `verificationStatus` to `approved`; rejecting sets it to
`rejected`. Both notify the member. Errors: `409 ALREADY_REVIEWED`, `404 REVIEW_NOT_FOUND`.

### Driver documents

| Method | Path | Body / query | Description |
|---|---|---|---|
| GET | `/api/admin/driver-documents?status=&page=&limit=` | - | Licence queue metadata |
| GET | `/api/admin/driver-documents/:filename` | - | Private file stream (no-store) |
| PATCH | `/api/admin/driver-documents/:id` | `{ status: "approved" or "rejected", note }` | Decide a licence |

The file route validates the filename against a UUID + extension pattern and requires an
admin JWT. Rejecting a licence sets the driver offline and notifies them.

### SOS desk

| Method | Path | Body / query | Description |
|---|---|---|---|
| GET | `/api/admin/sos-alerts?status=&page=&limit=` | - | `open`, `acknowledged`, `resolved` or `all` |
| PATCH | `/api/admin/sos-alerts/:id` | `{ status: "acknowledged" or "resolved", note }` | Update an alert |

Resolving an already-resolved alert returns `409 SOS_ALREADY_RESOLVED`. Every update
notifies the member and broadcasts `sos:updated` to the member and admins.

## 12. Socket.IO

Connect with a JWT:

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:5000", {
  auth: { token: localStorage.getItem("shedrive:token") },
});
```

The handshake fails with `AUTH_REQUIRED`, `INVALID_TOKEN`, `TOKEN_EXPIRED` or
`ACCOUNT_UNAVAILABLE`. On success the socket joins `user:<id>` and, for admins, `admins`.

| Direction | Event | Payload | Notes |
|---|---|---|---|
| Client -> server | `ride:join` | `{ rideId }` | Ack `{ ok: true }`; only rider/driver may join |
| Client -> server | `ride:leave` | `{ rideId }` | Leaves the ride room |
| Client -> server | `driver:location` | `{ rideId, lat, lng }` | Driver only, assigned ride, stored max 1/sec |
| Server -> client | `ride:request` | `{ ride }` | Sent to nearby matching drivers |
| Server -> client | `offer:new` | `{ offer }` | Ride room and rider |
| Server -> client | `offer:accepted` | `{ ride, offer }` | Ride room and both participants |
| Server -> client | `ride:status` | `{ ride }` | Ride room and both participants |
| Server -> client | `ride:location` | `{ rideId, lat, lng, at }` | Ride room and rider |
| Server -> client | `sos:triggered` | `{ alert }` | Admin room |
| Server -> client | `sos:created` | `{ alert }` | Member who raised it |
| Server -> client | `sos:updated` | `{ alert }` | Member and admins |
| Server -> client | `account:updated` | `{ userId, isBanned }` | Affected member |

Rooms:

- `user:<userId>` for direct notifications.
- `ride:<rideId>` for participants of one ride.
- `admins` for every connected admin.

When `REDIS_URL` is set, the Redis adapter shares rooms across backend replicas.

## 13. Error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body or query failed validation |
| 400 | `INVALID_ID` | Malformed MongoDB ObjectId |
| 400 | `OTP_INVALID` | Wrong OTP |
| 401 | `AUTH_REQUIRED` | Missing bearer token |
| 401 | `INVALID_TOKEN`, `TOKEN_EXPIRED` | Token rejected |
| 401 | `ACCOUNT_UNAVAILABLE` | Banned or deleted account |
| 401 | `INVALID_CREDENTIALS` | Wrong email/password |
| 402 | `INSUFFICIENT_WALLET_BALANCE` | Wallet cannot cover the fare |
| 403 | `FORBIDDEN` | Wrong role |
| 403 | `ACCOUNT_PENDING_REVIEW`, `ACCOUNT_REJECTED` | Verification gate |
| 403 | `LICENCE_REJECTED` | Driver licence not approved |
| 404 | `RIDE_NOT_FOUND`, `DRIVER_PROFILE_NOT_FOUND`, `NOTIFICATION_NOT_FOUND` | Missing resource |
| 409 | `EMAIL_TAKEN`, `PHONE_TAKEN` | Duplicate account |
| 409 | `RIDE_ALREADY_ACTIVE`, `RIDE_ALREADY_ACCEPTED` | Conflicting ride state |
| 409 | `OFFER_UNAVAILABLE`, `RIDE_NOT_OPEN` | Offer no longer usable |
| 409 | `PAYMENT_ALREADY_COMPLETE`, `RATING_ALREADY_SUBMITTED` | One-time action repeated |
| 409 | `SOS_ALREADY_OPEN`, `SOS_ALREADY_RESOLVED` | SOS conflict |
| 410 | `OTP_EXPIRED` | OTP expired |
| 413 | `FILE_TOO_LARGE`, `PAYLOAD_TOO_LARGE` | Upload/body too large |
| 415 | `UNSUPPORTED_FILE_TYPE`, `UNSUPPORTED_LICENSE_DOCUMENT` | Wrong MIME type |
| 422 | `ROUTE_TOO_SHORT`, `VEHICLE_MISMATCH` | Semantically invalid request |
| 429 | `AUTH_RATE_LIMITED`, `LOGIN_RATE_LIMITED`, `OTP_RATE_LIMITED`, `OTP_LOCKED` | Too many attempts |
| 500 | `INTERNAL_ERROR` | Unexpected server failure |
| 503 | `NOT_READY` | MongoDB not connected |

## 14. cURL examples

```bash
# Login
curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"rider@shedrive.test","password":"Rider@12345"}'

# Estimate a fare
TOKEN="<paste token>"
curl -s -X POST http://localhost:5000/api/rides/estimate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pickup":{"lat":19.076,"lng":72.8777},"drop":{"lat":19.1197,"lng":72.8464},"vehicleType":"Car"}'

# List active ride
curl -s http://localhost:5000/api/rides/active \
  -H "Authorization: Bearer $TOKEN"
```

A ready-to-import Postman collection is in
[`shedrive.postman_collection.json`](shedrive.postman_collection.json).
