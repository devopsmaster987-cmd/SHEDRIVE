# SheDrive design notes - "Neon Midnight City"

## Concept

SheDrive should feel like flying through a safe, luminous city at night. The landing
page puts the visitor above a procedural avenue: glowing tower windows, neon street
lines, light pulses running toward the camera, sky bridges across the road, and a
single hover car moving through it all. It is cinematic and feminine without relying
on cliches.

The 3D scene is decorative. Every word, button and link remains ordinary HTML, so the
page is usable with the canvas hidden, WebGL disabled, or JavaScript reduced to the
basics.

## Palette

| Token | Value | Use |
|---|---|---|
| `--bg-0` | `#05030f` | Page base, deep midnight indigo/black |
| `--bg-1` | `#090517` | Section gradient |
| `--bg-2` | `#120a2a` | Glass tint |
| `--magenta` | `#ff2bd6` | Primary glow, CTA gradient |
| `--pink` | `#ff5c9d` | Gradient start, warm accents |
| `--violet` | `#8b5cff` | Mid-gradient, secondary glow |
| `--cyan` | `#4ff0ff` | Safety highlights, focus rings |
| `--lavender` | `#c9b8ff` | Eyebrows, soft borders |
| `--text` | `#f6f2ff` | Primary text |
| `--text-muted` | `#b7aecd` | Body copy |

All tokens live in `frontend/css/design-system.css`; components never hard-code a
colour outside that file. Text on glass panels uses `--text` or `--text-muted`, which
exceed WCAG AA on the dark backgrounds.

## Typography

- Display: **Space Grotesk** (700 for the hero, 600 for headings).
- Body: **Inter** (400/500/600).
- Mono details: system monospace for HUD coordinates, eyebrows, pills and metadata.

The hero headline is broken into words so GSAP can reveal each one from a clipped
line. The accessible name stays a single sentence via `aria-label`.

## Motion

- Lenis smooth scroll drives ScrollTrigger.
- The hero camera follows a `CatmullRomCurve3` from street level (z = 34) up and down
  the avenue (z = -42). Scroll progress scrubs the camera; mouse position adds a small
  damped parallax on desktop only.
- Hero copy lifts and fades as the camera passes it.
- Sections reveal once on scroll; cards have a pointer spotlight and magnetic CTA
  buttons have a custom glowing cursor with a trailing ring.
- Motion is skipped when `prefers-reduced-motion` is set or the "Reduce effects"
  toggle is off. The toggle stores the choice in `localStorage` and reloads into a
  static-but-beautiful version of the same layout.

## Three.js architecture

| Module | Responsibility |
|---|---|
| `js/three/scene.js` | WebGL detection, quality detection, renderer/scene/camera factory, resize, disposal |
| `js/three/city.js` | Instanced procedural towers, shader street grid, sky dome, rooftop lights, sky bridges, particles |
| `js/three/car.js` | Procedural hover car, wheels, headlight/tail glows, underglow and light trail |
| `js/three/postprocessing.js` | EffectComposer, RenderPass, UnrealBloomPass, OutputPass |
| `js/three/shaders/building.js` | Window grid, lit-window variation, neon crowns, manual fog |
| `js/three/shaders/road.js` | Roads, lane dashes, flowing pulses, pickup ring, sparkles |
| `js/three/shaders/particles.js` | Additive floating neon dust |
| `js/three/shaders/glow.js` | Car underglow and trail gradients |

### Performance choices

- Buildings are a single `InstancedMesh` with per-instance scale/seed attributes
  (about 200 towers, one draw call).
- Windows are computed in the fragment shader: no textures, no per-window meshes.
- Particle count is 620 and rendered as one `Points` object with additive blending.
- Pixel ratio is capped at 2 desktop / 1.5 on low-power devices.
- Bloom strength is lowered on mobile and small screens.
- The car is procedural geometry, no glTF download. If a glTF is added later it must
  stay under ~1.5 MB and use Draco/meshopt with lazy loading.
- Textures are limited to the small radial canvas glow used by sprites.
- On `pagehide` the code cancels the animation frame, disposes geometries, materials,
  textures and render targets, and loses the WebGL context.

## Fallbacks and accessibility

- `isWebGLAvailable()` runs before any Three.js setup. On failure the page switches to
  `.no-webgl`, hides the canvas and shows a CSS gradient "city" with the same text and
  controls.
- The canvas wrapper is `aria-hidden="true"`; nothing inside it is focusable.
- All core actions are links/buttons in the DOM; the 3D layer never receives input.
- `prefers-reduced-motion` and the in-page toggle remove parallax, scroll camera,
  bloom-heavy motion and the custom cursor.
- Buttons and links keep visible `:focus-visible` rings.
- The mobile layout collapses the nav into an accessible disclosure menu and replaces
  mouse parallax with scroll-only motion.

## Auth and selfie scan (Phase 3)

- `/auth.html` uses the same Neon Midnight City palette but a calmer, task-focused
  split layout: brand story and selfie stage on the left, form panel on the right.
- The selfie stage combines a mirrored camera preview, a private upload fallback, CSS
  holographic rings and a small WebGL fragment shader for scan lines, rings and grid.
  When WebGL or motion is unavailable, the CSS rings and gradient grid remain.
- Camera frames are mirrored onto a canvas so the captured preview matches the user's
  view. Raw files stay in the browser until the user submits the multipart form.
- The form is a two-part narrative (details, then face check) rather than a single wall
  of fields. Driver fields reveal only for the driver role.
- The OTP dialog uses six auto-advancing inputs with paste support, a resend cooldown,
  focus trapping and inline errors. The mock provider explains that codes appear in the
  backend log.
- Outcome states are split between approved and under-review, with the account's
  verification status visible rather than hidden behind a generic success message.

## Rider and driver core (Phase 4)

- The authenticated pages reuse the landing palette through a compact glass shell: sticky
  navigation, role-aware links, account chip, verification status and a persistent
  reduce-effects control.
- Booking uses Leaflet with OpenStreetMap tiles. A CSS invert/hue-rotate filter turns the
  standard tiles into a dark, low-saturation city map without requiring a tile API key.
- Pickup and drop are cyan and magenta pulsing pins. The route combines a wide magenta
  glow, a solid cyan line and a bright dashed core so it stays visible over dense roads.
- Fare cards keep the night-city HUD language: mono labels, large display numerals and a
  magenta-tinted offer panel. Vehicle options use icon cards and the selected state is a
  cyan border and glow.
- The preview dialog is a focused glass card with a summary table, an optional local
  draft and the ride-request action added in Phase 5.
- The driver cockpit pairs an online orb with earnings metrics, a live-position map and a
  radar empty state. Location is shared only while online, with a manual fallback when
  browser geolocation is unavailable.
- Profile keeps identity, safety circle, privacy and support in a two-column dashboard.
  Form controls use the same focus rings, inline validation and toast feedback as auth.

## Ride flow and realtime (Phase 5)

- The rider journey reuses the booking map but changes its role from planning to
  monitoring: the route stays visible, the driver pin moves, and the rail switches from
  fare input to offers, driver identity and a four-stage timeline.
- Offers are compact glass cards sorted by price. The price is the loudest element, the
  driver's name, vehicle and rating stay secondary, and the expiry note uses the mono HUD
  style. Accepting collapses the comparison view into a single-driver tracking state.
- The driver radar uses the same card language in reverse: rider name, route, trip length
  and the rider's asking price, with a full-width accept action and a quieter counter
  control that expands inline rather than opening another modal.
- The active-trip page keeps one primary action visible at a time: arrived, start, then
  complete. The timeline and badge move together so the driver never has to infer the
  next state. Cancellation stays a deliberate, lower-emphasis outline action.
- Realtime feedback is intentionally quiet: a connected map note, toast confirmations and
  in-place card updates. When the socket drops, the same views continue through polling
  instead of showing a blocking connection error.

## Payments, ratings and history (Phase 6)

- The completed-ride summary opens with a celebratory but restrained hero: a cyan check
  orb, a short confetti burst and the final fare, while the fare breakdown keeps the mono
  HUD labels and large display numerals used throughout the ride flow.
- Payment is a two-choice glass panel. Wallet is the default visual emphasis but disables
  cleanly when the demo balance is short; cash remains available. Once paid, the panel
  becomes a receipt with amount, method and reference instead of showing a second action.
- Rating uses oversized perspective-tilted stars that light with a warm gold glow and a
  magenta halo on hover. The form collapses into a quiet thank-you state after submission.
- History uses tabs for rides and wallet. Ride cards reuse the route dots and status badges
  from the live ride page, with status filters and a completed-trip summary action. The
  wallet pairs a large balance card with quick top-up chips and a compact transaction ledger.
- Empty states stay useful and calm, and mobile collapses the two-column wallet/summary
  layouts into one column without horizontal overflow.

## Safety, notifications and admin operations (Phase 7)

- The SOS control is a breathing red orb rather than another rectangular button. Two
  expanding rings and a soft red halo make it findable in a glance while keeping the ride
  panel calm. It appears only for active rides, and switches its label to "Active" when an
  alert is open.
- Triggering the orb turns the whole viewport into a slow red alert wash with subtle scan
  lines, so the emergency state is unmistakable without hiding the ride context. The
  confirmation dialog then deliberately slows the hand down: it names what will be shared
  (live location, ride details, account), shows the location-sharing fact, and keeps "I am
  safe" as a quiet ghost action beside the red send action. Once sent, the dialog becomes a
  receipt with a green check, safety status, contact count and an `SOS-` reference.
- The notification bell uses a small magenta unread badge and an inbox panel with compact
  type icons for SOS, account, payment and ride events. Unread rows carry a faint cyan
  wash; the panel closes on outside click and Escape to stay out of the way.
- The admin console is intentionally denser than the customer pages but uses the same
  night-city palette. Six compact counters sit above a split workspace: a Three.js bar city
  on the left and the live SOS queue on the right. The bars are extruded, lit by cyan and
  magenta point lights, and animate toward the latest account/ride volumes.
- SOS cards use a red inset rail, status badge, route dots, contact count and coordinates.
  Acknowledge is immediate; resolve opens a note dialog so the audit trail captures what
  happened. Emergency-contact delivery stays visibly labelled as a demo service.
- Account moderation uses searchable role/status filters rather than a raw table. Suspend
  and restore actions open a reason dialog, and admin accounts or the signed-in operator are
  visibly protected.
- The verification queue separates identity from licence review. Identity cards expose the
  face confidence and signal, while licence cards render a private document preview fetched
  with the bearer token. Rejections require a short note; approvals confirm the member was
  notified. Both use the shared toast and modal language.
- Live safety events reuse the existing socket room model: admins join `admins`, members
  receive `sos:updated`, and new alerts show a persistent live strip plus toast instead of
  a blocking dialog.

## What comes next

The same design system and scene modules are reused in later phases:

- Final hardening, architecture diagrams and viva documentation (Phase 10).
