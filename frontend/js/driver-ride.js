import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "./api.js";
import { bootPage, formatCurrency, setBusy, showToast } from "./shell.js";
import { getSocket, joinRide, leaveRide, disconnectSocket } from "./socket.js";

const $ = (selector, root = document) => root.querySelector(selector);
const CITY_CENTER = [12.9716, 77.5946];
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TIMELINE = ["accepted", "arriving", "in_progress", "completed"];
const STATUS_COPY = {
  accepted: {
    label: "Driver assigned",
    subtitle: "Head to the pickup and tell your rider when you arrive.",
    control: "Let the rider know when you reach the pickup point.",
    map: "Heading to pickup",
    meta: "Location sharing on",
  },
  arriving: {
    label: "Arriving",
    subtitle: "You are close to the pickup. Start the ride once your rider is aboard.",
    control: "Confirm your rider is with you before starting.",
    map: "Waiting at pickup",
    meta: "Rider notified",
  },
  in_progress: {
    label: "On the way",
    subtitle: "Keep to the planned route and complete the ride at the drop.",
    control: "Complete the trip when your rider reaches the drop safely.",
    map: "Following route",
    meta: "Live trip",
  },
  completed: {
    label: "Completed",
    subtitle: "This ride is complete and the fare is added to your earnings.",
    control: "Trip complete.",
    map: "Ride completed",
    meta: "Fare added",
  },
  cancelled: {
    label: "Cancelled",
    subtitle: "This ride was cancelled. Head back to your dashboard when ready.",
    control: "Ride cancelled.",
    map: "Ride cancelled",
    meta: "Ride cancelled",
  },
};
const NEXT_STATUS = {
  accepted: { label: "I have arrived", status: "arriving" },
  arriving: { label: "Start ride", status: "in_progress" },
  in_progress: { label: "Complete ride", status: "completed" },
};

const mapEl = $("#trip-map");
const cancelModal = $("#cancel-modal");
const primaryButton = $("#trip-primary");
const cancelButton = $("#trip-cancel");
const sosModal = $("#sos-modal");
const sosButton = $("#trip-sos");
const SOS_STATUS_COPY = {
  open: "Open",
  acknowledged: "Safety desk with you",
  resolved: "Resolved",
};

let user = null;
let rideId = null;
let ride = null;
let socket = null;
let map = null;
let pickupMarker = null;
let dropMarker = null;
let driverMarker = null;
let routeLayers = [];
let hasFitRoute = false;
let watchId = null;
let lastLocationSent = 0;
let locationWarned = false;
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

function isFinished() {
  return ["completed", "cancelled"].includes(ride?.status);
}

function setMapNote(text) {
  $("#trip-map-note").innerHTML = `<i aria-hidden="true"></i>${text}`;
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

function renderTimeline() {
  const index = TIMELINE.indexOf(ride.status);
  for (const item of document.querySelectorAll("#trip-timeline [data-step]")) {
    const stepIndex = TIMELINE.indexOf(item.dataset.step);
    item.classList.toggle("is-done", stepIndex < index || ride.status === "completed");
    item.classList.toggle("is-current", stepIndex === index && ride.status !== "completed");
  }
}

function renderHeader() {
  const copy = STATUS_COPY[ride.status] || STATUS_COPY.accepted;
  const badge = $("#trip-status-badge");
  badge.textContent = copy.label;
  badge.classList.toggle("is-warning", ["accepted", "arriving", "in_progress"].includes(ride.status));
  badge.classList.toggle("is-danger", ride.status === "cancelled");
  $("#trip-subtitle").textContent = copy.subtitle;
  $("#trip-meta-pill").textContent = copy.meta;
  $("#trip-map-status").textContent = copy.map;
  $("#trip-control-copy").textContent = copy.control;
  document.title = `${copy.label} · SheDrive`;
}

function renderSummary() {
  $("#trip-fare").textContent = formatCurrency(ride.finalPrice ?? ride.offeredPrice);
  $("#trip-id").textContent = `#${shortId(ride.id)}`;
  $("#trip-pickup").textContent = ride.pickup?.label || "Pinned pickup";
  $("#trip-drop").textContent = ride.drop?.label || "Pinned drop";
  $("#trip-distance").textContent = `${Number(ride.distanceKm).toFixed(1)} km`;
  $("#trip-vehicle").textContent = ride.vehicleType || "—";
  $("#trip-duration").textContent = `${ride.durationMinutes} min`;
}

function renderRider() {
  $("#rider-name").textContent = ride.rider?.name || "SheDrive rider";
  $("#rider-avatar").textContent = initials(ride.rider?.name);
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
    sosAlert.status === "resolved" ? "The safety desk resolved this." : "Help is on the way.";
  $("#sos-sent-copy").textContent =
    sosAlert.status === "resolved"
      ? sosAlert.note || "Your alert is closed. Reach out to support if you need anything else."
      : sosAlert.status === "acknowledged"
        ? "A safety team member has acknowledged your alert and is coordinating with you."
        : "The safety team can see your trip and last shared location.";
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
    // A safety network check must not interrupt the trip view.
  }
}

async function sendSos() {
  const button = $("#sos-confirm");
  setBusy(button, true, "Alerting safety…");

  try {
    const location = await locateForSos();
    const body = {
      rideId,
      message: "Driver triggered SOS from the active trip.",
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

function renderControls() {
  const next = NEXT_STATUS[ride.status];
  primaryButton.hidden = !next;
  cancelButton.hidden = !ride.canCancel;
  const summary = $("#trip-summary");
  summary.hidden = ride.status !== "completed";
  summary.href = `/summary.html?ride=${encodeURIComponent(ride.id)}`;
  $("#trip-home").hidden = !isFinished();
  renderSosButton();

  if (next) {
    primaryButton.textContent =
      ride.status === "in_progress" ? "Complete ride" : next.label;
    primaryButton.dataset.nextStatus = next.status;
  }
}

function renderRide() {
  renderHeader();
  renderSummary();
  renderRider();
  renderTimeline();
  renderControls();
  drawRoute();
  updateDriverMarker(ride.driver?.currentLocation);

  if (isFinished()) stopLocationSharing();
}

async function loadRide({ silent = false } = {}) {
  try {
    const result = await api.get(`/rides/${rideId}`);
    ride = result.ride;
    renderRide();
  } catch (error) {
    if (error?.status === 404 || error?.status === 403) {
      window.location.replace("/driver.html");
      return;
    }
    if (!silent) {
      showToast(error?.message || "We could not refresh this ride.", { tone: "error" });
    }
  }
}

function fallbackLocation(lat, lng) {
  api.patch("/drivers/me/location", { lat, lng }).catch(() => {});
}

function sendLocation(lat, lng) {
  const now = Date.now();
  if (now - lastLocationSent < 3500) return;
  lastLocationSent = now;
  updateDriverMarker({ lat, lng });

  if (socket?.connected) {
    socket.emit("driver:location", { rideId, lat, lng }, (response) => {
      if (response && response.ok === false) fallbackLocation(lat, lng);
    });
  } else {
    fallbackLocation(lat, lng);
  }
}

function startLocationSharing() {
  if (watchId !== null || isFinished()) return;
  if (!navigator.geolocation) {
    if (!locationWarned) {
      locationWarned = true;
      showToast("This browser cannot share live location.", { tone: "error" });
    }
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      sendLocation(position.coords.latitude, position.coords.longitude);
    },
    () => {
      if (!locationWarned) {
        locationWarned = true;
        showToast("Location sharing is off. Your rider will see the last known position.", {
          tone: "error",
        });
      }
    },
    { enableHighAccuracy: true, maximumAge: 8000, timeout: 15000 }
  );
}

function stopLocationSharing() {
  if (watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
  watchId = null;
  lastLocationSent = 0;
}

async function changeStatus() {
  const nextStatus = primaryButton.dataset.nextStatus;
  if (!nextStatus) return;
  setBusy(primaryButton, true, "Updating…");

  try {
    const result = await api.patch(`/rides/${rideId}/status`, { status: nextStatus });
    ride = result.ride;
    renderRide();
    if (nextStatus === "completed") {
      showToast("Ride completed. The fare is in your earnings.", { tone: "success" });
    } else if (nextStatus === "arriving") {
      showToast("Your rider knows you have arrived.", { tone: "success" });
    } else {
      showToast("Ride started. Drive safely.", { tone: "success" });
    }
  } catch (error) {
    showToast(error?.message || "We could not update the ride.", { tone: "error" });
  } finally {
    setBusy(primaryButton, false);
    if (ride) renderControls();
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
    showToast("The ride was cancelled.", { tone: "success" });
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
    setMapNote("Live location on");
    if (rideId) joinRide(socket, rideId);
    loadRide({ silent: true });
  });

  socket.on("disconnect", () => {
    setMapNote("Location saved in background");
  });

  socket.on("ride:status", (payload) => {
    if (!payload?.ride || payload.ride.id !== rideId) return;
    ride = payload.ride;
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
  primaryButton.addEventListener("click", changeStatus);
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
    stopLocationSharing();
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
    window.location.replace("/driver.html");
    return false;
  }
  rideId = result.ride.id;
  window.history.replaceState(null, "", `/driver-ride.html?ride=${encodeURIComponent(rideId)}`);
  return true;
}

async function main() {
  user = await bootPage({ roles: ["driver"] });
  if (!user) return;
  if (user.verificationStatus !== "approved") {
    window.location.replace("/driver.html");
    return;
  }

  try {
    if (!(await resolveRide())) return;
  } catch (error) {
    showToast(error?.message || "We could not find your active ride.", { tone: "error" });
    window.location.replace("/driver.html");
    return;
  }

  initMap();
  bindEvents();
  bindSocket();
  await loadRide();
  if (!sosLoaded) refreshSosState();
  startLocationSharing();
  requestAnimationFrame(() => map.invalidateSize());
}

main();
