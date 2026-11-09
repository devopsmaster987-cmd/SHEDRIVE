# SheDrive frontend

Vite frontend with Tailwind CSS, Three.js, GSAP + ScrollTrigger, Lenis and Leaflet.
Phase 1 ships the design system and the "Neon Midnight City" landing hero. Phase 3 adds
the verified signup/login experience. Phase 4 adds the rider booking page, profile and
emergency contacts, and the driver cockpit with online status and live location. Phase 5
adds live ride requests, offers/counters, rider tracking and the driver active-trip page
over REST plus Socket.IO. Phase 6 adds the completed-ride fare summary, mock cash/wallet
payments, two-sided ratings, ride history and the demo wallet/ledger. Phase 7 adds the
in-ride SOS orb and confirm flow, the shared notification inbox, the 3D admin operations
console and the identity/licence verification queue. Phases 8-10 add the nginx production
image, S3/CloudFront deployment, CI build checks and the documentation set in `docs/`.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/ (eleven pages)
npm run preview  # preview the production build
```

In development Vite proxies `/api` and `/socket.io` to `http://localhost:5000`. The
production nginx image proxies the same paths to the backend container, so the browser
always uses the same origin.

In AWS production the static `dist/` is synced to S3 and served by CloudFront. CloudFront
must forward `/api/*` and `/socket.io/*` to the EKS backend load balancer; see
[`../docs/aws-setup.md`](../docs/aws-setup.md).

## Pages

| Page | Purpose |
|---|---|
| `/` | Landing page with the procedural night-city hero and safety story |
| `/auth.html` | Signup, login, selfie capture, OTP verification and review status |
| `/auth.html?mode=login` | Opens the auth page directly in login mode |
| `/book.html` | Rider route, fare estimate, vehicle choice and ride request |
| `/ride.html` | Live offers, driver tracking and journey progress for the rider |
| `/profile.html` | Account details, emergency contacts, privacy and preferences |
| `/driver.html` | Driver online toggle, location map, earnings and request radar |
| `/driver-ride.html` | Active trip route, rider details and status controls |
| `/summary.html` | Completed-ride fare breakdown, payment and two-sided rating |
| `/history.html` | Ride history, status filters, wallet top-up and transaction ledger |
| `/admin.html` | 3D city analytics, live SOS queue, account moderation and recent rides |
| `/admin-review.html` | Identity review queue and private driving-licence verification |

## Structure

```
index.html              landing page and night-city hero
auth.html               verified signup/login page
book.html               rider booking and fare negotiation
ride.html               rider offers, acceptance and live tracking
profile.html            profile, safety circle and preferences
driver.html             driver cockpit, request radar and live position
driver-ride.html        active trip route and status controls
summary.html            fare breakdown, payment receipt and rating
history.html            ride history and demo wallet
admin.html              admin operations console and 3D city pulse
admin-review.html       identity and licence verification queue
css/design-system.css   tokens, glass panels, buttons, cursor, preloader
css/landing.css         hero, navigation, sections, responsive rules
css/auth.css            auth layout, scan stage, form states, OTP dialog
css/app.css             authenticated shell, booking, profile and driver pages
css/phase7.css          notification inbox, SOS orb and emergency dialog
css/admin.css           admin analytics, SOS desk, moderation and verification queue
js/landing.js           page orchestration, preloader, scroll, camera, reveals
js/auth.js              signup/login flow, camera capture, OTP, outcome states
js/shell.js             shared auth guard, nav, status banner, toast and helpers
js/book.js              Leaflet map, geocoding, estimate and ride request
js/ride.js              rider offers, acceptance, map and journey timeline
js/profile.js           profile and emergency-contact editing
js/driver.js            online toggle, geolocation, request radar and offers
js/driver-ride.js       active trip map, location sharing and status controls
js/summary.js           fare receipt, cash/wallet payment and star rating
js/history.js           ride filters, wallet top-up and transaction ledger
js/admin.js             stats, Three.js analytics, SOS desk, users and realtime alerts
js/admin-review.js      identity queue, authenticated document previews and decisions
js/socket.js            authenticated Socket.IO client and ride-room helpers
js/scanEffect.js        lightweight WebGL scan overlay for the selfie stage
js/api.js               fetch wrapper with JWT handling and error envelope
js/three/               reusable scene, city, car and postprocessing modules
js/cursor.js            magnetic cursor with a trailing glow
```

## Auth experience

- **Selfie capture** uses `getUserMedia` with a mirrored preview and a canvas capture.
  When camera permission is blocked, the upload control remains available.
- **Scan effect** draws animated rings, a sweeping scan line and a grid in a small
  fragment shader. It falls back to CSS visuals when WebGL is unavailable or motion is
  reduced.
- **Forms** mirror the backend rules: image/PDF limits, password rules, driver-only
  fields, inline validation and API error details.
- **OTP dialog** has auto-advancing digit inputs, paste support, focus trapping, a resend
  cooldown and demo-mode copy explaining that the mock code is in the backend log.
- **Outcome states** distinguish approved accounts from accounts under human review.
  Tokens are stored under `shedrive:token` only after OTP verification.

## Rider and driver experience

- Booking uses OpenStreetMap tiles with a CSS dark filter, Nominatim search and
  click-to-pin points. The route is drawn as a cyan glow with a bright animated core.
- Riders choose Car, Auto or Bike; the API returns distance, ETA and a suggested fare.
  The offer is editable with quick chips and the preview dialog sends a real ride request.
  A local plan can still be saved under `shedrive:ride-draft`.
- `/ride.html` lists pending driver offers, accepts one atomically, switches to driver
  tracking and renders the accepted/arriving/in-progress/completed timeline. It falls back
  to polling when Socket.IO is disconnected.
- The driver radar lists nearby searching rides, supports accept-at-asking-price or an
  inline counter-offer, and opens the active-trip page when a rider accepts.
- `/driver-ride.html` shares throttled `watchPosition` updates over Socket.IO, with a REST
  fallback, and exposes arrival, start, completion and cancellation controls.
- Completed trips link to `/summary.html`, which renders the offered fare, counter
  adjustment and total, records a mock cash or wallet payment, and shows a one-time
  3D-star rating form. The wallet option disables itself when the balance is too low.
- `/history.html` combines completed, active and cancelled rides with status filters,
  total spend/earnings and distance, plus a rider-only wallet tab with quick/custom
  top-ups and the transaction ledger. Deep links such as `#wallet` are supported.
- The shared shell guards role-specific pages, renders the account menu, pending-review
  banner, notification bell, reduce-effects toggle, sign-out and toast feedback.
- `/ride.html` and `/driver-ride.html` show a pulsing SOS orb during `accepted`,
  `arriving` and `in_progress`. The orb opens a two-step emergency dialog, requests a live
  browser position (the API falls back to ride pickup), then shows phone-safe status,
  contact count and an `SOS-` reference. Admins and the member receive live
  `sos:updated` events.
- The notification inbox polls unread counts, renders SOS/account/payment/ride messages,
  supports one-by-one and mark-all read actions, and closes on outside click or Escape.
- `/admin.html` renders six live city counters, a Three.js bar city, the SOS queue with
  acknowledge/resolve notes, searchable role/status account filters, safe suspend/restore
  actions and recent rides. `/admin-review.html` splits identity and licence queues,
  previews private documents through authenticated blobs, and requires a note on rejection.
- Profile edits are limited to name and emergency contacts; phone and email stay locked
  to protect verification. Up to five contacts are supported.
- The driver dashboard updates online status through the API and sends `watchPosition`
  updates at most every 25 seconds. A manual map click or "Use my location" also works.
- Tile requests go directly to OpenStreetMap in development. Production may point
  `TILES` at a hosted provider if traffic requires it.

## Accessibility and fallbacks

- WebGL detection keeps the landing hero usable with a styled CSS fallback.
- `prefers-reduced-motion` and the "Reduce effects" toggle disable parallax, scroll
  camera moves, bloom-heavy motion, the custom cursor and the auth scan shader.
- The 3D canvas and scan canvas are decorative and `aria-hidden`; all actions are real
  focusable HTML.
- Forms have visible labels, inline errors, `aria-live` alerts, modal focus management
  and keyboard navigation.
- Ride pages keep polling when Socket.IO is unavailable, and offer/status cards are plain
  focusable controls with text labels rather than map-only actions.
- SOS dialogs trap attention with `aria-modal`, restore focus, close on Escape/backdrop and
  stack above ride modals. Admin document previews are fetched with the bearer token, so
  private licence files are never exposed as unauthenticated image URLs.
- Mobile uses a single-column auth layout, disclosure navigation and scroll-only motion.

## Docker

```bash
docker build -t shedrive-frontend .
docker run --rm -p 8080:80 shedrive-frontend
```

The image is a multi-stage build: Vite compiles every page, then nginx serves `dist/`
with SPA fallback, cache headers, and `/health`.
