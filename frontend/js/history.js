import { api } from "./api.js";
import { bootPage, formatCurrency, setBusy, showToast } from "./shell.js";

const $ = (selector, root = document) => root.querySelector(selector);
const ACTIVE_STATUSES = ["searching", "accepted", "arriving", "in_progress"];
const STATUS_COPY = {
  searching: "Finding driver",
  accepted: "Driver assigned",
  arriving: "Driver arriving",
  in_progress: "On the way",
  completed: "Completed",
  cancelled: "Cancelled",
};

let user = null;
let rides = [];
let wallet = null;
let transactions = [];
let filter = "all";

function shortId(id) {
  return String(id || "").slice(-6).toUpperCase();
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function statusClass(status) {
  if (status === "completed") return "is-complete";
  if (status === "cancelled") return "is-cancelled";
  return "is-active";
}

function showError(title, message) {
  $("#app-loading").hidden = true;
  $("#app-content").hidden = true;
  $("#app-error-title").textContent = title;
  $("#app-error-message").textContent = message;
  $("#app-error-action").href = user?.role === "driver" ? "/driver.html" : "/book.html";
  $("#app-error").hidden = false;
}

async function loadData() {
  const requests = [api.get("/rides?limit=50")];
  if (user.role === "rider") requests.push(api.get("/payments/wallet"));

  const [rideResult, walletResult] = await Promise.all(requests);
  rides = rideResult.rides || [];
  if (walletResult) {
    wallet = walletResult.wallet;
    transactions = walletResult.transactions || [];
  }
}

function renderStats() {
  const completed = rides.filter((ride) => ride.status === "completed");
  const total = completed.reduce(
    (sum, ride) => sum + Number(ride.finalPrice ?? ride.offeredPrice ?? 0),
    0
  );
  const distance = completed.reduce((sum, ride) => sum + Number(ride.distanceKm || 0), 0);

  $("#history-count").textContent = String(rides.length);
  $("#history-spend-label").textContent = user.role === "driver" ? "Total earned" : "Total spent";
  $("#history-spend").textContent = formatCurrency(total);
  $("#history-distance").textContent = `${distance.toFixed(1)} km`;
}

function matchesFilter(ride) {
  if (filter === "all") return true;
  if (filter === "active") return ACTIVE_STATUSES.includes(ride.status);
  return ride.status === filter;
}

function rideCard(ride) {
  const rider = user.role === "rider";
  const article = document.createElement("article");
  article.className = "ride-history-card glass-card";

  const head = document.createElement("div");
  head.className = "ride-history-head";
  const status = document.createElement("span");
  status.className = `history-status ${statusClass(ride.status)}`;
  status.textContent = STATUS_COPY[ride.status] || ride.status;
  const date = document.createElement("span");
  date.className = "ride-history-date";
  date.textContent = formatDate(ride.completedAt || ride.cancelledAt || ride.createdAt);
  head.append(status, date);

  const body = document.createElement("div");
  body.className = "ride-history-body";
  const route = document.createElement("div");
  route.className = "ride-history-route";

  for (const stop of [
    { label: "Pickup", value: ride.pickup?.label || "Pinned pickup", kind: "pickup" },
    { label: "Drop", value: ride.drop?.label || "Pinned drop", kind: "drop" },
  ]) {
    const row = document.createElement("div");
    row.className = "history-stop";
    const dot = document.createElement("span");
    dot.className = `route-dot${stop.kind === "drop" ? " is-drop" : ""}`;
    dot.textContent = stop.kind === "drop" ? "B" : "A";
    dot.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    const small = document.createElement("small");
    small.textContent = stop.label;
    const strong = document.createElement("strong");
    strong.textContent = stop.value;
    copy.append(small, strong);
    row.append(dot, copy);
    route.append(row);
  }

  const meta = document.createElement("p");
  meta.className = "ride-history-meta";
  const counterpart = rider ? ride.driver?.name : ride.rider?.name;
  meta.textContent = [
    counterpart || (rider ? "Driver pending" : "Rider"),
    ride.vehicleType,
    `${Number(ride.distanceKm || 0).toFixed(1)} km`,
    `#${shortId(ride.id)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  route.append(meta);
  body.append(route);

  const side = document.createElement("div");
  side.className = "ride-history-side";
  const fare = document.createElement("strong");
  fare.className = "ride-history-fare";
  fare.textContent = formatCurrency(ride.finalPrice ?? ride.offeredPrice ?? 0);
  side.append(fare);

  let action = null;
  if (ride.status === "completed") {
    action = document.createElement("a");
    action.className = "btn btn-primary btn-sm";
    action.href = `/summary.html?ride=${encodeURIComponent(ride.id)}`;
    action.textContent = "Summary & rate";
  } else if (ACTIVE_STATUSES.includes(ride.status)) {
    action = document.createElement("a");
    action.className = "btn btn-ghost btn-sm";
    action.href = rider
      ? `/ride.html?ride=${encodeURIComponent(ride.id)}`
      : `/driver-ride.html?ride=${encodeURIComponent(ride.id)}`;
    action.textContent = "Track live";
  } else if (ride.cancellationReason) {
    const reason = document.createElement("small");
    reason.className = "ride-history-reason";
    reason.textContent = ride.cancellationReason;
    side.append(reason);
  }
  if (action) side.append(action);

  article.append(head, body, side);
  return article;
}

function renderRides() {
  const list = $("#history-list");
  const visible = rides.filter(matchesFilter);
  list.replaceChildren(...visible.map(rideCard));
  $("#history-empty").hidden = visible.length > 0;
  const emptyTitle = $("#history-empty strong");
  if (emptyTitle) {
    emptyTitle.textContent =
      filter === "all" ? "No rides here yet" : "No rides match this filter";
  }
}

function renderWallet() {
  if (user.role !== "rider") return;
  $("#wallet-balance").textContent = formatCurrency(wallet?.balance || 0);
  renderTransactions();
}

function renderTransactions() {
  const list = $("#transaction-list");
  const nodes = transactions.map((transaction) => {
    const row = document.createElement("article");
    row.className = `transaction-row glass-card is-${transaction.type}`;

    const icon = document.createElement("span");
    icon.className = "transaction-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = transaction.type === "topup" ? "+" : transaction.type === "refund" ? "↺" : "−";

    const copy = document.createElement("div");
    copy.className = "transaction-copy";
    const title = document.createElement("strong");
    title.textContent =
      transaction.type === "topup"
        ? "Wallet top-up"
        : transaction.type === "refund"
          ? "Wallet refund"
          : "Ride payment";
    const meta = document.createElement("small");
    meta.textContent = `${formatDate(transaction.createdAt)} · ${transaction.reference}`;
    copy.append(title, meta);

    const amount = document.createElement("strong");
    amount.className = "transaction-amount";
    const negative = transaction.type === "ride_payment";
    amount.textContent = `${negative ? "−" : "+"}${formatCurrency(transaction.amount)}`;
    amount.classList.toggle("is-negative", negative);

    row.append(icon, copy, amount);
    return row;
  });

  list.replaceChildren(...nodes);
  $("#transactions-empty").hidden = nodes.length > 0;
}

function activateTab(name) {
  if (name === "wallet" && user.role !== "rider") name = "rides";
  const walletActive = name === "wallet";

  $("#tab-rides").classList.toggle("is-active", !walletActive);
  $("#tab-wallet").classList.toggle("is-active", walletActive);
  $("#tab-rides").setAttribute("aria-selected", String(!walletActive));
  $("#tab-wallet").setAttribute("aria-selected", String(walletActive));
  $("#panel-rides").hidden = walletActive;
  $("#panel-wallet").hidden = !walletActive;

  if (walletActive) window.history.replaceState(null, "", "#wallet");
  else if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
}

async function topUp(event) {
  event.preventDefault();
  const input = $("#topup-amount");
  const amount = Number(input.value);
  if (!Number.isInteger(amount) || amount < 100 || amount > 10000) {
    showToast("Enter a whole amount between Rs100 and Rs10,000.", { tone: "error" });
    input.focus();
    return;
  }

  const button = $("#topup-submit");
  setBusy(button, true, "Adding…");
  try {
    const result = await api.post("/payments/wallet/topup", { amount });
    wallet = result.wallet;
    transactions = [result.transaction, ...transactions];
    renderWallet();
    input.value = "";
    document.querySelectorAll("#topup-quick button").forEach((item) => {
      item.classList.remove("is-selected");
    });
    showToast(`${formatCurrency(amount)} added to your wallet.`, { tone: "success" });
  } catch (error) {
    showToast(error?.message || "We could not top up your wallet.", { tone: "error" });
  } finally {
    setBusy(button, false);
  }
}

function bindEvents() {
  $("#tab-rides").addEventListener("click", () => activateTab("rides"));
  $("#tab-wallet").addEventListener("click", () => activateTab("wallet"));
  $("#history-filter").addEventListener("change", (event) => {
    filter = event.target.value;
    renderRides();
  });

  for (const button of document.querySelectorAll("#topup-quick button")) {
    button.addEventListener("click", () => {
      $("#topup-amount").value = button.dataset.amount;
      document.querySelectorAll("#topup-quick button").forEach((item) => {
        item.classList.toggle("is-selected", item === button);
      });
    });
  }

  $("#topup-form").addEventListener("submit", topUp);
}

async function main() {
  user = await bootPage({ roles: ["rider", "driver"] });
  if (!user) return;

  if (user.role === "driver") {
    $("#tab-wallet").hidden = true;
    $("#history-book").href = "/driver.html";
    $("#history-book").textContent = "Dashboard";
    $("#history-subtitle").textContent =
      "Review every active, completed and cancelled trip in one place.";
  }

  try {
    await loadData();
  } catch (error) {
    showError(
      "The city is out of reach",
      error?.message || "We could not load your ride history. Check your connection and try again."
    );
    return;
  }

  renderStats();
  renderRides();
  renderWallet();
  bindEvents();
  activateTab(window.location.hash === "#wallet" ? "wallet" : "rides");
}

main();
