import { api, getToken } from "./api.js";
import { bootPage, setBusy, showToast, initials } from "./shell.js";

const $ = (selector, root = document) => root.querySelector(selector);

const STATUS_LABELS = {
  approved: "Approved",
  pending: "Pending",
  rejected: "Rejected",
};

let user = null;
let reviewFilter = "pending";
let docFilter = "pending";
let reviewItems = [];
let docItems = [];
let reviewTarget = null;
const objectUrls = [];

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
  if (status === "approved") return "is-success";
  if (status === "rejected") return "is-danger";
  return "is-warning";
}

function docName(url) {
  const value = String(url || "");
  return value.slice(value.lastIndexOf("/") + 1) || "document";
}

function isPdf(url) {
  return /\.pdf($|\?)/i.test(String(url || ""));
}

function openModal(modal) {
  if (!modal) return;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  modal.querySelector("button, textarea")?.focus();
}

function closeReviewModal() {
  const modal = $("#review-action-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = "";
  reviewTarget = null;
}

async function hydrateDocuments(root = document) {
  const nodes = [...root.querySelectorAll("[data-doc-url]")].filter(
    (node) => !node.dataset.docLoaded && !node.dataset.docLoading
  );

  await Promise.all(
    nodes.map(async (node) => {
      const url = node.dataset.docUrl;
      if (!url) return;
      node.dataset.docLoading = "true";
      try {
        const token = getToken();
        const response = await fetch(url, {
          credentials: "same-origin",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error("Document unavailable");
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);

        if (node.tagName === "IMG") node.src = objectUrl;
        node.dataset.docLoaded = "true";
        const link = node.closest("a");
        if (link) link.href = objectUrl;
      } catch {
        node.dataset.docLoaded = "error";
        const link = node.closest("a");
        if (link) {
          link.removeAttribute("href");
          link.setAttribute("aria-disabled", "true");
        }
        node.alt = "Document unavailable";
      } finally {
        delete node.dataset.docLoading;
      }
    })
  );
}

function reviewCard(item) {
  const id = item._id || item.id;
  const person = item.user || {};
  const confidence = Math.round((Number(item.faceConfidenceScore) || 0) * 100);
  const docs = (item.submittedDocs || []).filter(Boolean);
  const article = document.createElement("article");
  article.className = "review-card glass-card";
  article.dataset.reviewId = id;

  const head = document.createElement("div");
  head.className = "review-card-head";
  head.innerHTML = `
    <div class="review-person">
      <span class="app-avatar" aria-hidden="true">${escapeHtml(initials(person.name))}</span>
      <div>
        <strong>${escapeHtml(person.name || "SheDrive member")}</strong>
        <small>${escapeHtml(person.email || "No email")} · ${escapeHtml(person.phone || "No phone")}</small>
      </div>
    </div>
    <span class="status-badge ${statusClass(item.status)}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>
  `;

  const facts = document.createElement("div");
  facts.className = "review-facts";
  facts.innerHTML = `
    <div><span>Role</span><strong>${escapeHtml(person.role || "—")}</strong></div>
    <div><span>Face confidence</span><strong>${confidence}%</strong></div>
    <div><span>Prediction</span><strong>${escapeHtml(item.facePrediction || "unknown")}</strong></div>
    <div><span>Signal</span><strong>${escapeHtml((item.faceDecision || "needs_review").replace(/_/g, " "))}</strong></div>
  `;

  const note = document.createElement("p");
  note.className = "review-note";
  note.textContent = item.note || "No reviewer note has been added yet.";

  const footer = document.createElement("div");
  footer.className = "review-card-foot";
  const submitted = document.createElement("small");
  submitted.textContent = `Submitted ${timeAgo(item.createdAt)}`;

  const actions = document.createElement("div");
  actions.className = "review-actions";

  if (docs.length) {
    docs.forEach((url) => {
      const link = document.createElement("a");
      link.className = "btn btn-ghost btn-sm";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `Open ${docName(url)}`;
      if (isPdf(url)) {
        link.href = "#";
      } else {
        link.href = "#";
        link.innerHTML = `<span class="review-doc-thumb"><img data-doc-url="${escapeHtml(url)}" alt="Submitted document" /></span>Open ${escapeHtml(docName(url))}`;
      }
      if (isPdf(url)) link.dataset.docUrl = url;
      actions.append(link);
    });
  }

  if (item.status === "pending") {
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "btn btn-danger btn-sm";
    reject.textContent = "Reject";
    reject.dataset.reviewAction = "rejected";
    reject.dataset.reviewKind = "identity";

    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "btn btn-primary btn-sm";
    approve.textContent = "Approve";
    approve.dataset.reviewAction = "approved";
    approve.dataset.reviewKind = "identity";
    actions.append(reject, approve);
  }

  footer.append(submitted, actions);
  article.append(head, facts, note, footer);
  return article;
}

function docCard(item) {
  const article = document.createElement("article");
  article.className = "review-card doc-card glass-card";
  article.dataset.docId = item.id;

  const driver = item.user || {};
  const head = document.createElement("div");
  head.className = "review-card-head";
  head.innerHTML = `
    <div class="review-person">
      <span class="app-avatar" aria-hidden="true">${escapeHtml(initials(driver.name))}</span>
      <div>
        <strong>${escapeHtml(driver.name || "SheDrive driver")}</strong>
        <small>${escapeHtml(driver.email || "No email")} · ${escapeHtml(driver.phone || "No phone")}</small>
      </div>
    </div>
    <span class="status-badge ${statusClass(item.licenseDocStatus)}">${escapeHtml(STATUS_LABELS[item.licenseDocStatus] || item.licenseDocStatus)}</span>
  `;

  const preview = document.createElement("div");
  preview.className = "doc-preview";
  if (item.licenseDocUrl && !isPdf(item.licenseDocUrl)) {
    preview.innerHTML = `
      <a href="#" target="_blank" rel="noopener noreferrer" aria-label="Open full licence document">
        <img data-doc-url="${escapeHtml(item.licenseDocUrl)}" alt="Driving licence for ${escapeHtml(driver.name || "driver")}" />
      </a>
    `;
  } else {
    preview.innerHTML = `
      <a class="doc-file" href="#" data-doc-url="${escapeHtml(item.licenseDocUrl || "")}" target="_blank" rel="noopener noreferrer">
        <span aria-hidden="true">PDF</span>
        <strong>${escapeHtml(docName(item.licenseDocUrl))}</strong>
        <small>Open the licence document</small>
      </a>
    `;
  }

  const facts = document.createElement("div");
  facts.className = "review-facts";
  facts.innerHTML = `
    <div><span>Vehicle</span><strong>${escapeHtml(item.vehicleType || "—")}</strong></div>
    <div><span>Plate</span><strong>${escapeHtml(item.plateNumber || "—")}</strong></div>
    <div><span>Account</span><strong>${escapeHtml(driver.verificationStatus || "—")}</strong></div>
    <div><span>Submitted</span><strong>${escapeHtml(timeAgo(item.createdAt))}</strong></div>
  `;

  const note = document.createElement("p");
  note.className = "review-note";
  note.textContent = item.licenseDocNote || "No reviewer note has been added yet.";

  const footer = document.createElement("div");
  footer.className = "review-card-foot";
  const reviewed = document.createElement("small");
  reviewed.textContent = item.licenseDocReviewedAt
    ? `Reviewed ${timeAgo(item.licenseDocReviewedAt)}`
    : "Awaiting licence review";

  const actions = document.createElement("div");
  actions.className = "review-actions";
  if (item.licenseDocStatus === "pending") {
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "btn btn-danger btn-sm";
    reject.textContent = "Reject";
    reject.dataset.reviewAction = "rejected";
    reject.dataset.reviewKind = "document";

    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "btn btn-primary btn-sm";
    approve.textContent = "Approve licence";
    approve.dataset.reviewAction = "approved";
    approve.dataset.reviewKind = "document";
    actions.append(reject, approve);
  }

  footer.append(reviewed, actions);
  article.append(head, preview, facts, note, footer);
  return article;
}

function renderReviews() {
  const list = $("#review-list");
  if (!list) return;
  list.replaceChildren();

  if (!reviewItems.length) {
    list.innerHTML = `
      <div class="admin-empty">
        <span aria-hidden="true">✓</span>
        <strong>No ${reviewFilter === "all" ? "" : reviewFilter} identity reviews.</strong>
        <small>New accounts that need a human appear here.</small>
      </div>
    `;
    return;
  }

  reviewItems.forEach((item) => list.append(reviewCard(item)));
  hydrateDocuments(list);
}

function renderDocs() {
  const list = $("#doc-list");
  if (!list) return;
  list.replaceChildren();

  if (!docItems.length) {
    list.innerHTML = `
      <div class="admin-empty">
        <span aria-hidden="true">✓</span>
        <strong>No ${docFilter === "all" ? "" : docFilter} licence reviews.</strong>
        <small>Driver documents that need a human appear here.</small>
      </div>
    `;
    return;
  }

  docItems.forEach((item) => list.append(docCard(item)));
  hydrateDocuments(list);
}

async function loadReviews() {
  try {
    const result = await api.get(`/admin/review-queue?status=${reviewFilter}&limit=50`);
    reviewItems = result.items || [];
    renderReviews();
  } catch (error) {
    showToast(error?.message || "Could not load identity reviews.", { tone: "error" });
  }
}

async function loadDocs() {
  try {
    const result = await api.get(`/admin/driver-documents?status=${docFilter}&limit=50`);
    docItems = result.items || [];
    renderDocs();
  } catch (error) {
    showToast(error?.message || "Could not load licence documents.", { tone: "error" });
  }
}

async function loadCounts() {
  try {
    const [stats, approvedReviews, rejectedReviews, approvedDocs, rejectedDocs] = await Promise.all([
      api.get("/admin/stats"),
      api.get("/admin/review-queue?status=approved&limit=1"),
      api.get("/admin/review-queue?status=rejected&limit=1"),
      api.get("/admin/driver-documents?status=approved&limit=1"),
      api.get("/admin/driver-documents?status=rejected&limit=1"),
    ]);

    const summary = stats.stats || stats;
    const approved = Number(approvedReviews.total || 0) + Number(approvedDocs.total || 0);
    const rejected = Number(rejectedReviews.total || 0) + Number(rejectedDocs.total || 0);
    $("#review-stat-pending").textContent = String(summary.pendingReviews || 0);
    $("#review-stat-docs").textContent = String(summary.pendingDocs || 0);
    $("#review-stat-approved").textContent = String(approved);
    $("#review-stat-decided").textContent = String(approved + rejected);
  } catch {
    // Counts are a convenience; the queues still work without them.
  }
}

function openActionDialog(kind, id, status, label) {
  reviewTarget = { kind, id, status };
  const rejecting = status === "rejected";
  $("#review-action-eyebrow").textContent = kind === "identity" ? "Identity decision" : "Licence decision";
  $("#review-action-title").textContent = rejecting ? `Reject ${label}?` : `Approve ${label}?`;
  $("#review-action-copy").textContent = rejecting
    ? "A clear note helps the member understand what to fix. The decision is stored in the audit trail."
    : "This unlocks the next step for the member and is stored in the audit trail.";
  $("#review-action-note").value = "";
  $("#review-action-note").placeholder = rejecting
    ? "Explain what needs to change before a new review."
    : "Optional context for the member and the audit trail.";
  const confirm = $("#review-action-confirm");
  confirm.className = `btn ${rejecting ? "btn-danger" : "btn-primary"}`;
  confirm.textContent = rejecting ? "Reject" : "Approve";
  openModal($("#review-action-modal"));
}

async function submitDecision() {
  if (!reviewTarget) return;
  const note = $("#review-action-note").value.trim();
  if (reviewTarget.status === "rejected" && !note) {
    showToast("Add a short note so the member knows what to change.", { tone: "error" });
    $("#review-action-note").focus();
    return;
  }

  const button = $("#review-action-confirm");
  setBusy(button, true, reviewTarget.status === "rejected" ? "Rejecting…" : "Approving…");

  try {
    const { kind, id, status } = reviewTarget;
    const path = kind === "identity" ? `/admin/review-queue/${id}` : `/admin/driver-documents/${id}`;
    await api.patch(path, { status, note });
    closeReviewModal();
    showToast(
      status === "rejected"
        ? "Decision saved. The member has been notified."
        : "Approved. The member has been notified.",
      { tone: "success" }
    );
    await Promise.all([loadReviews(), loadDocs(), loadCounts()]);
  } catch (error) {
    showToast(error?.message || "Could not save this decision.", { tone: "error" });
  } finally {
    setBusy(button, false);
  }
}

function activateTab(name) {
  const identity = name !== "licences";
  $("#tab-identities").classList.toggle("is-active", identity);
  $("#tab-licences").classList.toggle("is-active", !identity);
  $("#tab-identities").setAttribute("aria-selected", String(identity));
  $("#tab-licences").setAttribute("aria-selected", String(!identity));
  $("#panel-identities").hidden = !identity;
  $("#panel-licences").hidden = identity;
}

function bindEvents() {
  $("#tab-identities")?.addEventListener("click", () => activateTab("identities"));
  $("#tab-licences")?.addEventListener("click", () => activateTab("licences"));

  document.querySelectorAll("[data-review-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      reviewFilter = button.dataset.reviewFilter;
      document.querySelectorAll("[data-review-filter]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      loadReviews();
    });
  });

  document.querySelectorAll("[data-doc-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      docFilter = button.dataset.docFilter;
      document.querySelectorAll("[data-doc-filter]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      loadDocs();
    });
  });

  $("#review-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-action]");
    if (!button) return;
    const card = button.closest("[data-review-id]");
    if (!card) return;
    const item = reviewItems.find((entry) => String(entry._id || entry.id) === card.dataset.reviewId);
    if (!item) return;
    openActionDialog(
      button.dataset.reviewKind,
      card.dataset.reviewId,
      button.dataset.reviewAction,
      item.user?.name || "this account"
    );
  });

  $("#doc-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-action]");
    if (!button) return;
    const card = button.closest("[data-doc-id]");
    if (!card) return;
    const item = docItems.find((entry) => entry.id === card.dataset.docId);
    if (!item) return;
    openActionDialog(
      button.dataset.reviewKind,
      card.dataset.docId,
      button.dataset.reviewAction,
      `${item.user?.name || "this driver"}'s licence`
    );
  });

  $("#review-refresh")?.addEventListener("click", async () => {
    const button = $("#review-refresh");
    setBusy(button, true, "Refreshing…");
    await Promise.all([loadReviews(), loadDocs(), loadCounts()]);
    setBusy(button, false);
    showToast("Verification queues refreshed.", { tone: "info" });
  });

  $("#review-action-confirm")?.addEventListener("click", submitDecision);
  document.querySelectorAll("[data-close-review]").forEach((element) => {
    element.addEventListener("click", closeReviewModal);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeReviewModal();
  });

  document.querySelectorAll("[data-doc-url]").forEach((node) => {
    if (node.tagName !== "A") return;
    node.addEventListener("click", (event) => {
      if (!node.dataset.docLoaded) event.preventDefault();
    });
  });
}

async function boot() {
  user = await bootPage({ roles: ["admin"] });
  if (!user) return;

  bindEvents();
  if (location.hash === "#licences") activateTab("licences");
  await Promise.allSettled([loadReviews(), loadDocs(), loadCounts()]);
}

document.addEventListener("DOMContentLoaded", boot);
window.addEventListener(
  "pagehide",
  () => objectUrls.forEach((url) => URL.revokeObjectURL(url)),
  { once: true }
);
