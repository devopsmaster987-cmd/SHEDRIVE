import * as THREE from "three";
import { api } from "./api.js";
import { bootPage, formatCurrency, setBusy, showToast, initials } from "./shell.js";
import { getSocket } from "./socket.js";

const $ = (selector, root = document) => root.querySelector(selector);

const STATUS_LABELS = {
  approved: "Verified",
  pending: "Pending",
  pending_review: "Under review",
  rejected: "Rejected",
};

const ROLE_LABELS = { rider: "Rider", driver: "Driver", admin: "Admin" };

const ANALYTICS_BARS = {
  riders: "#4ff0ff",
  drivers: "#ff2bd6",
  rides: "#8b7bff",
  completed: "#62ffb0",
  revenue: "#ffc857",
};

let user = null;
let stats = null;
let sosFilter = "open";
let sosAlerts = [];
let userItems = [];
let userTotal = 0;
let userPage = 1;
const userLimit = 8;
let accessTarget = null;
let resolveTarget = null;
let socket = null;
let analytics = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });
}

function timeAgo(value) {
  const timestamp = new Date(value || Date.now()).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function statusClass(status) {
  if (["approved", "completed", "resolved"].includes(status)) return "is-success";
  if (["rejected", "cancelled", "banned"].includes(status)) return "is-danger";
  if (["pending", "pending_review", "open", "searching"].includes(status)) return "is-warning";
  return "";
}

function metric(value) {
  return new Intl.NumberFormat("en-IN").format(Number(value) || 0);
}

function closeModal(modal) {
  if (!modal) return;
  modal.hidden = true;
  if ($("#admin-access-modal").hidden && $("#sos-resolve-modal").hidden) {
    document.body.style.overflow = "";
  }
}

function openModal(modal) {
  if (!modal) return;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  modal.querySelector("button, input, textarea")?.focus();
}

function renderStats() {
  if (!stats) return;
  $("#stat-sos").textContent = metric(stats.openSos);
  $("#stat-sos-copy").textContent = stats.openSos ? "Needs attention now" : "No open alerts";
  $("#stat-active-rides").textContent = metric(stats.activeRides);
  $("#stat-rides-copy").textContent = `${metric(stats.completedRides)} completed all time`;
  $("#stat-online-drivers").textContent = metric(stats.onlineDrivers);
  $("#stat-driver-copy").textContent = `${metric(stats.drivers)} drivers registered`;
  $("#stat-pending-reviews").textContent = metric(stats.pendingReviews);
  $("#stat-review-copy").textContent = stats.pendingReviews ? "Identity queue waiting" : "Identity queue clear";
  $("#stat-pending-docs").textContent = metric(stats.pendingDocs);
  $("#stat-doc-copy").textContent = stats.pendingDocs ? "Licence documents waiting" : "Licences clear";
  $("#stat-revenue").textContent = formatCurrency(stats.revenue);
  $("#stat-user-copy").textContent = `${metric(stats.users)} accounts · ${metric(stats.bannedUsers)} suspended`;

  const completion = stats.rides ? Math.round((stats.completedRides / stats.rides) * 100) : 0;
  $("#analytics-completion").textContent = `${completion}%`;
  $("#analytics-banned").textContent = metric(stats.bannedUsers);
  $("#analytics-users").textContent = metric(stats.users);
  $("#analytics-pill").textContent = `${metric(stats.activeRides)} active · ${metric(stats.onlineDrivers)} online`;

  const sosBadge = $("#sos-count-badge");
  sosBadge.textContent = `${metric(stats.openSos)} open`;
  sosBadge.classList.toggle("is-warning", stats.openSos > 0);
  sosBadge.classList.toggle("is-success", stats.openSos === 0);

  analytics?.update(stats);
}

function sosLocationText(alert) {
  if (!alert.location) return "Location not shared";
  return `${Number(alert.location.lat).toFixed(4)}, ${Number(alert.location.lng).toFixed(4)}`;
}

function sosCard(alert) {
  const article = document.createElement("article");
  article.className = `admin-sos-item ${alert.status === "open" ? "is-urgent" : ""}`;
  article.dataset.sosId = alert.id;

  const head = document.createElement("div");
  head.className = "admin-sos-item-head";
  const name = document.createElement("strong");
  name.textContent = alert.user?.name || "SheDrive member";
  const status = document.createElement("span");
  status.className = `status-badge ${statusClass(alert.status)}`;
  status.textContent =
    alert.status === "acknowledged" ? "With safety desk" : alert.status === "resolved" ? "Resolved" : "Open";
  head.append(name, status);

  const meta = document.createElement("div");
  meta.className = "admin-sos-meta";
  meta.innerHTML = `
    <span>${escapeHtml(ROLE_LABELS[alert.user?.role] || "Member")}</span>
    <span>${escapeHtml(alert.user?.phone || "No phone")}</span>
    <span>${escapeHtml(timeAgo(alert.raisedAt || alert.createdAt))}</span>
  `;

  const ride = document.createElement("div");
  ride.className = "admin-sos-route";
  if (alert.ride) {
    ride.innerHTML = `
      <span><i aria-hidden="true"></i>${escapeHtml(alert.ride.pickupLabel || "Pickup")}</span>
      <span><i aria-hidden="true"></i>${escapeHtml(alert.ride.dropLabel || "Drop")}</span>
    `;
  } else {
    ride.textContent = "Ride details unavailable.";
  }

  const facts = document.createElement("div");
  facts.className = "admin-sos-facts";
  facts.innerHTML = `
    <span>Ride #${escapeHtml(String(alert.ride?.id || "—").slice(-6).toUpperCase())}</span>
    <span>Contacts: ${metric(alert.contactsNotified)}</span>
    <span>${escapeHtml(sosLocationText(alert))}</span>
  `;

  const message = document.createElement("p");
  message.className = "admin-sos-message";
  message.textContent = alert.message || alert.note || "No note attached.";

  const actions = document.createElement("div");
  actions.className = "admin-sos-actions";
  if (alert.location) {
    const map = document.createElement("a");
    map.className = "btn btn-ghost btn-sm";
    map.href = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(alert.location.lat)}&mlon=${encodeURIComponent(alert.location.lng)}#map=17/${encodeURIComponent(alert.location.lat)}/${encodeURIComponent(alert.location.lng)}`;
    map.target = "_blank";
    map.rel = "noopener noreferrer";
    map.textContent = "Open map";
    actions.append(map);
  }
  if (alert.status === "open") {
    const acknowledge = document.createElement("button");
    acknowledge.type = "button";
    acknowledge.className = "btn btn-primary btn-sm";
    acknowledge.textContent = "Acknowledge";
    acknowledge.dataset.sosAction = "acknowledge";
    actions.append(acknowledge);
  }
  if (alert.status !== "resolved") {
    const resolve = document.createElement("button");
    resolve.type = "button";
    resolve.className = "btn btn-danger btn-sm";
    resolve.textContent = "Resolve";
    resolve.dataset.sosAction = "resolve";
    actions.append(resolve);
  }

  article.append(head, meta, ride, facts, message, actions);
  return article;
}

function renderSos() {
  const list = $("#admin-sos-list");
  if (!list) return;
  list.replaceChildren();

  if (!sosAlerts.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty";
    empty.innerHTML = `
      <span aria-hidden="true">✓</span>
      <strong>No ${sosFilter === "all" ? "" : sosFilter} SOS alerts.</strong>
      <small>New alerts appear here instantly while you work.</small>
    `;
    list.append(empty);
    return;
  }

  sosAlerts.forEach((alert) => list.append(sosCard(alert)));
}

async function loadSos() {
  try {
    const result = await api.get(`/admin/sos-alerts?status=${encodeURIComponent(sosFilter)}&limit=20`);
    sosAlerts = result.alerts || [];
    renderSos();
  } catch (error) {
    showToast(error?.message || "Could not load the SOS queue.", { tone: "error" });
  }
}

async function loadStats() {
  try {
    const result = await api.get("/admin/stats");
    stats = result.stats;
    renderStats();
    renderRecentRides(result.recentRides || []);
    return result;
  } catch (error) {
    showToast(error?.message || "Could not load city statistics.", { tone: "error" });
    return null;
  }
}

function renderRecentRides(rides) {
  const list = $("#admin-recent-list");
  if (!list) return;
  if (!rides.length) {
    list.innerHTML = '<div class="admin-empty"><strong>No rides yet.</strong><small>New ride requests will appear here.</small></div>';
    return;
  }

  list.innerHTML = rides
    .map(
      (ride) => `
        <article class="admin-ride-row">
          <div class="admin-ride-person">
            <span class="app-avatar" aria-hidden="true">${escapeHtml(initials(ride.rider?.name || "Rider"))}</span>
            <div>
              <strong>${escapeHtml(ride.rider?.name || "Rider")}</strong>
              <small>${escapeHtml(ride.pickupLabel || "Pickup")} → ${escapeHtml(ride.dropLabel || "Drop")}</small>
            </div>
          </div>
          <span class="admin-ride-driver">${escapeHtml(ride.driver?.name || "Unassigned")}</span>
          <span class="status-badge ${statusClass(ride.status)}">${escapeHtml(ride.status.replace(/_/g, " "))}</span>
          <strong>${formatCurrency(ride.finalPrice)}</strong>
          <small>${escapeHtml(timeAgo(ride.createdAt))}</small>
        </article>
      `
    )
    .join("");
}

function userCard(account) {
  const article = document.createElement("article");
  article.className = "admin-user-item";
  const isSelf = String(account.id) === String(user.id);
  const isAdmin = account.role === "admin";

  const person = document.createElement("div");
  person.className = "admin-user-person";
  person.innerHTML = `
    <span class="app-avatar" aria-hidden="true">${escapeHtml(initials(account.name))}</span>
    <div>
      <strong>${escapeHtml(account.name)}${isSelf ? " (you)" : ""}</strong>
      <small>${escapeHtml(account.email)}</small>
      <span>${escapeHtml(account.phone || "No phone")}</span>
    </div>
  `;

  const badges = document.createElement("div");
  badges.className = "admin-user-badges";
  const role = document.createElement("span");
  role.className = "pill pill-soft";
  role.textContent = ROLE_LABELS[account.role] || account.role;
  const verification = document.createElement("span");
  verification.className = `status-badge ${statusClass(account.verificationStatus)}`;
  verification.textContent = STATUS_LABELS[account.verificationStatus] || "Pending";
  badges.append(role, verification);
  if (account.isBanned) {
    const banned = document.createElement("span");
    banned.className = "status-badge is-danger";
    banned.textContent = "Suspended";
    badges.append(banned);
  }

  const details = document.createElement("div");
  details.className = "admin-user-detail";
  const driver = account.driver;
  details.innerHTML = `
    <span>Wallet <strong>${formatCurrency(account.walletBalance)}</strong></span>
    ${
      driver
        ? `<span>${escapeHtml(driver.vehicleType || "Vehicle")} · ${escapeHtml(driver.plateNumber || "—")}</span>
           <span>Licence <strong>${escapeHtml(STATUS_LABELS[driver.licenseDocStatus] || driver.licenseDocStatus || "Pending")}</strong></span>
           <span>${driver.isOnline ? "Online now" : "Offline"}</span>`
        : `<span>Joined ${escapeHtml(new Date(account.createdAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" }))}</span>`
    }
  `;

  const actions = document.createElement("div");
  actions.className = "admin-user-actions";
  const reason = document.createElement("small");
  reason.textContent = account.isBanned && account.moderationReason ? account.moderationReason : "";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = `btn btn-sm ${account.isBanned ? "btn-primary" : "btn-danger"}`;
  toggle.textContent = account.isBanned ? "Restore access" : "Suspend";
  toggle.disabled = isSelf || isAdmin;
  if (isSelf) toggle.title = "You cannot change your own access.";
  else if (isAdmin) toggle.title = "Admin accounts are protected.";
  toggle.dataset.userAction = account.isBanned ? "restore" : "suspend";
  toggle.dataset.userId = account.id;
  actions.append(reason, toggle);

  article.append(person, badges, details, actions);
  return article;
}

function renderUsers() {
  const list = $("#admin-user-list");
  if (!list) return;
  list.replaceChildren();

  if (!userItems.length) {
    list.innerHTML = '<div class="admin-empty"><strong>No accounts match.</strong><small>Try a different role, status or search.</small></div>';
  } else {
    userItems.forEach((account) => list.append(userCard(account)));
  }

  const pagination = $("#admin-user-pagination");
  const pages = Math.max(1, Math.ceil(userTotal / userLimit));
  pagination.hidden = pages <= 1;
  $("#admin-users-page").textContent = `Page ${userPage} of ${pages}`;
  $("#admin-users-prev").disabled = userPage <= 1;
  $("#admin-users-next").disabled = userPage >= pages;
}

async function loadUsers() {
  const params = new URLSearchParams({
    role: $("#admin-user-role").value,
    status: $("#admin-user-status").value,
    search: $("#admin-user-search").value.trim(),
    page: String(userPage),
    limit: String(userLimit),
  });

  try {
    const result = await api.get(`/admin/users?${params}`);
    userItems = result.items || [];
    userTotal = Number(result.total) || 0;
    renderUsers();
  } catch (error) {
    showToast(error?.message || "Could not load accounts.", { tone: "error" });
  }
}

function openAccessDialog(account, action) {
  accessTarget = { account, banned: action === "suspend" };
  const banned = accessTarget.banned;
  $("#admin-access-eyebrow").textContent = banned ? "Safety action" : "Restore access";
  $("#admin-access-title").textContent = banned ? `Suspend ${account.name}?` : `Restore ${account.name}?`;
  $("#admin-access-copy").textContent = banned
    ? "They will be signed out of ride actions immediately. The reason is shared with the member."
    : "Their SheDrive access will be restored and they can ride again.";
  $("#admin-access-reason").value = banned ? account.moderationReason || "" : "";
  $("#admin-access-reason").placeholder = banned
    ? "Explain the safety concern for the audit trail."
    : "Optional context for the audit trail.";
  const confirm = $("#admin-access-confirm");
  confirm.className = `btn ${banned ? "btn-danger" : "btn-primary"}`;
  confirm.textContent = banned ? "Suspend account" : "Restore access";
  openModal($("#admin-access-modal"));
}

async function submitAccessChange() {
  if (!accessTarget) return;
  const button = $("#admin-access-confirm");
  const { account, banned } = accessTarget;
  setBusy(button, true, banned ? "Suspending…" : "Restoring…");

  try {
    await api.patch(`/admin/users/${account.id}/access`, {
      banned,
      reason: $("#admin-access-reason").value.trim(),
    });
    closeModal($("#admin-access-modal"));
    accessTarget = null;
    showToast(banned ? `${account.name}'s access is suspended.` : `${account.name}'s access is restored.`, {
      tone: "success",
    });
    await Promise.all([loadUsers(), loadStats()]);
  } catch (error) {
    showToast(error?.message || "Could not update this account.", { tone: "error" });
  } finally {
    setBusy(button, false);
  }
}

function openResolveDialog(id) {
  resolveTarget = id;
  $("#sos-resolve-note").value = "";
  openModal($("#sos-resolve-modal"));
}

async function acknowledgeSos(id, button) {
  setBusy(button, true, "Acknowledging…");
  try {
    await api.patch(`/admin/sos-alerts/${id}`, { status: "acknowledged", note: "" });
    showToast("Safety desk acknowledged the SOS.", { tone: "success" });
    await Promise.all([loadSos(), loadStats()]);
  } catch (error) {
    showToast(error?.message || "Could not acknowledge this SOS.", { tone: "error" });
  } finally {
    setBusy(button, false);
  }
}

async function resolveSos() {
  if (!resolveTarget) return;
  const button = $("#sos-resolve-confirm");
  setBusy(button, true, "Resolving…");
  try {
    await api.patch(`/admin/sos-alerts/${resolveTarget}`, {
      status: "resolved",
      note: $("#sos-resolve-note").value.trim(),
    });
    closeModal($("#sos-resolve-modal"));
    resolveTarget = null;
    showToast("SOS marked resolved. The member has been notified.", { tone: "success" });
    await Promise.all([loadSos(), loadStats()]);
  } catch (error) {
    showToast(error?.message || "Could not resolve this SOS.", { tone: "error" });
  } finally {
    setBusy(button, false);
  }
}

function bindEvents() {
  $("#admin-refresh")?.addEventListener("click", async () => {
    const button = $("#admin-refresh");
    setBusy(button, true, "Refreshing…");
    await Promise.all([loadStats(), loadSos(), loadUsers()]);
    setBusy(button, false);
    showToast("Command centre refreshed.", { tone: "info" });
  });

  $("#admin-user-filters")?.addEventListener("submit", (event) => {
    event.preventDefault();
    userPage = 1;
    loadUsers();
  });

  $("#admin-users-prev")?.addEventListener("click", () => {
    if (userPage <= 1) return;
    userPage -= 1;
    loadUsers();
  });

  $("#admin-users-next")?.addEventListener("click", () => {
    if (userPage * userLimit >= userTotal) return;
    userPage += 1;
    loadUsers();
  });

  $("#admin-user-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-user-action]");
    if (!button) return;
    const account = userItems.find((item) => item.id === button.dataset.userId);
    if (account) openAccessDialog(account, button.dataset.userAction);
  });

  $("#admin-sos-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sos-action]");
    if (!button) return;
    const article = button.closest("[data-sos-id]");
    if (!article) return;
    if (button.dataset.sosAction === "acknowledge") acknowledgeSos(article.dataset.sosId, button);
    else openResolveDialog(article.dataset.sosId);
  });

  document.querySelectorAll("[data-sos-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      sosFilter = button.dataset.sosFilter;
      document.querySelectorAll("[data-sos-filter]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      loadSos();
    });
  });

  $("#admin-access-confirm")?.addEventListener("click", submitAccessChange);
  $("#sos-resolve-confirm")?.addEventListener("click", resolveSos);
  document.querySelectorAll("[data-close-access]").forEach((element) => {
    element.addEventListener("click", () => closeModal($("#admin-access-modal")));
  });
  document.querySelectorAll("[data-close-resolve]").forEach((element) => {
    element.addEventListener("click", () => closeModal($("#sos-resolve-modal")));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeModal($("#admin-access-modal"));
    closeModal($("#sos-resolve-modal"));
  });
}

function bindRealtime() {
  socket = getSocket();
  if (!socket) return;

  socket.on("sos:triggered", (payload) => {
    const alert = payload?.alert;
    if (!alert) return;
    showToast(`SOS from ${alert.user?.name || "a member"} needs attention.`, { tone: "error", timeout: 8000 });
    const strip = $("#admin-live-strip");
    $("#admin-live-title").textContent = "New SOS received.";
    $("#admin-live-copy").textContent = `${alert.user?.name || "A member"} is waiting for the safety desk.`;
    strip.hidden = false;
    loadStats();
    if (sosFilter === "open" || sosFilter === "all") loadSos();
  });

  socket.on("sos:updated", () => {
    loadStats();
    loadSos();
  });
}

function createAnalytics(canvas) {
  if (!canvas) return null;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    canvas.parentElement?.classList.add("is-fallback");
    return null;
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05030f, 0.045);
  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
  camera.position.set(6, 5.4, 6.8);
  camera.lookAt(0, 1.7, 0);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const group = new THREE.Group();
  group.rotation.y = -0.35;
  scene.add(group);

  const floor = new THREE.GridHelper(12, 24, 0x2b2a55, 0x14132b);
  floor.position.y = -0.03;
  group.add(floor);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(4.6, 4.68, 96),
    new THREE.MeshBasicMaterial({ color: 0x4ff0ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  group.add(ring);

  const barMeshes = {};
  const materials = {};
  Object.entries(ANALYTICS_BARS).forEach(([key, color], index) => {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.35,
      metalness: 0.35,
      roughness: 0.3,
      transparent: true,
      opacity: 0.92,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1, 0.62), material);
    mesh.position.set((index - 2) * 1.7, 0.5, 0);
    group.add(mesh);
    barMeshes[key] = mesh;
    materials[key] = material;

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.035, 0.7),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
    );
    cap.position.y = 0.5;
    mesh.add(cap);
  });

  const ambient = new THREE.AmbientLight(0x8b7bff, 1.1);
  scene.add(ambient);
  const key = new THREE.PointLight(0x4ff0ff, 18, 18);
  key.position.set(4, 7, 5);
  scene.add(key);
  const rim = new THREE.PointLight(0xff2bd6, 14, 16);
  rim.position.set(-5, 4, -4);
  scene.add(rim);

  const targets = { riders: 1, drivers: 1, rides: 1, completed: 1, revenue: 1 };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;
  let raf = 0;

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    renderer.setSize(bounds.width, bounds.height, false);
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  function draw() {
    raf = window.requestAnimationFrame(draw);
    frame += 1;

    Object.entries(barMeshes).forEach(([name, mesh], index) => {
      const target = targets[name];
      mesh.scale.y += (target - mesh.scale.y) * 0.075;
      mesh.position.y = mesh.scale.y / 2;
      if (!reduce) {
        mesh.position.z = Math.sin(frame * 0.012 + index) * 0.09;
        mesh.material.emissiveIntensity = 0.28 + Math.sin(frame * 0.02 + index) * 0.12;
      }
    });

    if (!reduce) {
      group.rotation.y = -0.35 + Math.sin(frame * 0.0032) * 0.28;
      camera.position.y = 5.4 + Math.sin(frame * 0.0028) * 0.22;
      camera.lookAt(0, 1.7, 0);
    }

    renderer.render(scene, camera);
    if (reduce && frame > 2) window.cancelAnimationFrame(raf);
  }

  draw();

  return {
    update(next) {
      if (!next) return;
      const values = {
        riders: next.riders,
        drivers: next.drivers,
        rides: next.rides,
        completed: next.completedRides,
        revenue: Math.log10(Number(next.revenue) + 10) * 1.4,
      };
      const maximum = Math.max(...Object.values(values).map((value) => Number(value) || 0), 1);
      Object.entries(values).forEach(([key, value]) => {
        targets[key] = 0.65 + (Number(value) / maximum) * 4.2;
      });
    },
    dispose() {
      observer.disconnect();
      window.cancelAnimationFrame(raf);
      renderer.dispose();
    },
  };
}

async function boot() {
  user = await bootPage({ roles: ["admin"] });
  if (!user) return;

  analytics = createAnalytics($("#admin-analytics"));
  bindEvents();
  bindRealtime();

  await Promise.allSettled([loadStats(), loadSos(), loadUsers()]);
}

document.addEventListener("DOMContentLoaded", boot);
window.addEventListener("pagehide", () => analytics?.dispose(), { once: true });
