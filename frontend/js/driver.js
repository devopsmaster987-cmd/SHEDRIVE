import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "./api.js";
import { bootPage, formatCurrency, setBusy, showToast, statusLabel } from "./shell.js";
import { getSocket, joinRide, disconnectSocket } from "./socket.js";

const $ = (selector, root = document) => root.querySelector(selector);

const CITY_CENTER = [12.9716, 77.5946];
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const mapEl = $("#driver-map");
const onlineToggle = $("#online-toggle");
const requestState = $("#request-state");
const requestCopy = $("#request-copy");

let user = null;
let dashboard = null;
let map = null;
let driverMarker = null;
let watchId = null;
let lastWatchSent = 0;
let socket = null;
let activeRide = null;
let requests = new Map();
let requestPoll = null;

const driverIcon = L.divIcon({
  className: "map-pin-wrap",
  html: '<div class="map-pin pin-driver is-pulsing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 15 1.2-4.1A2 2 0 0 1 8.1 9.4h7.8a2 2 0 0 1 1.9 1.5L19 15v3h-2v-1H7v1H5v-3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 15h10" stroke="currentColor" stroke-width="1.2"/></svg></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function licenceLabel(status) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Not approved";
  return "Pending review";
}

function setPageStatus(online) {
  const badge = $("#driver-status");
  badge.textContent = online ? "Online" : "Offline";
  badge.classList.toggle("is-warning", !online);

  const card = $("#online-card");
  card.classList.toggle("is-online", online);
  $("#online-title").textContent = online ? "You are online" : "You are offline";
  $("#online-copy").textContent = online
    ? "Your position is visible to nearby riders while you drive."
    : "Go online when you are ready to see nearby ride requests.";

  if (!dashboard) return;

  if (activeRide) {
    requestState.textContent = "Active ride";
    requestCopy.textContent = "Finish your current trip before taking another request.";
  } else if (!online) {
    requestState.textContent = "You are offline";
    requestCopy.textContent = "Go online to start listening for ride requests in your area.";
  } else if (!dashboard.driver.currentLocation) {
    requestState.textContent = "Add your location";
    requestCopy.textContent = "Tap the map or use your current position so riders can find you.";
  } else {
    requestState.textContent = "Listening for nearby rides";
    requestCopy.textContent = "Keep this page open. Nearby fares appear here as riders request them.";
  }
}

function requestCard(request) {
  const article = document.createElement("article");
  article.className = "request-item";

  const head = document.createElement("div");
  head.className = "request-item-head";
  const summary = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = request.rider?.name || "SheDrive rider";
  const meta = document.createElement("small");
  meta.textContent = `${request.vehicleType} · ${Number(request.distanceKm).toFixed(1)} km trip · ${request.durationMinutes} min`;
  summary.append(name, meta);
  const price = document.createElement("span");
  price.className = "request-item-price";
  price.textContent = formatCurrency(request.offeredPrice);
  head.append(summary, price);

  const route = document.createElement("div");
  route.className = "request-route";
  const pickup = document.createElement("span");
  pickup.innerHTML = "<i aria-hidden=\"true\"></i>";
  pickup.append(request.pickup?.label || "Pinned pickup");
  const drop = document.createElement("span");
  drop.innerHTML = "<i aria-hidden=\"true\"></i>";
  drop.append(request.drop?.label || "Pinned drop");
  route.append(pickup, drop);

  const actions = document.createElement("div");
  actions.className = "request-actions";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "btn btn-primary btn-sm";
  accept.textContent = `Accept ${formatCurrency(request.offeredPrice)}`;
  accept.addEventListener("click", () => sendOffer(request.id, request.offeredPrice, accept));
  const counter = document.createElement("button");
  counter.type = "button";
  counter.className = "btn btn-ghost btn-sm";
  counter.textContent = "Counter";
  actions.append(accept, counter);

  const counterField = document.createElement("div");
  counterField.className = "counter-field";
  counterField.hidden = true;
  const input = document.createElement("input");
  input.type = "number";
  input.inputMode = "numeric";
  input.min = "20";
  input.max = "10000";
  input.step = "5";
  input.value = String(request.offeredPrice);
  input.setAttribute("aria-label", "Your counter offer in rupees");
  const send = document.createElement("button");
  send.type = "button";
  send.className = "btn btn-primary btn-sm";
  send.textContent = "Send counter";
  send.addEventListener("click", () => sendOffer(request.id, Number(input.value), send));
  counterField.append(input, send);

  counter.addEventListener("click", () => {
    counterField.hidden = !counterField.hidden;
    if (!counterField.hidden) input.focus();
  });

  article.append(head, route, actions, counterField);
  return article;
}

function renderRequests() {
  const banner = $("#active-ride-banner");
  const list = $("#request-list");
  const empty = $("#request-empty");

  if (activeRide) {
    banner.hidden = false;
    $("#active-ride-copy").textContent = `${activeRide.rider?.name || "Your rider"} · ${activeRide.pickup?.label || "pickup"} to ${activeRide.drop?.label || "drop"}`;
    $("#active-ride-link").href = `/driver-ride.html?ride=${encodeURIComponent(activeRide.id)}`;
    list.hidden = true;
    empty.hidden = true;
    return;
  }

  banner.hidden = true;
  const ready =
    dashboard?.driver.isOnline &&
    Boolean(dashboard?.driver.currentLocation) &&
    user?.verificationStatus === "approved";

  if (!ready || requests.size === 0) {
    list.hidden = true;
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  list.hidden = false;
  list.replaceChildren(
    ...Array.from(requests.values())
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(requestCard)
  );
}

function stopRequestPolling() {
  if (!requestPoll) return;
  window.clearInterval(requestPoll);
  requestPoll = null;
}

function startRequestPolling() {
  if (requestPoll || activeRide || !dashboard?.driver.isOnline) return;
  requestPoll = window.setInterval(() => {
    if (!socket?.connected) loadRequests({ silent: true });
  }, 10000);
}

async function loadRequests({ silent = false } = {}) {
  if (!dashboard?.driver.isOnline || activeRide) {
    requests.clear();
    renderRequests();
    return;
  }

  try {
    const result = await api.get("/rides/opportunities");
    requests = new Map(result.rides.map((request) => [request.id, request]));
    renderRequests();
  } catch (error) {
    if (!silent) {
      showToast(error?.message || "The ride radar is unavailable right now.", { tone: "error" });
    }
  }
}

function setActiveRide(next) {
  activeRide = next;
  if (activeRide) {
    requests.clear();
    stopRequestPolling();
    joinRide(socket, activeRide.id);
  }
  renderRequests();
  setPageStatus(Boolean(dashboard?.driver.isOnline));
  if (!activeRide && dashboard?.driver.isOnline) {
    startRequestPolling();
    loadRequests({ silent: true });
  }
}

async function loadActiveRide({ silent = false } = {}) {
  try {
    const result = await api.get("/rides/active");
    setActiveRide(result.ride);
  } catch (error) {
    if (!silent) {
      showToast(error?.message || "We could not check your active ride.", { tone: "error" });
    }
  }
}

async function sendOffer(rideId, price, button) {
  if (!Number.isFinite(price) || price < 20) {
    showToast("Enter a counter-offer of at least Rs20.", { tone: "error" });
    return;
  }

  setBusy(button, true, "Sending…");
  try {
    await api.post(`/rides/${rideId}/offers`, { offerPrice: Math.round(price) });
    requests.delete(rideId);
    renderRequests();
    showToast("Offer sent. Waiting for the rider.", { tone: "success" });
  } catch (error) {
    if (error?.code === "DRIVER_ACTIVE_RIDE") {
      await loadActiveRide({ silent: true });
    }
    showToast(error?.message || "We could not send your offer.", { tone: "error" });
    setBusy(button, false);
  }
}

function bindSocket() {
  socket = getSocket();
  if (!socket) return;

  socket.on("connect", () => {
    loadActiveRide({ silent: true });
    if (!activeRide) loadRequests({ silent: true });
  });

  socket.on("ride:request", (payload) => {
    if (!payload?.ride || activeRide || !dashboard?.driver.isOnline) return;
    requests.set(payload.ride.id, payload.ride);
    renderRequests();
    showToast("New ride request nearby.", { tone: "success" });
  });

  socket.on("offer:accepted", (payload) => {
    if (!payload?.ride || payload.ride.driver?.id !== user?.id) return;
    activeRide = payload.ride;
    setActiveRide(payload.ride);
    window.location.assign(`/driver-ride.html?ride=${encodeURIComponent(payload.ride.id)}`);
  });

  socket.on("ride:status", (payload) => {
    if (!payload?.ride || !activeRide || payload.ride.id !== activeRide.id) return;
    if (["completed", "cancelled"].includes(payload.ride.status)) setActiveRide(null);
  });
}

function renderEarnings(earnings) {
  $("#earnings-today").textContent = formatCurrency(earnings.today);
  $("#earnings-week").textContent = formatCurrency(earnings.week);
  $("#earnings-total").textContent = formatCurrency(earnings.total);
  $("#earnings-trips").textContent = String(earnings.trips);
}

function renderVehicle() {
  const driver = dashboard.driver;
  $("#vehicle-title").textContent = driver.vehicleType;
  $("#vehicle-name").textContent = driver.vehicleType;
  $("#vehicle-plate").textContent = driver.plateNumber;
  $("#driver-rating").textContent = `${Number(driver.ratingAvg).toFixed(2)} ★`;
  $("#licence-status").textContent = licenceLabel(driver.licenseDocStatus);
  $("#account-status").textContent = statusLabel(user.verificationStatus);
  $("#online-drivers").textContent = String(dashboard.onlineDrivers);
  $("#online-driver-pill").textContent = `${dashboard.onlineDrivers} driver${dashboard.onlineDrivers === 1 ? "" : "s"} online`;

  const isCar = driver.vehicleType === "Car";
  const isBike = driver.vehicleType === "Bike";
  $("#vehicle-icon").innerHTML = isBike
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="17" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="18" cy="17" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m6 17 4-6h5l3 6M10 11h6M14 7h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : isCar
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 15 1.2-4.1A2 2 0 0 1 8.1 9.4h7.8a2 2 0 0 1 1.9 1.5L19 15v3h-2v-1H7v1H5v-3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 15h10" stroke="currentColor" stroke-width="1.2"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16V9h11l3 4h2v3h-2a2 2 0 0 0-4 0H9a2 2 0 0 0-4 0H4Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="7" cy="16" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="16" cy="16" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
}

function updateMapPosition(location, { center = false } = {}) {
  const lat = location.lat;
  const lng = location.lng;

  if (!driverMarker) {
    driverMarker = L.marker([lat, lng], { icon: driverIcon }).addTo(map);
  } else {
    driverMarker.setLatLng([lat, lng]);
  }

  if (center) map.setView([lat, lng], 15);
  $("#location-copy").textContent = `Live position · ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function setControls() {
  const approved = user.verificationStatus === "approved";
  onlineToggle.disabled = !approved;
  $("#refresh-location").disabled = !approved;

  if (!approved) {
    onlineToggle.checked = false;
    setPageStatus(false);
    requestState.textContent = "Approval needed";
    requestCopy.textContent =
      "Your account is still with the safety team. The radar switches on after approval.";
    $("#request-tip").textContent = "You can still preview your dashboard while you wait.";
  }
}

function renderDashboard() {
  renderEarnings(dashboard.earnings);
  renderVehicle();
  onlineToggle.checked = dashboard.driver.isOnline;
  setPageStatus(dashboard.driver.isOnline);
  setControls();
  renderRequests();

  if (dashboard.driver.currentLocation) {
    updateMapPosition(dashboard.driver.currentLocation, { center: true });
  }
}

async function loadDashboard({ silent = false } = {}) {
  try {
    dashboard = await api.get("/drivers/me");
    renderDashboard();
    if (dashboard.driver.isOnline) startWatch();
  } catch (error) {
    if (!silent) {
      showToast(error?.message || "We could not load your driver dashboard.", { tone: "error" });
    }
  }
}

function stopWatch() {
  if (watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
  watchId = null;
  lastWatchSent = 0;
}

function startWatch() {
  if (watchId !== null || !navigator.geolocation || !dashboard?.driver.isOnline) return;

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const now = Date.now();
      if (now - lastWatchSent < 25000) return;
      lastWatchSent = now;
      saveLocation(position.coords.latitude, position.coords.longitude, { silent: true });
    },
    () => {
      showToast("Location tracking is off. Tap the map to set a position manually.", {
        tone: "error",
      });
      stopWatch();
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 }
  );
}

async function saveLocation(lat, lng, { silent = false } = {}) {
  updateMapPosition({ lat, lng });
  try {
    const result = await api.patch("/drivers/me/location", { lat, lng });
    dashboard.driver = result.driver;
    $("#location-copy").textContent = `Live position · ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    if (!silent) showToast("Your city position is updated.", { tone: "success" });
    setPageStatus(dashboard.driver.isOnline);
    renderRequests();
    if (!silent && dashboard.driver.isOnline && !activeRide) loadRequests({ silent: true });
  } catch (error) {
    if (!silent) {
      showToast(error?.message || "We could not update your location.", { tone: "error" });
    }
  }
}

async function toggleOnline() {
  const next = onlineToggle.checked;
  onlineToggle.disabled = true;
  setPageStatus(next);

  try {
    const result = await api.patch("/drivers/me/status", { isOnline: next });
    dashboard.driver = result.driver;
    dashboard.onlineDrivers = result.onlineDrivers;
    renderVehicle();
    setPageStatus(next);

    if (next) {
      startWatch();
      startRequestPolling();
      loadRequests({ silent: true });
      showToast("You are online. Stay safe out there.", { tone: "success" });
    } else {
      stopWatch();
      stopRequestPolling();
      requests.clear();
      renderRequests();
      showToast("You are offline. Location sharing is paused.");
    }
  } catch (error) {
    onlineToggle.checked = !next;
    setPageStatus(!next);
    showToast(error?.message || "We could not change your status.", { tone: "error" });
  } finally {
    onlineToggle.disabled = false;
    setControls();
  }
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    showToast("This browser does not support location access.", { tone: "error" });
    return;
  }

  showToast("Finding your position…");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      saveLocation(position.coords.latitude, position.coords.longitude);
      map.setView([position.coords.latitude, position.coords.longitude], 15);
      lastWatchSent = Date.now();
    },
    () => {
      showToast("Location permission was not granted. Tap the map to set it manually.", {
        tone: "error",
      });
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
  );
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

  map.on("click", (event) => {
    if (user.verificationStatus !== "approved") {
      showToast("You can set a position after approval.", { tone: "error" });
      return;
    }
    saveLocation(event.latlng.lat, event.latlng.lng);
  });

  new ResizeObserver(() => map.invalidateSize()).observe(mapEl);
}

function bindEvents() {
  onlineToggle.addEventListener("change", toggleOnline);
  $("#refresh-location").addEventListener("click", useCurrentLocation);

  $("#refresh-dashboard").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setBusy(button, true, "");
    await loadDashboard();
    await loadActiveRide({ silent: true });
    await loadRequests({ silent: true });
    setBusy(button, false);
    showToast("Dashboard refreshed.");
  });

  $("#request-focus-map").addEventListener("click", () => {
    mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
    mapEl.focus({ preventScroll: true });
  });

  window.addEventListener("pagehide", () => {
    stopWatch();
    stopRequestPolling();
    disconnectSocket();
  });
}

async function main() {
  user = await bootPage({ roles: ["driver"] });
  if (!user) return;

  setControls();
  initMap();
  bindEvents();
  bindSocket();
  await loadDashboard();
  await loadActiveRide({ silent: true });
  await loadRequests({ silent: true });
  startRequestPolling();
  requestAnimationFrame(() => map.invalidateSize());
}

main();
