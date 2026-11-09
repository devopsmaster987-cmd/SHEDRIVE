import { api, getToken, setToken } from "./api.js";

const $ = (selector, root = document) => root.querySelector(selector);

const ROLE_LABELS = {
  rider: "Rider",
  driver: "Driver",
  admin: "Admin",
};

const STATUS_LABELS = {
  approved: "Verified",
  pending: "Verification pending",
  pending_review: "Under review",
  rejected: "Not approved",
};

const EFFECTS_KEY = "shedrive:reduce-effects";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });
}

function initials(name) {
  return String(name || "S")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function nextParam() {
  return encodeURIComponent(`${location.pathname}${location.search}`);
}

function redirectToLogin() {
  location.replace(`/auth.html?mode=login&next=${nextParam()}`);
}

function showFatal(title, message, { label = "Back home", href = "/" } = {}) {
  const loader = $("#app-loading");
  const content = $("#app-content");
  const errorRoot = $("#app-error");

  if (loader) loader.hidden = true;
  if (content) content.hidden = true;
  if (!errorRoot) return;

  $("#app-error-title").textContent = title;
  $("#app-error-message").textContent = message;
  const action = $("#app-error-action");
  action.textContent = label;
  action.href = href;
  errorRoot.hidden = false;
}

function homeFor(user) {
  if (user.role === "driver") return "/driver.html";
  if (user.role === "rider") return "/book.html";
  if (user.role === "admin") return "/admin.html";
  return "/";
}

function navItemsFor(user) {
  if (user.role === "driver") {
    return [
      { href: "/driver.html", label: "Dashboard" },
      { href: "/driver-ride.html", label: "Active ride" },
      { href: "/history.html", label: "Trip history" },
      { href: "/profile.html", label: "Profile" },
    ];
  }
  if (user.role === "rider") {
    return [
      { href: "/book.html", label: "Book a ride" },
      { href: "/ride.html", label: "Current ride" },
      { href: "/history.html", label: "History & wallet" },
      { href: "/profile.html", label: "Profile" },
    ];
  }
  if (user.role === "admin") {
    return [
      { href: "/admin.html", label: "Overview" },
      { href: "/admin-review.html", label: "Verification" },
      { href: "/profile.html", label: "Profile" },
    ];
  }
  return [{ href: "/profile.html", label: "Profile" }];
}

function formatRelativeTime(value) {
  const timestamp = new Date(value || Date.now()).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function notificationIcon(type) {
  if (type === "sos" || type === "safety") return "!";
  if (type === "account") return "✓";
  if (type === "payment") return "Rs";
  if (type === "ride") return "↗";
  return "•";
}

function updateNotificationBadge(count) {
  const badge = $("#app-notif-badge");
  if (!badge) return;
  const unread = Number(count) || 0;
  badge.hidden = unread === 0;
  badge.textContent = unread > 9 ? "9+" : String(unread);
}

function renderNotificationPanel(items, unread) {
  const list = $("#app-notif-list");
  const empty = $("#app-notif-empty");
  const readAll = $("#app-notif-read-all");
  if (!list) return;

  updateNotificationBadge(unread);
  if (readAll) readAll.hidden = !unread;

  if (!items?.length) {
    list.replaceChildren();
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;
  list.innerHTML = items
    .map(
      (item) => `
        <button class="app-notif-item ${item.readStatus ? "" : "is-unread"}" type="button" data-notification-id="${escapeHtml(item.id)}">
          <span class="app-notif-icon is-${escapeHtml(item.type || "system")}" aria-hidden="true">${notificationIcon(item.type)}</span>
          <span class="app-notif-copy">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.message)}</span>
            <small>${escapeHtml(formatRelativeTime(item.createdAt))}${item.readStatus ? "" : " · New"}</small>
          </span>
        </button>
      `
    )
    .join("");
}

async function refreshNotificationCount() {
  const button = $("#app-notifications");
  if (!button) return;
  try {
    const result = await api.get("/notifications?limit=1");
    updateNotificationBadge(result.unread);
  } catch {
    // Notifications are supplementary and must not block navigation.
  }
}

async function openNotificationPanel() {
  const panel = $("#app-notification-panel");
  const button = $("#app-notifications");
  if (!panel || !button) return;

  panel.hidden = false;
  button.setAttribute("aria-expanded", "true");

  const list = $("#app-notif-list");
  if (list) list.innerHTML = '<div class="app-notif-loading">Checking for updates…</div>';

  try {
    const result = await api.get("/notifications?limit=20");
    renderNotificationPanel(result.notifications, result.unread);
  } catch {
    if (list) list.innerHTML = '<div class="app-notif-loading">Notifications are unavailable right now.</div>';
  }
}

function closeNotificationPanel() {
  const panel = $("#app-notification-panel");
  const button = $("#app-notifications");
  if (panel) panel.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function initNotifications() {
  const button = $("#app-notifications");
  const panel = $("#app-notification-panel");
  if (!button || !panel) return;

  refreshNotificationCount();
  const timer = window.setInterval(refreshNotificationCount, 45000);
  window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true });

  button.addEventListener("click", () => {
    if (panel.hidden) openNotificationPanel();
    else closeNotificationPanel();
  });

  $("#app-notif-read-all")?.addEventListener("click", async () => {
    try {
      await api.post("/notifications/read-all", {});
      await openNotificationPanel();
    } catch {
      showToast("We could not mark notifications as read.", { tone: "error" });
    }
  });

  $("#app-notif-list")?.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-notification-id]");
    if (!item) return;
    try {
      await api.patch(`/notifications/${item.dataset.notificationId}/read`, {});
      item.classList.remove("is-unread");
      const result = await api.get("/notifications?limit=1");
      updateNotificationBadge(result.unread);
    } catch {
      // A read receipt failure is not worth interrupting the page.
    }
  });

  document.addEventListener("click", (event) => {
    if (!panel.hidden && !event.target.closest(".app-notif-wrap")) closeNotificationPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      closeNotificationPanel();
      button.focus();
    }
  });
}

function applyEffects(reduce) {
  document.documentElement.classList.toggle("reduce-effects", reduce);
  const button = $("#app-effects");
  if (button) {
    button.setAttribute("aria-pressed", String(reduce));
    button.title = reduce ? "Enable visual effects" : "Reduce visual effects";
  }
}

function initEffects() {
  let reduce = false;
  try {
    const stored = localStorage.getItem(EFFECTS_KEY);
    reduce = stored === null
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : stored === "1";
  } catch {
    reduce = false;
  }

  applyEffects(reduce);
  $("#app-effects")?.addEventListener("click", () => {
    const next = !document.documentElement.classList.contains("reduce-effects");
    applyEffects(next);
    try {
      localStorage.setItem(EFFECTS_KEY, next ? "1" : "0");
    } catch {
      /* Preferences are optional. */
    }
  });
}

function renderShell(user) {
  const brand = $("#app-brand");
  if (brand) brand.href = homeFor(user);

  const links = $("#app-nav-links");
  if (links) {
    links.replaceChildren(
      ...navItemsFor(user).map((item) => {
        const anchor = document.createElement("a");
        anchor.href = item.href;
        anchor.textContent = item.label;
        if (location.pathname === item.href) anchor.setAttribute("aria-current", "page");
        return anchor;
      })
    );
  }

  const actions = $("#app-actions");
  if (actions) {
    actions.innerHTML = `
      <div class="app-user">
        <span class="app-avatar" aria-hidden="true">${escapeHtml(initials(user.name))}</span>
        <span class="app-user-copy">
          <strong>${escapeHtml(user.name)}</strong>
          <small>${ROLE_LABELS[user.role] || "Member"} · ${STATUS_LABELS[user.verificationStatus] || "Pending"}</small>
        </span>
      </div>
      <div class="app-notif-wrap">
        <button
          class="icon-btn app-notif-btn"
          id="app-notifications"
          type="button"
          aria-expanded="false"
          aria-controls="app-notification-panel"
          title="Notifications"
        >
          <span class="sr-only">Notifications</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7M10 20h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="app-notif-badge" id="app-notif-badge" hidden>0</span>
        </button>
        <div class="app-notif-panel glass-card" id="app-notification-panel" hidden>
          <div class="app-notif-head">
            <div>
              <p class="card-eyebrow">Inbox</p>
              <strong>Notifications</strong>
            </div>
            <button class="text-btn" id="app-notif-read-all" type="button" hidden>Mark all read</button>
          </div>
          <div class="app-notif-list" id="app-notif-list"></div>
          <div class="app-notif-empty" id="app-notif-empty" hidden>
            <span aria-hidden="true">✓</span>
            <strong>You are all caught up.</strong>
            <small>Safety updates and account messages appear here.</small>
          </div>
        </div>
      </div>
      <button
        class="icon-btn"
        id="app-effects"
        type="button"
        aria-pressed="false"
        title="Reduce visual effects"
      >
        <span class="sr-only">Reduce visual effects</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6" />
        </svg>
      </button>
      <button class="app-signout" id="app-signout" type="button">Sign out</button>
    `;
    initEffects();
    initNotifications();
    $("#app-signout")?.addEventListener("click", () => {
      setToken(null);
      location.replace("/");
    });
  }
}

function showStatusBanner(user) {
  const banner = $("#app-banner");
  if (!banner) return;

  if (user.verificationStatus === "rejected") {
    banner.className = "app-banner is-error";
    banner.innerHTML =
      "<strong>Your account is not approved for rides.</strong><span>Contact support so a person can help you resolve it.</span>";
    banner.hidden = false;
    return;
  }

  if (user.verificationStatus === "pending_review" || user.verificationStatus === "pending") {
    const driverCopy = user.role === "driver" ? " and driving licence" : "";
    banner.className = "app-banner";
    banner.innerHTML = `<strong>Your account is with our safety team.</strong><span>We are reviewing your selfie${driverCopy}. You can explore now; rides unlock after approval.</span>`;
    banner.hidden = false;
  }
}

export async function bootPage({ roles = [] } = {}) {
  if (!getToken()) {
    redirectToLogin();
    return null;
  }

  let user;
  try {
    const result = await api.get("/auth/me");
    user = result.user;
  } catch (error) {
    if (error?.status === 401 || error?.code === "ACCOUNT_UNAVAILABLE") {
      setToken(null);
      redirectToLogin();
      return null;
    }
    showFatal(
      "The city is out of reach",
      "We could not load your account. Check that the SheDrive API is running, then try again.",
      { label: "Try again", href: location.href }
    );
    return null;
  }

  if (roles.length && !roles.includes(user.role)) {
    showFatal(
      "This space is not yours",
      `That page is for ${roles.map((role) => ROLE_LABELS[role] || role).join(" or ")} accounts.`,
      { label: "Go to my home", href: homeFor(user) }
    );
    return null;
  }

  renderShell(user);
  showStatusBanner(user);
  document.documentElement.dataset.role = user.role;

  const loader = $("#app-loading");
  const content = $("#app-content");
  if (loader) loader.hidden = true;
  if (content) content.hidden = false;

  return user;
}

export function showToast(message, { tone = "info", timeout = 4200 } = {}) {
  let region = $("#app-toast");
  if (!region) {
    region = document.createElement("div");
    region.id = "app-toast";
    region.className = "app-toast";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }

  const toast = document.createElement("div");
  toast.className = `app-toast-item is-${tone}`;
  toast.textContent = message;
  region.append(toast);

  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 260);
  }, timeout);
}

export function setBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
  button.textContent = busy ? label : "";
  if (!busy) button.innerHTML = button.dataset.originalHtml;
}

export function formatCurrency(value) {
  return `Rs ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(
    Number(value) || 0
  )}`;
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || "Pending";
}

export { homeFor, initials };
