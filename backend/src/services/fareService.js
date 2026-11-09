const config = require("../config/env");

// Single source of truth for SheDrive fares (Pakistan, PKR).
// Change a rate here and both the API and the rider UI update together.
const VEHICLE_RATES = {
  Bike: { base: 40, perKm: 22, perMin: 2, minimum: 100, averageSpeedKmh: 30 },
  Auto: { base: 60, perKm: 30, perMin: 2.5, minimum: 150, averageSpeedKmh: 22 },
  Car: { base: 80, perKm: 40, perMin: 3, minimum: 200, averageSpeedKmh: 25 },
};

const EARTH_RADIUS_KM = 6371;
const ROAD_FACTOR_FALLBACK = 1.3;
const ROUTE_TIMEOUT_MS = 4000;
const OSRM_BASE_URL = "https://router.project-osrm.org/route/v1/driving";

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineKm(from, to) {
  const latDelta = toRadians(to.lat - from.lat);
  const lngDelta = toRadians(to.lng - from.lng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(lngDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function roundToNearestTen(value) {
  return Math.round(value / 10) * 10;
}

// Ask OSRM for the real road distance. Returns null on any failure so the
// caller can fall back to the straight-line estimate.
async function fetchRoadDistanceKm(pickup, drop) {
  const coordinates = `${pickup.lng},${pickup.lat};${drop.lng},${drop.lat}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);

  try {
    const response = await fetch(`${OSRM_BASE_URL}/${coordinates}?overview=false`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const route = payload?.routes?.[0];
    if (!route || !Number.isFinite(route.distance)) return null;

    return route.distance / 1000;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function estimateFare({ pickup, drop, vehicleType = "Car" }) {
  const rates = VEHICLE_RATES[vehicleType] || VEHICLE_RATES.Car;
  const straightLineKm = haversineKm(pickup, drop);

  let distanceKm = null;
  let distanceSource = "haversine";

  // Tests stay offline and fast; production/dev try the real routing service.
  if (config.nodeEnv !== "test") {
    const roadDistanceKm = await fetchRoadDistanceKm(pickup, drop);
    if (roadDistanceKm) {
      distanceKm = Math.max(0.1, round1(roadDistanceKm));
      distanceSource = "osrm";
    }
  }

  if (distanceKm === null) {
    distanceKm = Math.max(0.1, round1(straightLineKm * ROAD_FACTOR_FALLBACK));
  }

  const durationMinutes = Math.max(
    3,
    Math.round((distanceKm / rates.averageSpeedKmh) * 60) + 2
  );

  const rawFare =
    rates.base + distanceKm * rates.perKm + durationMinutes * rates.perMin;
  const suggestedFare = Math.max(rates.minimum, roundToNearestTen(rawFare));

  return {
    vehicleType,
    distanceKm,
    straightLineKm: round2(straightLineKm),
    durationMinutes,
    suggestedFare,
    currency: "PKR",
    currencySymbol: "Rs",
    distanceSource,
  };
}

module.exports = {
  estimateFare,
  haversineKm,
  fetchRoadDistanceKm,
  VEHICLE_RATES,
  ROAD_FACTOR_FALLBACK,
};
