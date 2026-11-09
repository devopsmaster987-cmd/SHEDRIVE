import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "./api.js";
import { bootPage, formatCurrency, setBusy, showToast } from "./shell.js";
import { getSocket, joinRide, leaveRide, disconnectSocket } from "./socket.js";

const $ = (selector, root = document) => root.querySelector(selector);
const CITY_CENTER = [12.9716, 77.5946];
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const STATUS_COPY = {
  searching: {
    label: "Finding driver",
    subtitle: "Your request is with nearby women drivers. Compare offers as they arrive.",
    note: "Listening for offers",
    map: "Searching for your driver",
    driverTitle: "Finding your driver",
  },
  accepted: {
    label: "Driver assigned",
    subtitle: "Your driver has accepted. Track their approach on the map.",
    note: "Driver assigned",
    map: "Driver is getting ready",
    driverTitle: "On the way",
  },
  arriving: {
    label: "Driver arriving",
    subtitle: "Your driver is close to the pickup point. Head out when you are ready.",
    note: "Arriving soon",
    map: "Driver is arriving",
    driverTitle: "Almost at pickup",
  },
  in_progress: {
    label: "On the way",
    subtitle: "You are on your way. Keep this page open for live updates.",
    note: "Ride in progress",
    map: "Live driver position",
    driverTitle: "On the way",
  },
  completed: {
    label: "Ride complete",
    subtitle: "You reached your drop safely. Thank you for riding with SheDrive.",
    note: "Journey complete",
    map: "Ride completed",
    driverTitle: "Ride complete",
  },
  cancelled: {
    label: "Ride cancelled",
    subtitle: "This ride was cancelled. You can plan a new one whenever you are ready.",
    note: "Ride cancelled",
    map: "Ride cancelled",
    driverTitle: "Ride cancelled",
  },
};
const TIMELINE = ["accepted", "arriving", "in_progress", "completed"];

const mapEl = $("#ride-map");
const cancelModal = $("#cancel-modal");
const cancelButton = $("#ride-cancel");
const sosModal = $("#sos-modal");
const sosButton = $("#ride-sos");
const SOS_STATUS_COPY = {
  open: "Open",
  acknowledged: "Safety desk with you",
  resolved: "Resolved",
};

let user = null;
let rideId = null;
let ride = null;
let offers = new Map();
let socket = null;
let pollTimer = null;
let map = null;
let pickupMarker = null;
let dropMarker = null;
let driverMarker = null;
let routeLayers = [];
let hasFitRoute = false;
let lastFocused = null;
let sosLastFocused = null;
let sosAlert = null;
let sosLoaded = false;

const pickupIcon = L.divIcon({
  className: "map-pin-wrap",
  html: '<div class="map-pin pin-pickup"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="11" r="2.2" fill="currentColor"/></svg></div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const dropIcon = L.divIcon({
  className: "map-pin-wrap",
  html: '<div class="map-pin pin-drop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v16M6 5h9l-1.8 3.5L15 12H6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const driverIcon = L.divIcon({
  className: "map-pin-wrap",
  html: '<div class="map-pin pin-driver is-pulsing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 15 1.2-4.1A2 2 0 0 1 8.1 9.4h7.8a2 2 0 0 1 1.9 1.5L19 15v3h-2v-1H7v1H5v-3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 15h10" stroke="currentColor" stroke-width="1.2"/></svg></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function initials(name) {
  return String(name || "SD")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function shortId(id) {
  return String(id || "").slice(-6).toUpperCase();
}

function setStatusBadge(status, cancelled = false) {
  const badge = $("#ride-status-badge");
  const copy = STATUS_COPY[status] || STATUS_COPY.searching;
  badge.textContent = copy.label;
  badge.classList.toggle("is-warning", status === "searching" || status === "arriving");
  badge.classList.toggle("is-danger", status === "cancelled" || cancelled);
}

function setMapNote(text) {
  $("#ride-map-note").innerHTML = `<i aria-hidden="true"></i>${text}`;
}

function drawRoute() {
  for (const layer of routeLayers) map.removeLayer(layer);
  routeLayers = [];

  const pickup = ride?.pickup;
  const drop = ride?.drop;
  if (!pickup || !drop) return;

  pickupMarker =
    pickupMarker || L.marker([pickup.lat, pickup.lng], { icon: pickupIcon }).addTo(map);
  pickupMarker.setLatLng([pickup.lat, pickup.lng]);
  dropMarker = dropMarker || L.marker([drop.lat, drop.lng], { icon: dropIcon }).addTo(map);
  dropMarker.setLatLng([drop.lat, drop.lng]);

  const points = [
    [pickup.lat, pickup.lng],
    [drop.lat, drop.lng],
  ];
  const glow = L.polyline(points, {
    color: "#ff2bd6",
    weight: 18,
    opacity: 0.18,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(map);
  const line = L.polyline(points, {
    color: "#4ff0ff",
    weight: 5,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(map);
  const core = L.polyline(points, {
    color: "#e8ffff",
    weight: 1.6,
    opacity: 0.95,
    dashArray: "8 10",
  }).addTo(map);
  routeLayers.push(glow, line, core);

  if (!hasFitRoute) {
    map.fitBounds(line.getBounds(), { padding: [70, 70], maxZoom: 15 });
    hasFitRoute = true;
  }
}

function updateDriverMarker(location, { center = false } = {}) {
  if (!location) return;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  if (!driverMarker) {
    driverMarker = L.marker([lat, lng], { icon: driverIcon }).addTo(map);
  } else {
    driverMarker.setLatLng([lat, lng]);
  }
  if (center) map.setView([lat, lng], 14);
}

function renderSummary() {
  const fare = ride.finalPrice ?? ride.offeredPrice;
  $("#ride-fare").textContent = formatCurrency(fare);
  $("#ride-fare-copy").textContent =
    ride.status === "searching"
      ? "Your offer while drivers respond."
      : ride.status === "completed"
        ? "Final fare for this journey."
        : "Agreed fare for this journey.";
  $("#ride-id").textContent = `#${shortId(ride.id)}`;
  $("#ride-pickup").textContent = ride.pickup?.label || "Pinned pickup";
  $("#ride-drop").textContent = ride.drop?.label || "Pinned drop";
  $("#ride-distance").textContent = `${Number(ride.distanceKm).toFixed(1)} km`;
  $("#ride-vehicle").textContent = ride.vehicleType || "—";
  $("#ride-duration").textContent = `${ride.durationMinutes} min`;
}

function offerCard(offer) {
  const article = document.createElement("article");
  article.className = "offer-card";

  const head = document.createElement("div");
  head.className = "offer-head";
  const identity = document.createElement("div");
  const avatar = document.createElement("span");
  avatar.className = "offer-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = initials(offer.driver?.name);
  const copy = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = offer.driver?.name || "SheDrive driver";
  const meta = document.createElement("small");
  meta.textContent = `${offer.driver?.vehicleType || ride.vehicleType} · ${offer.driver?.plateNumber || "Plate pending"} · ${Number(offer.driver?.ratingAvg || 0).toFixed(1)} ★`;
  copy.append(name, meta);
  identity.append(avatar, copy);

  const price = document.createElement("strong");
  price.className = "offer-price";
  price.textContent = formatCurrency(offer.offerPrice);
  head.append(identity, price);

  const body = document.createElement("div");
  body.className = "offer-body";
  const note = document.createElement("p");
  note.textContent = offer.note || "Ready to take your ride.";
  const expires = document.createElement("span");
  const seconds = Math.max(0, Math.round((new Date(offer.expiresAt).getTime() - Date.now()) / 1000));
  expires.textContent = seconds > 0 ? `Expires in about ${seconds}s` : "Expiring now";
  body.append(note, expires);

  const action = document.createElement("button");
  action.type = "button";
  action.className = "btn btn-primary btn-sm offer-accept";
  action.textContent = "Accept offer";
  action.addEventListener("click", () => acceptOffer(offer.id, action));

  article.append(head, body, action);
  return article;
}

function renderOffers() {
  const list = $("#offer-list");
  const wait = $("#ride-wait");

  if (ride.status !== "searching") {
    $("#ride-match-card").hidden = true;
    return;
  }

  $("#ride-match-card").hidden = false;
  const sorted = Array.from(offers.values()).sort((a, b) => a.offerPrice - b.offerPrice);
  $("#ride-meta-pill").textContent =
    sorted.length === 0
      ? "Listening for offers"
      : `${sorted.length} offer${sorted.length === 1 ? "" : "s"} received`;

  if (sorted.length === 0) {
    wait.hidden = false;
    list.hidden = true;
    $("#ride-wait-title").textContent = "Searching your area";
    $("#ride-wait-copy").textContent = "Keep this page open. Offers appear here in real time.";
    return;
  }

  wait.hidden = true;
  list.hidden = false;
  list.replaceChildren(...sorted.map(offerCard));
}

function renderTimeline() {
  const index = TIMELINE.indexOf(ride.status);
  const card = $("#ride-progress-card");
  const visible = index >= 0;
  card.hidden = !visible;
  if (!visible) return;

  for (const item of card.querySelectorAll("[data-step]")) {
    const stepIndex = TIMELINE.indexOf(item.dataset.step);
    item.classList.toggle("is-done", stepIndex < index || ride.status === "completed");
    item.classList.toggle("is-current", stepIndex === index && ride.status !== "completed");
  }
}

function renderDriver() {
  const card = $("#driver-card");
  const driver = ride.driver;
  if (!driver) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  const copy = STATUS_COPY[ride.status] || STATUS_COPY.accepted;
  $("#driver-card-title").textContent = copy.driverTitle;
  $("#driver-status-pill").textContent = copy.label;
  $("#driver-name").textContent = driver.name || "SheDrive driver";
  $("#driver-avatar").textContent = initials(driver.name);
  $("#driver-vehicle").textContent = [driver.vehicleType, driver.plateNumber]
    .filter(Boolean)
    .join(" · ") || "Vehicle details";
  $("#driver-rating").textContent = `${Number(driver.ratingAvg || 0).toFixed(1)} ★`;
  $("#driver-plate").textContent = driver.plateNumber || "—";
  $("#driver-fare").textContent = formatCurrency(ride.finalPrice ?? ride.offeredPrice);
}

function renderSosButton() {
  if (!sosButton) return;
  const available = ["accepted", "arriving", "in_progress"].includes(ride.status);
  sosButton.hidden = !available;
  sosButton.classList.toggle("is-active", Boolean(sosAlert));
  sosButton.setAttribute(
    "aria-label",
    sosAlert ? "View your active SOS alert" : "Trigger emergency SOS"
  );
  sosButton.querySelector("strong").textContent = sosAlert ? "Active" : "SOS";
}

function renderSosModal() {
  const confirmView = $("#sos-confirm-view");
  const sentView = $("#sos-sent-view");
  const active = Boolean(sosAlert);

  confirmView.hidden = active;
  sentView.hidden = !active;
  if (!active) return;

  const contacts = Number(sosAlert.contactsNotified) || 0;
  $("#sos-status").textContent = SOS_STATUS_COPY[sosAlert.status] || "Open";
  $("#sos-contacts").textContent = contacts
    ? String(contacts)
    : "0 · add contacts in profile";
  const reference = String(sosAlert.id).replace(/^sos-/, "").slice(-6).toUpperCase();
  $("#sos-reference").textContent = `SOS-${reference}`;
  $("#sos-sent-title").textContent =
    sosAlert.status === "resolved" ? "The safety desk resolved this." : "You are not alone.";
  $("#sos-sent-copy").textContent =
    sosAlert.status === "resolved"
      ? sosAlert.note || "Your alert is closed. Reach out to support if you need anything else."
      : sosAlert.status === "acknowledged"
        ? "A safety team member has acknowledged your alert and is coordinating with you."
        : "The safety team can see your ride and last shared location.";
}

function renderActions() {
  cancelButton.hidden = !ride.canCancel;
  const summary = $("#ride-summary");
  summary.hidden = ride.status !== "completed";
  summary.href = `/summary.html?ride=${encodeURIComponent(ride.id)}`;
  $("#ride-home").hidden = !["completed", "cancelled"].includes(ride.status);
  renderSosButton();
}

function openSosModal() {
  if (sosButton.hidden) return;
  sosLastFocused = document.activeElement;
  renderSosModal();
  sosModal.hidden = false;
  document.body.style.overflow = "hidden";
  const target = sosAlert ? $("#sos-close") : $("#sos-confirm");
  target?.focus();
}

function closeSosModal() {
  sosModal.hidden = true;
  if (cancelModal.hidden) document.body.style.overflow = "";
  if (sosLastFocused && typeof sosLastFocused.focus === "function") {
    sosLastFocused.focus();
  }
}

function locateForSos() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 3000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer);
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 2500 }
    );
  });
}

async function refreshSosState() {
  try {
    const result = await api.get("/sos/alerts/mine");
    sosAlert = result.alert;
    sosLoaded = true;
    renderSosButton();
    if (!sosModal.hidden) renderSosModal();
  } catch {
    // A safety network check must not interrupt the ride view.
  }
}

async function sendSos() {
  const button = $("#sos-confirm");
  setBusy(button, true, "Alerting safety…");

  try {
    const location = await locateForSos();
    const body = {
      rideId,
      message: "Rider triggered SOS from live tracking.",
    };
    if (location) {
      body.lat = location.lat;
      body.lng = location.lng;
    }

    const result = await api.post("/sos/alerts", body);
    sosAlert = result.alert;
    sosLoaded = true;
    renderSosButton();
    renderSosModal();
    const notified = result.notifications?.contactsNotified || 0;
    showToast(
      notified
        ? `Safety desk alerted. ${notified} emergency contact${notified === 1 ? "" : "s"} notified.`
        : "Safety desk alerted. Add emergency contacts in your profile for future alerts.",
      { tone: "success" }
    );
  } catch (error) {
    if (error?.code === "SOS_ALREADY_OPEN") {
      await refreshSosState();
      renderSosModal();
      showToast("Your existing SOS alert is still active.", { tone: "info" });
    } else {
      showToast(error?.message || "We could not send the SOS. Please call local emergency services.", {
        tone: "error",
      });
    }
  } finally {
    setBusy(button, false);
  }
}

function renderRide() {
  const copy = STATUS_COPY[ride.status] || STATUS_COPY.searching;
  setStatusBadge(ride.status);
  $("#ride-subtitle").textContent = copy.subtitle;
  $("#ride-map-status").textContent =
    ride.driver?.name && ride.status !== "searching" ? `${ride.driver.name} · ${copy.map}` : copy.map;
  if (ride.status !== "searching") $("#ride-meta-pill").textContent = copy.note;

  renderSummary();
  renderDriver();
  renderTimeline();
  renderActions();
  renderOffers();
  drawRoute();
  updateDriverMarker(ride.driver?.currentLocation);

  if (ride.status !== "searching") {
    document.title = `${copy.label} · SheDrive`;
  }
}

async function loadRide({ silent = false } = {}) {
  try {
    const result = await api.get(`/rides/${rideId}`);
    ride = result.ride;
    if (Array.isArray(ride.offers)) {
      offers = new Map(ride.offers.map((offer) => [offer.id, offer]));
    }
    if (ride.driver?.currentLocation) joinRide(socket, rideId);
    renderRide();
  } catch (error) {
    if (error?.status === 404) {
      window.location.replace("/book.html");
      return;
    }
    if (!silent) {
      showToast(error?.message || "We could not refresh your ride.", { tone: "error" });
    }
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = window.setInterval(() => {
    if (!socket?.connected) loadRide({ silent: true });
  }, 4000);
}

function stopPolling() {
  if (!pollTimer) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

async function acceptOffer(offerIdToAccept, button) {
  const buttons = Array.from(document.querySelectorAll(".offer-accept"));
  buttons.forEach((item) => {
    item.disabled = true;
  });
  setBusy(button, true, "Accepting…");

  try {
    const result = await api.post(`/rides/${rideId}/offers/${offerIdToAccept}/accept`);
    ride = result.ride;
    offers.clear();
    renderRide();
    showToast(`${ride.driver?.name || "Your driver"} is on the way.`, { tone: "success" });
  } catch (error) {
    buttons.forEach((item) => {
      item.disabled = false;
    });
    setBusy(button, false);
    if (error?.code === "OFFER_UNAVAILABLE" || error?.code === "RIDE_ALREADY_ACCEPTED") {
      await loadRide({ silent: true });
    }
    showToast(error?.message || "We could not accept that offer.", { tone: "error" });
  }
}

function openCancelModal() {
  lastFocused = document.activeElement;
  $("#cancel-reason").value = "";
  cancelModal.hidden = false;
  document.body.style.overflow = "hidden";
  $("#cancel-reason").focus();
}

function closeCancelModal() {
  cancelModal.hidden = true;
  document.body.style.overflow = "";
  if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
}

async function cancelRide() {
  const button = $("#cancel-confirm");
  setBusy(button, true, "Cancelling…");
  try {
    const result = await api.post(`/rides/${rideId}/cancel`, {
      reason: $("#cancel-reason").value.trim(),
    });
    ride = result.ride;
    closeCancelModal();
    renderRide();
    showToast("Your ride was cancelled.", { tone: "success" });
  } catch (error) {
    showToast(error?.message || "We could not cancel this ride.", { tone: "error" });
  } finally {
    setBusy(button, false);
  }
}

function initMap() {
  map = L.map(mapEl, {
    center: CITY_CENTER,
    zoom: 13,
    zoomControl: false,
    attributionControl: true,
    preferCanvas: true,
  });

  L.tileLayer(TILES, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);
  new ResizeObserver(() => map.invalidateSize()).observe(mapEl);
}

function bindSocket() {
  socket = getSocket();
  if (!socket) return;

  socket.on("connect", () => {
    stopPolling();
    setMapNote("Live updates on");
    if (rideId) joinRide(socket, rideId);
    loadRide({ silent: true });
  });

  socket.on("disconnect", () => {
    setMapNote("Reconnecting");
    startPolling();
  });

  socket.on("connect_error", () => {
    setMapNote("Polling updates");
    startPolling();
  });

  socket.on("offer:new", (payload) => {
    if (!payload?.offer || payload.offer.rideId !== rideId || ride?.status !== "searching") return;
    offers.set(payload.offer.id, payload.offer);
    renderOffers();
  });

  socket.on("offer:accepted", (payload) => {
    if (!payload?.ride || payload.ride.id !== rideId) return;
    ride = payload.ride;
    offers.clear();
    renderRide();
    showToast(`${ride.driver?.name || "Your driver"} is on the way.`, { tone: "success" });
  });

  socket.on("ride:status", (payload) => {
    if (!payload?.ride || payload.ride.id !== rideId) return;
    ride = payload.ride;
    if (ride.status !== "searching") offers.clear();
    renderRide();
  });

  socket.on("ride:location", (payload) => {
    if (!payload || payload.rideId !== rideId) return;
    updateDriverMarker(payload);
  });

  socket.on("sos:updated", (payload) => {
    if (!payload?.alert) return;
    sosAlert = payload.alert;
    renderSosButton();
    if (!sosModal.hidden) renderSosModal();
    showToast(
      sosAlert.status === "resolved"
        ? "The safety desk resolved your SOS alert."
        : "The safety desk acknowledged your SOS alert.",
      { tone: "success" }
    );
  });
}

function bindEvents() {
  cancelButton.addEventListener("click", openCancelModal);
  $("#cancel-close").addEventListener("click", closeCancelModal);
  $("#cancel-confirm").addEventListener("click", cancelRide);
  document.querySelectorAll("[data-close-cancel]").forEach((element) => {
    element.addEventListener("click", closeCancelModal);
  });

  sosButton?.addEventListener("click", openSosModal);
  $("#sos-confirm")?.addEventListener("click", sendSos);
  $("#sos-close")?.addEventListener("click", closeSosModal);
  document.querySelectorAll("[data-close-sos]").forEach((element) => {
    element.addEventListener("click", closeSosModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!sosModal.hidden) closeSosModal();
    else if (!cancelModal.hidden) closeCancelModal();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadRide({ silent: true });
  });

  window.addEventListener("pagehide", () => {
    leaveRide(socket, rideId);
    disconnectSocket();
  });
}

async function resolveRide() {
  const requested = new URLSearchParams(window.location.search).get("ride");
  if (requested) {
    rideId = requested;
    return true;
  }

  const result = await api.get("/rides/active");
  if (!result.ride) {
    window.location.replace("/book.html");
    return false;
  }
  rideId = result.ride.id;
  window.history.replaceState(null, "", `/ride.html?ride=${encodeURIComponent(rideId)}`);
  return true;
}

async function main() {
  user = await bootPage({ roles: ["rider"] });
  if (!user) return;
  if (user.verificationStatus !== "approved") {
    window.location.replace("/book.html");
    return;
  }

  try {
    if (!(await resolveRide())) return;
  } catch (error) {
    showToast(error?.message || "We could not find your ride.", { tone: "error" });
    window.location.replace("/book.html");
    return;
  }

  initMap();
  bindEvents();
  bindSocket();
  await loadRide();
  if (!sosLoaded) refreshSosState();
  requestAnimationFrame(() => map.invalidateSize());
}

main();
