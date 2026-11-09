import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "./api.js";
import { bootPage, showToast, formatCurrency, setBusy } from "./shell.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const CITY_CENTER = [30.1978, 71.4697];
const DRAFT_KEY = "shedrive:ride-draft";
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const mapEl = $("#booking-map");
const pickupInput = $("#pickup-input");
const dropInput = $("#drop-input");
const offerInput = $("#offer-input");
const previewButton = $("#preview-button");
const requestRideButton = $("#request-ride");
const previewModal = $("#preview-modal");
const statusBadge = $("#booking-status");
const nearbyPill = $("#nearby-pill");

let user = null;
let map = null;
let pickup = null;
let drop = null;
let pickupMarker = null;
let dropMarker = null;
let routeLayers = [];
let driverLayer = null;
let activePoint = "pickup";
let vehicleType = "Car";
let currentEstimate = null;
let offerTouched = false;
let estimateRequest = 0;
let nearbyRequest = 0;
let lastFocused = null;
let nearbyTimer = null;

const pickupIcon = L.divIcon({
  className: "map-pin-wrap",
  html: '<div class="map-pin pin-pickup is-pulsing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="11" r="2.2" fill="currentColor"/></svg></div>',
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

function setActivePoint(point) {
  activePoint = point === "drop" ? "drop" : "pickup";
  $$(".route-field").forEach((field) => {
    field.classList.toggle("is-active", field.dataset.point === activePoint);
  });
  $$("[data-map-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mapMode === activePoint);
  });
  $("#map-mode-note").innerHTML = `<i aria-hidden="true"></i>Tap the map for ${activePoint}`;
}

function updateMapReadout() {
  const center = map.getCenter();
  const point = activePoint === "pickup" ? pickup : drop;
  const coords = point || { lat: center.lat, lng: center.lng };
  $("#map-coordinates").textContent =
    `${activePoint === "pickup" ? "Pickup" : "Drop"} · ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
}

function labelFor(point, fallback) {
  return point?.label || fallback;
}

function setStatus(text, tone = "") {
  statusBadge.textContent = text;
  statusBadge.classList.toggle("is-warning", tone === "warning");
  statusBadge.classList.toggle("is-danger", tone === "danger");
}

function phaseReady() {
  return user?.verificationStatus === "approved";
}

function updateButtonState() {
  const validOffer = Number(offerInput.value) >= 20;
  previewButton.disabled = !currentEstimate || !validOffer || !phaseReady();
}

function updateOfferCopy() {
  const offer = Number(offerInput.value);
  const delta = $("#offer-delta");
  const copy = $("#offer-copy");

  if (!currentEstimate || !Number.isFinite(offer) || offer <= 0) {
    delta.textContent = "Set a route to see the suggestion.";
    copy.textContent = "Drivers can accept or counter your offer.";
    return;
  }

  const difference = offer - currentEstimate.suggestedFare;
  if (difference === 0) {
    delta.textContent = "Right on the suggested fare.";
  } else if (difference > 0) {
    delta.textContent = `${formatCurrency(difference)} above the suggestion.`;
  } else {
    delta.textContent = `${formatCurrency(Math.abs(difference))} below the suggestion. Drivers may counter.`;
  }
  copy.textContent = `${currentEstimate.distanceKm.toFixed(1)} km · about ${currentEstimate.durationMinutes} min · ${currentEstimate.vehicleType}`;
}

function setOffer(value, { markTouched = false } = {}) {
  if (markTouched) offerTouched = true;
  offerInput.value = String(Math.max(0, Math.round(value)));
  updateOfferCopy();
  updateButtonState();
}

function drawRoute() {
  if (!map) return;
  for (const layer of routeLayers) map.removeLayer(layer);
  routeLayers = [];

  if (pickup) {
    pickupMarker = pickupMarker || L.marker([pickup.lat, pickup.lng], { icon: pickupIcon }).addTo(map);
    pickupMarker.setLatLng([pickup.lat, pickup.lng]);
    if (!map.hasLayer(pickupMarker)) pickupMarker.addTo(map);
  }

  if (drop) {
    dropMarker = dropMarker || L.marker([drop.lat, drop.lng], { icon: dropIcon }).addTo(map);
    dropMarker.setLatLng([drop.lat, drop.lng]);
    if (!map.hasLayer(dropMarker)) dropMarker.addTo(map);
  }

  if (pickup && drop) {
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
      lineCap: "round",
    }).addTo(map);
    routeLayers.push(glow, line, core);
    map.fitBounds(line.getBounds(), { padding: [70, 70], maxZoom: 15 });
  }
}

function updatePoint(kind, lat, lng, label, { reverse = false } = {}) {
  const point = { lat: Number(lat), lng: Number(lng), label: label || "" };

  if (kind === "pickup") pickup = point;
  else drop = point;

  const input = kind === "pickup" ? pickupInput : dropInput;
  if (label) input.value = label;
  offerTouched = false;

  drawRoute();
  updateMapReadout();
  refreshEstimate();

  if (reverse && !label) {
    reverseGeocode(point)
      .then((name) => {
        if (!name) return;
        point.label = name;
        input.value = name;
      })
      .catch(() => {});
  }

  if (kind === "pickup") setActivePoint("drop");
  else updateMapReadout();
}

const GEOCODE_TIMEOUT_MS = 4000;

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Address service returned an error");
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function reverseGeocode(point) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(point.lat));
  url.searchParams.set("lon", String(point.lng));
  url.searchParams.set("zoom", "17");

  const payload = await fetchJsonWithTimeout(url);
  return payload.display_name ? String(payload.display_name).split(",").slice(0, 3).join(",") : "";
}

async function geocode(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", query);

  const results = await fetchJsonWithTimeout(url);
  return Array.isArray(results) && results[0]
    ? { lat: Number(results[0].lat), lng: Number(results[0].lon), label: results[0].display_name }
    : null;
}

async function searchPoint(kind) {
  const input = kind === "pickup" ? pickupInput : dropInput;
  const query = input.value.trim();
  if (!query) {
    showToast("Type an address or tap the map to drop a pin.", { tone: "error" });
    input.focus();
    return;
  }

  const button = $(`[data-search="${kind}"]`);
  const confirmed = kind === "pickup" ? pickup : drop;
  button.disabled = true;
  try {
    const result = await geocode(query);
    if (!result) {
      // Keep the field honest: only show text that maps to a real coordinate.
      input.value = confirmed?.label || "";
      showToast("We could not find that address. Try a landmark or tap the map.", {
        tone: "error",
      });
      return;
    }
    setActivePoint(kind);
    updatePoint(kind, result.lat, result.lng, String(result.label).split(",").slice(0, 3).join(","));
  } catch {
    input.value = confirmed?.label || "";
    showToast("Address search is unavailable. Tap the map instead.", { tone: "error" });
  } finally {
    button.disabled = false;
  }
}

function useMyLocation() {
  if (!navigator.geolocation) {
    showToast("This browser does not support location access.", { tone: "error" });
    return;
  }

  const target = activePoint;
  showToast("Finding your position…");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      updatePoint(target, position.coords.latitude, position.coords.longitude, "My current location");
      map.setView([position.coords.latitude, position.coords.longitude], 15);
      showToast("Your location is on the map.");
    },
    () => {
      showToast("Location permission was not granted. Tap the map to set a point.", {
        tone: "error",
      });
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

async function refreshEstimate() {
  if (!pickup || !drop) {
    currentEstimate = null;
    $("#distance-value").textContent = "—";
    $("#duration-value").textContent = "—";
    $("#suggested-value").textContent = "—";
    $("#route-hint").textContent = "Add both points to calculate distance.";
    $("#offer-chips").hidden = true;
    setStatus("Route planning");
    updateOfferCopy();
    updateButtonState();
    return;
  }

  const request = ++estimateRequest;
  setStatus("Calculating");
  $("#distance-value").textContent = "Calculating…";
  $("#duration-value").textContent = "Calculating…";
  $("#suggested-value").textContent = "Calculating…";
  $("#route-hint").textContent = "Finding the best road route…";
  $("#offer-chips").hidden = true;

  try {
    const result = await api.post("/rides/estimate", {
      pickup: { lat: pickup.lat, lng: pickup.lng, label: pickupInput.value.trim() },
      drop: { lat: drop.lat, lng: drop.lng, label: dropInput.value.trim() },
      vehicleType,
    });
    if (request !== estimateRequest) return;

    currentEstimate = result.estimate;
    pickup.label = currentEstimate.pickup.label || pickup.label;
    drop.label = currentEstimate.drop.label || drop.label;

    const distance = currentEstimate.distanceKm.toFixed(1);
    $("#distance-value").textContent = `${distance} km`;
    $("#duration-value").textContent = `${currentEstimate.durationMinutes} min`;
    $("#suggested-value").textContent = formatCurrency(currentEstimate.suggestedFare);
    $("#route-hint").textContent =
      currentEstimate.distanceSource === "osrm"
        ? `${distance} km by road through the city`
        : `${distance} km (estimated straight-line route)`;
    $("#offer-chips").hidden = false;

    if (!offerTouched || !Number(offerInput.value)) setOffer(currentEstimate.suggestedFare);
    setStatus(phaseReady() ? "Ready to review" : "Approval needed", phaseReady() ? "" : "warning");
    updateOfferCopy();
    updateButtonState();
  } catch (error) {
    if (request !== estimateRequest) return;
    currentEstimate = null;
    setStatus("Route needs attention", "danger");
    $("#distance-value").textContent = "—";
    $("#duration-value").textContent = "—";
    $("#suggested-value").textContent = "—";
    $("#route-hint").textContent =
      error?.message || "We could not calculate this route. Check your connection and try again.";
    $("#offer-chips").hidden = true;
    updateOfferCopy();
    updateButtonState();
  }
}

async function loadNearbyDrivers() {
  if (!map) return;
  const request = ++nearbyRequest;
  const center = map.getCenter();

  try {
    const result = await api.get(
      `/drivers/nearby?lat=${center.lat.toFixed(5)}&lng=${center.lng.toFixed(5)}&radiusKm=5`
    );
    if (request !== nearbyRequest) return;

    driverLayer.clearLayers();
    for (const driver of result.drivers) {
      L.marker([driver.currentLocation.lat, driver.currentLocation.lng], { icon: driverIcon })
        .bindTooltip(
          `${driver.vehicleType} · ${Number(driver.ratingAvg).toFixed(1)}★ · ${driver.distanceKm.toFixed(1)} km`,
          { direction: "top", className: "driver-tip" }
        )
        .addTo(driverLayer);
    }

    const count = result.drivers.length;
    nearbyPill.textContent = count === 0 ? "No drivers in this view" : `${count} driver${count === 1 ? "" : "s"} nearby`;
  } catch {
    if (request !== nearbyRequest) return;
    nearbyPill.textContent = "Nearby view unavailable";
  }
}

function openPreview() {
  if (!currentEstimate) return;
  const offer = Number(offerInput.value);
  if (!Number.isFinite(offer) || offer < 20) {
    showToast("Enter an offer of at least Rs 20.", { tone: "error" });
    offerInput.focus();
    return;
  }

  const rows = [
    ["Pickup", labelFor(pickup, "Pinned pickup")],
    ["Drop", labelFor(drop, "Pinned drop")],
    ["Vehicle", currentEstimate.vehicleType],
    ["Distance", `${currentEstimate.distanceKm.toFixed(1)} km`],
    ["Suggested", formatCurrency(currentEstimate.suggestedFare)],
    ["Your offer", formatCurrency(offer)],
  ];

  $("#preview-route").replaceChildren(
    ...rows.map(([label, value]) => {
      const row = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = label;
      const data = document.createElement("strong");
      data.textContent = value;
      row.append(name, data);
      return row;
    })
  );

  lastFocused = document.activeElement;
  previewModal.hidden = false;
  document.body.style.overflow = "hidden";
  $("#preview-close").focus();
}

function closePreview() {
  previewModal.hidden = true;
  document.body.style.overflow = "";
  if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
}

function saveDraft() {
  const draft = {
    pickup,
    drop,
    pickupLabel: pickupInput.value.trim(),
    dropLabel: dropInput.value.trim(),
    vehicleType,
    offer: Number(offerInput.value),
    savedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    showToast("Ride plan saved on this device.", { tone: "success" });
    closePreview();
  } catch {
    showToast("Your browser blocked local storage, so the draft was not saved.", {
      tone: "error",
    });
  }
}

async function requestRide() {
  if (!currentEstimate || !pickup || !drop) return;
  const offer = Number(offerInput.value);
  if (!Number.isFinite(offer) || offer < 20) {
    showToast("Enter an offer of at least Rs 20.", { tone: "error" });
    return;
  }

  setBusy(requestRideButton, true, "Sending request…");
  try {
    const result = await api.post("/rides", {
      pickup: { lat: pickup.lat, lng: pickup.lng, label: pickupInput.value.trim() },
      drop: { lat: drop.lat, lng: drop.lng, label: dropInput.value.trim() },
      vehicleType,
      offeredPrice: offer,
    });
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
    window.location.assign(`/ride.html?ride=${encodeURIComponent(result.ride.id)}`);
  } catch (error) {
    const activeRideId = error?.details?.[0]?.rideId;
    if (error?.code === "RIDE_ALREADY_ACTIVE" && activeRideId) {
      window.location.assign(`/ride.html?ride=${encodeURIComponent(activeRideId)}`);
      return;
    }
    showToast(error?.message || "We could not send your ride request.", { tone: "error" });
  } finally {
    setBusy(requestRideButton, false);
  }
}

function restoreDraft() {
  let draft = null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) draft = JSON.parse(raw);
  } catch {
    return;
  }
  if (!draft || !draft.pickup || !draft.drop) return;

  pickup = { lat: Number(draft.pickup.lat), lng: Number(draft.pickup.lng), label: draft.pickupLabel || "" };
  drop = { lat: Number(draft.drop.lat), lng: Number(draft.drop.lng), label: draft.dropLabel || "" };
  pickupInput.value = draft.pickupLabel || "";
  dropInput.value = draft.dropLabel || "";

  const vehicle = $(`input[name="vehicleType"][value="${draft.vehicleType}"]`);
  if (vehicle) {
    vehicle.checked = true;
    vehicleType = draft.vehicleType;
  }

  drawRoute();
  refreshEstimate().then(() => {
    if (Number(draft.offer) >= 20) setOffer(draft.offer, { markTouched: true });
  });
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
  driverLayer = L.layerGroup().addTo(map);

  map.on("click", (event) => {
    updatePoint(activePoint, event.latlng.lat, event.latlng.lng, "", { reverse: true });
  });

  map.on("moveend", () => {
    window.clearTimeout(nearbyTimer);
    nearbyTimer = window.setTimeout(loadNearbyDrivers, 650);
  });

  new ResizeObserver(() => map.invalidateSize()).observe(mapEl);
}

function bindEvents() {
  $("#map-mode-note").closest(".map-toolbar").addEventListener("click", (event) => {
    const button = event.target.closest("[data-map-mode]");
    if (button) setActivePoint(button.dataset.mapMode);
  });

  $$(".route-field").forEach((field) => {
    field.addEventListener("click", () => setActivePoint(field.dataset.point));
  });

  $$("[data-search]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      searchPoint(button.dataset.search);
    });
  });

  for (const [input, point] of [
    [pickupInput, "pickup"],
    [dropInput, "drop"],
  ]) {
    input.addEventListener("focus", () => setActivePoint(point));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchPoint(point);
      }
    });
    // Typing an address and leaving the field should also set the coordinates.
    input.addEventListener("change", () => {
      const query = input.value.trim();
      if (!query) return;
      const current = point === "pickup" ? pickup : drop;
      if (current?.label && current.label === query) return;
      searchPoint(point);
    });
  }

  $("#use-location").addEventListener("click", useMyLocation);

  $$('input[name="vehicleType"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      vehicleType = input.value;
      refreshEstimate();
    });
  });

  offerInput.addEventListener("input", () => {
    offerTouched = true;
    updateOfferCopy();
    updateButtonState();
  });

  $("#offer-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-offset]");
    if (!chip || !currentEstimate) return;
    setOffer(currentEstimate.suggestedFare + Number(chip.dataset.offset), { markTouched: true });
  });

  previewButton.addEventListener("click", openPreview);
  $("#save-draft").addEventListener("click", saveDraft);
  requestRideButton.addEventListener("click", requestRide);
  $("#preview-close").addEventListener("click", closePreview);
  $$("[data-close-preview]").forEach((element) => element.addEventListener("click", closePreview));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !previewModal.hidden) closePreview();
  });
}

async function main() {
  user = await bootPage({ roles: ["rider"] });
  if (!user) return;

  if (!phaseReady()) {
    previewButton.disabled = true;
    $("#phase-note").textContent = "Ride requests unlock once your account is approved.";
    setStatus("Approval needed", "warning");
  }

  try {
    const active = await api.get("/rides/active");
    if (active.ride) {
      window.location.replace(`/ride.html?ride=${encodeURIComponent(active.ride.id)}`);
      return;
    }
  } catch {}

  initMap();
  bindEvents();
  restoreDraft();
  loadNearbyDrivers();
  updateOfferCopy();
  updateButtonState();

  requestAnimationFrame(() => {
    map.invalidateSize();
    updateMapReadout();
  });
}

main();
