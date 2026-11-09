import { api } from "./api.js";
import { bootPage, formatCurrency, initials, setBusy, showToast } from "./shell.js";

const $ = (selector, root = document) => root.querySelector(selector);
const params = new URLSearchParams(window.location.search);
const STAR_LABELS = ["Poor", "Not great", "Okay", "Great", "Loved it"];
const PAYMENT_COPY = {
  cash: {
    rider: "Cash payment recorded. Please hand the fare to your driver.",
    driver: "The rider chose cash. The fare is marked as collected.",
    title: "Cash payment",
  },
  wallet: {
    rider: "Paid instantly from your SheDrive wallet.",
    driver: "The rider paid from their SheDrive wallet.",
    title: "Wallet payment",
  },
};

let user = null;
let ride = null;
let rideId = params.get("ride");
let payment = null;
let wallet = null;
let ratingState = null;
let selectedMethod = null;
let selectedStars = 0;
let confettiPlayed = false;

function shortId(id) {
  return String(id || "").slice(-6).toUpperCase();
}

function formatDate(value) {
  if (!value) return "Completed ride";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function showError(title, message) {
  $("#app-loading").hidden = true;
  $("#app-content").hidden = true;
  $("#app-error-title").textContent = title;
  $("#app-error-message").textContent = message;
  const action = $("#app-error-action");
  action.textContent = "Go back home";
  action.href = user?.role === "driver" ? "/driver.html" : "/book.html";
  $("#app-error").hidden = false;
}

async function loadSummary() {
  const result = await api.get(`/rides/${rideId}`);
  ride = result.ride;

  if (ride.status !== "completed") {
    window.location.replace(
      user.role === "driver"
        ? `/driver-ride.html?ride=${encodeURIComponent(rideId)}`
        : `/ride.html?ride=${encodeURIComponent(rideId)}`
    );
    return false;
  }

  const requests = [
    api.get(`/ratings/rides/${rideId}`),
    api.get(`/payments/rides/${rideId}`),
  ];
  if (user.role === "rider") requests.push(api.get("/payments/wallet"));

  const [ratingResult, paymentResult, walletResult] = await Promise.all(requests);
  ratingState = ratingResult;
  payment = paymentResult.payment;
  wallet = walletResult?.wallet || null;
  return true;
}

function renderFare() {
  const final = Number(ride.finalPrice ?? ride.offeredPrice ?? 0);
  const offered = Number(ride.offeredPrice ?? final);
  const delta = Math.round((final - offered) * 100) / 100;
  const rider = user.role === "rider";

  $("#summary-fare").textContent = formatCurrency(final);
  $("#summary-fare-copy").textContent = rider
    ? "The final fare agreed with your driver."
    : "The fare collected for this trip.";
  $("#summary-amount").textContent = formatCurrency(final);
  $("#summary-badge").textContent = `${ride.vehicleType || "Car"} · Completed`;
  $("#summary-id").textContent = `#${shortId(ride.id)}`;
  $("#summary-pickup").textContent = ride.pickup?.label || "Pinned pickup";
  $("#summary-drop").textContent = ride.drop?.label || "Pinned drop";
  $("#summary-distance").textContent = `${Number(ride.distanceKm || 0).toFixed(1)} km`;
  $("#summary-vehicle").textContent = ride.vehicleType || "—";
  $("#summary-duration").textContent = `${ride.durationMinutes || "—"} min`;
  $("#summary-date").textContent = formatDate(ride.completedAt || ride.createdAt);

  $("#fare-offer-label").textContent = rider ? "Your offer" : "Rider's offer";
  $("#fare-offer").textContent = formatCurrency(offered);
  if (delta > 0) {
    $("#fare-adjustment-label").textContent = "Driver counter";
    $("#fare-adjustment").textContent = `+${formatCurrency(delta)}`;
    $("#fare-adjustment").classList.add("is-up");
  } else if (delta < 0) {
    $("#fare-adjustment-label").textContent = "Offer saving";
    $("#fare-adjustment").textContent = `−${formatCurrency(Math.abs(delta))}`;
    $("#fare-adjustment").classList.add("is-down");
  } else {
    $("#fare-adjustment-label").textContent = "Agreed at your offer";
    $("#fare-adjustment").textContent = "Included";
  }
  $("#fare-total").textContent = formatCurrency(final);

  $("#summary-subtitle").textContent = rider
    ? "A safe arrival, a clear fare, and a moment to share how the ride felt."
    : "Trip complete. Review the fare and share feedback about your passenger.";
  $("#summary-title").innerHTML = rider
    ? 'You arrived, <span class="gradient-text">brilliantly.</span>'
    : 'Trip complete, <span class="gradient-text">beautifully.</span>';

  const home = $("#summary-home");
  if (rider) {
    home.href = "/book.html";
    home.textContent = "Book another ride";
  } else {
    home.href = "/driver.html";
    home.textContent = "Back to dashboard";
    $("#summary-history").textContent = "View trip history";
  }
}

function paymentMethodLabel(method) {
  return method === "wallet" ? "SheDrive wallet" : "Cash to driver";
}

function renderPayment() {
  const rider = user.role === "rider";
  const amount = Number(ride.finalPrice ?? ride.offeredPrice ?? 0);
  const due = $("#payment-due");
  const receipt = $("#payment-receipt");

  $("#payment-due-amount").textContent = formatCurrency(amount);
  $("#payment-title").textContent = rider ? "Settle the fare" : "Fare collection";

  if (payment) {
    due.hidden = true;
    receipt.hidden = false;
    const copy = PAYMENT_COPY[payment.method] || PAYMENT_COPY.cash;
    $("#payment-method").textContent = copy.title;
    $("#payment-note").textContent = copy[user.role] || copy.rider;
    $("#payment-amount").textContent = formatCurrency(payment.amount);
    $("#payment-reference").textContent = payment.reference;
    $("#payment-status").textContent = "Paid";
    $("#payment-icon").classList.add("is-paid");
    return;
  }

  due.hidden = false;
  receipt.hidden = true;
  $("#payment-icon").classList.remove("is-paid");
  $("#payment-status").textContent = rider
    ? "Choose how you would like to pay."
    : "Waiting for the rider to settle the fare.";
  $("#payment-wallet").textContent = wallet ? formatCurrency(wallet.balance) : "—";

  const choices = $("#payment-choices");
  const payButton = $("#pay-button");
  const note = due.querySelector(".payment-note");
  choices.hidden = !rider;
  payButton.hidden = !rider;
  note.hidden = !rider;

  if (!rider) {
    payButton.disabled = true;
    return;
  }

  const walletChoice = choices.querySelector('[data-method="wallet"]');
  const insufficient = !wallet || Number(wallet.balance) < amount;
  walletChoice.classList.toggle("is-unavailable", insufficient);
  walletChoice.disabled = insufficient;
  if (insufficient) {
    const small = walletChoice.querySelector("small");
    small.textContent = wallet
      ? `Add ${formatCurrency(amount - wallet.balance)} to use wallet`
      : "Wallet unavailable";
  }

  selectMethod(selectedMethod);
}

function selectMethod(method) {
  if (method === "wallet" && user.role === "rider") {
    const amount = Number(ride.finalPrice ?? ride.offeredPrice ?? 0);
    if (!wallet || Number(wallet.balance) < amount) method = null;
  }

  selectedMethod = method;
  for (const button of document.querySelectorAll(".payment-choice")) {
    button.setAttribute("aria-pressed", String(button.dataset.method === method));
  }

  const button = $("#pay-button");
  const amount = Number(ride.finalPrice ?? ride.offeredPrice ?? 0);
  if (!method) {
    button.disabled = true;
    button.textContent = "Choose a payment method";
    return;
  }

  button.disabled = false;
  button.textContent =
    method === "wallet"
      ? `Pay ${formatCurrency(amount)} from wallet`
      : `Confirm ${formatCurrency(amount)} cash payment`;
}

function renderRating() {
  const counterpart = ratingState?.counterpart;
  if (!counterpart) return;

  $("#rating-name").textContent = counterpart.name || "Your ride partner";
  $("#rating-role").textContent =
    counterpart.role === "driver" ? "Your SheDrive driver" : "Your SheDrive passenger";
  $("#rating-avatar").textContent = initials(counterpart.name);
  $("#rating-copy").textContent =
    counterpart.role === "driver"
      ? "Rate the driving, safety and welcome you experienced."
      : "Rate how the pickup and journey felt for you.";

  const form = $("#rating-form");
  const done = $("#rating-done");
  if (ratingState.rating) {
    form.hidden = true;
    done.hidden = false;
    const stars = Number(ratingState.rating.stars) || 0;
    $("#rating-done-stars").textContent = `${"★".repeat(stars)}${"☆".repeat(5 - stars)}`;
    $("#rating-done-copy").textContent = ratingState.rating.comment
      ? `“${ratingState.rating.comment}”`
      : `You rated ${counterpart.name || "this ride"} ${stars} out of 5.`;
    return;
  }

  form.hidden = false;
  done.hidden = true;
  buildStars();
}

function buildStars() {
  const picker = $("#rating-stars");
  if (picker.childElementCount) {
    paintStars(selectedStars);
    return;
  }

  for (let value = 1; value <= 5; value += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "star-button";
    button.dataset.value = String(value);
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");
    button.setAttribute("aria-label", `${value} star${value === 1 ? "" : "s"} · ${STAR_LABELS[value - 1]}`);
    button.innerHTML = '<span class="star-3d" aria-hidden="true">★</span>';
    button.addEventListener("click", () => {
      selectedStars = value;
      paintStars(value);
      $("#rating-submit").disabled = false;
    });
    button.addEventListener("mouseenter", () => paintStars(value, true));
    button.addEventListener("mouseleave", () => paintStars(selectedStars));
    picker.append(button);
  }
  paintStars(selectedStars);
}

function paintStars(value, preview = false) {
  for (const button of document.querySelectorAll(".star-button")) {
    const lit = Number(button.dataset.value) <= value;
    button.classList.toggle("is-lit", lit);
    button.classList.toggle("is-preview", lit && preview);
    button.setAttribute(
      "aria-checked",
      String(Number(button.dataset.value) === selectedStars)
    );
  }

  const label = $("#star-label");
  label.textContent = value
    ? `${value} star${value === 1 ? "" : "s"} · ${STAR_LABELS[value - 1]}`
    : "Tap a star";
}

async function payFare() {
  if (!selectedMethod) return;
  const button = $("#pay-button");
  setBusy(button, true, "Processing…");

  try {
    const result = await api.post(`/payments/rides/${rideId}`, { method: selectedMethod });
    payment = result.payment;
    if (result.wallet) wallet = result.wallet;
    renderPayment();
    launchConfetti();
    showToast(
      selectedMethod === "wallet" ? "Fare paid from your wallet." : "Cash payment recorded.",
      { tone: "success" }
    );
  } catch (error) {
    showToast(error?.message || "We could not record that payment.", { tone: "error" });
  } finally {
    setBusy(button, false);
    if (!payment) selectMethod(selectedMethod);
  }
}

async function submitRating(event) {
  event.preventDefault();
  if (!selectedStars) return;
  const button = $("#rating-submit");
  setBusy(button, true, "Sending…");

  try {
    const result = await api.post(`/ratings/rides/${rideId}`, {
      stars: selectedStars,
      comment: $("#rating-comment").value.trim(),
    });
    ratingState = {
      ...ratingState,
      canRate: false,
      rating: result.rating,
      counterpart: result.counterpart,
    };
    renderRating();
    launchConfetti();
    showToast("Your rating is saved. Thank you.", { tone: "success" });
  } catch (error) {
    showToast(error?.message || "We could not save your rating.", { tone: "error" });
  } finally {
    setBusy(button, false);
  }
}

function launchConfetti() {
  if (confettiPlayed && document.documentElement.classList.contains("reduce-effects")) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  confettiPlayed = true;

  const canvas = $("#summary-confetti");
  const hero = $(".summary-hero");
  if (!canvas || !hero) return;

  const rect = hero.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ["#ff2bd6", "#4ff0ff", "#8b5cff", "#ffd479", "#64f5b4"];
  const particles = Array.from({ length: 110 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    return {
      x: rect.width * 0.62,
      y: rect.height * 0.45,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.8,
      size: 2 + Math.random() * 4,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.22,
      life: 70 + Math.random() * 45,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  });

  function frame() {
    context.clearRect(0, 0, rect.width, rect.height);
    let alive = 0;
    for (const particle of particles) {
      if (particle.life <= 0) continue;
      alive += 1;
      particle.life -= 1;
      particle.vy += 0.075;
      particle.vx *= 0.992;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotation += particle.spin;
      context.save();
      context.globalAlpha = Math.max(0, particle.life / 55);
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;
      context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 1.6);
      context.restore();
    }
    if (alive) requestAnimationFrame(frame);
    else context.clearRect(0, 0, rect.width, rect.height);
  }

  requestAnimationFrame(frame);
}

function bindEvents() {
  for (const button of document.querySelectorAll(".payment-choice")) {
    button.addEventListener("click", () => selectMethod(button.dataset.method));
  }
  $("#pay-button").addEventListener("click", payFare);
  $("#rating-form").addEventListener("submit", submitRating);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      loadSummary()
        .then((loaded) => {
          if (loaded) {
            renderFare();
            renderPayment();
            renderRating();
          }
        })
        .catch(() => {});
    }
  });
}

async function main() {
  user = await bootPage({ roles: ["rider", "driver"] });
  if (!user) return;

  if (!rideId) {
    window.location.replace(user.role === "driver" ? "/driver.html" : "/history.html");
    return;
  }

  try {
    if (!(await loadSummary())) return;
  } catch (error) {
    if (error?.status === 404 || error?.status === 403) {
      showError("This summary is not available", "That ride could not be found for your account.");
    } else {
      showError(
        "The city is out of reach",
        "We could not load this ride summary. Check your connection and try again."
      );
    }
    return;
  }

  renderFare();
  renderPayment();
  renderRating();
  bindEvents();
  window.setTimeout(launchConfetti, 220);
  document.title = user.role === "driver" ? "Trip summary · SheDrive" : "Ride summary · SheDrive";
}

main();
