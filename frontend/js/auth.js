import { api, getToken, setToken } from "./api.js";
import { createScanEffect } from "./scanEffect.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const SIGNUP_TYPES = new Set(["image/jpeg", "image/png"]);
const LICENSE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_UPLOAD = 5 * 1024 * 1024;

const signupForm = $("#signup-form");
const loginForm = $("#login-form");
const authPanelHead = $("#auth-panel-head");
const authOutcome = $("#auth-outcome");
const panelTitle = $("#auth-panel-title");
const panelSub = $("#auth-panel-sub");
const formAlert = $("#form-alert");
const formAlertTitle = $("#form-alert-title");
const formAlertList = $("#form-alert-list");
const formAlertAction = $("#form-alert-action");
const driverFields = $("#driver-fields");
const selfieInput = $("#selfie-input");
const licenseInput = $("#license-input");
const licenseName = $("#license-name");
const cameraButton = $("#camera-btn");
const captureButton = $("#capture-btn");
const selfieVideo = $("#selfie-video");
const selfiePreview = $("#selfie-preview");
const scanIdle = $("#scan-idle");
const scanStage = $("#scan-stage");
const scanStatus = $("#scan-status");
const scanStateLabel = $("#scan-state-label");
const selfieStatus = $("#selfie-status");
const signupSubmit = $("#signup-submit");
const loginSubmit = $("#login-submit");
const logoutButton = $("#logout-btn");

const otpModal = $("#otp-modal");
const otpDialog = $(".otp-dialog", otpModal);
const otpForm = $("#otp-form");
const otpInputs = $$("#otp-inputs input");
const otpAlert = $("#otp-alert");
const otpAlertTitle = $("#otp-alert-title");
const otpAlertList = $("#otp-alert-list");
const otpCopy = $("#otp-copy");
const otpTimer = $("#otp-timer");
const otpResend = $("#otp-resend");
const otpSubmit = $("#otp-submit");

const scan = createScanEffect($("#scan-canvas"));

let mode = "signup";
let selfieFile = null;
let selfieUrl = null;
let cameraStream = null;
let pendingEmail = "";
let pendingPhone = "";
let pendingPurpose = "signup";
let otpCountdown = null;
let otpResendSeconds = 0;
let lastFocused = null;

function setStageState(state) {
  scanStage.dataset.state = state;
  scanStateLabel.textContent = state === "live" ? "LIVE" : state === "preview" ? "CAPTURED" : "IDLE";
  scan.setActive(state !== "idle");
}

function setSelfieStatus(message, tone = "") {
  selfieStatus.textContent = message;
  selfieStatus.classList.toggle("is-ready", tone === "ready");
  selfieStatus.classList.toggle("is-error", tone === "error");
}

function setScanStatus(message) {
  scanStatus.textContent = message;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
  if (busy) button.textContent = label;
  else button.innerHTML = button.dataset.originalHtml;
}

function clearFormAlert() {
  formAlert.hidden = true;
  formAlertTitle.textContent = "Please check the form";
  formAlertList.replaceChildren();
  formAlertAction.hidden = true;
  formAlertAction.onclick = null;
}

function clearInvalid(form) {
  $$(".is-invalid", form).forEach((element) => element.classList.remove("is-invalid"));
}

function markInvalid(form, field) {
  if (!form || !field) return null;
  const control = form.elements.namedItem(field);
  const wrapper = control?.closest(".field, .consent, .role-field");
  wrapper?.classList.add("is-invalid");
  return control;
}

function showFormAlert(errors, title = "Please check the form", action = null) {
  const list = (Array.isArray(errors) ? errors : [{ message: String(errors) }]).filter(
    (item) => item && item.message
  );

  formAlertTitle.textContent = title;
  formAlertList.replaceChildren(
    ...list.map((item) => {
      const li = document.createElement("li");
      li.textContent = item.message;
      return li;
    })
  );

  if (action) {
    formAlertAction.hidden = false;
    formAlertAction.textContent = action.label;
    formAlertAction.onclick = action.onClick;
  } else {
    formAlertAction.hidden = true;
    formAlertAction.onclick = null;
  }

  formAlert.hidden = false;
  formAlert.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function showApiError(error, form, title = "We couldn't continue") {
  const details = Array.isArray(error?.details) && error.details.length
    ? error.details
    : [{ message: error?.message || "Something went wrong. Please try again." }];

  clearInvalid(form);
  let firstControl = null;
  for (const item of details) {
    if (item.field) {
      const control = markInvalid(form, item.field);
      if (!firstControl && control) firstControl = control;
    }
  }

  showFormAlert(details, title);
  if (firstControl && typeof firstControl.focus === "function") firstControl.focus();
}

function switchMode(nextMode) {
  mode = nextMode === "login" ? "login" : "signup";
  const login = mode === "login";

  if (login && cameraStream) {
    stopCamera();
    if (selfieFile) {
      scanIdle.hidden = true;
      setStageState("preview");
    } else {
      scanIdle.hidden = false;
      setStageState("idle");
      setScanStatus("Camera off · nothing is uploaded yet");
    }
  }

  $("#mode-signup").classList.toggle("is-active", !login);
  $("#mode-login").classList.toggle("is-active", login);
  $("#mode-signup").setAttribute("aria-pressed", String(!login));
  $("#mode-login").setAttribute("aria-pressed", String(login));

  signupForm.hidden = login;
  loginForm.hidden = !login;
  authPanelHead.hidden = false;
  authOutcome.hidden = true;
  clearFormAlert();

  panelTitle.textContent = login ? "Welcome back" : "Make the city yours";
  panelSub.textContent = login
    ? "Log in to check your verification and ride status."
    : "Join as a rider or driver. Every step is built to keep your identity yours.";
}

function syncDriverFields() {
  const role = signupForm.elements.namedItem("role")?.value;
  const isDriver = role === "driver";

  driverFields.hidden = !isDriver;
  for (const name of ["vehicleType", "plateNumber", "licenseDoc"]) {
    const control = signupForm.elements.namedItem(name);
    if (control) control.required = isDriver;
  }
}

function validateUpload(file, allowed, label) {
  if (!file) return `${label} is required.`;
  if (!allowed.has(file.type)) return `${label} must be ${[...allowed].map(friendlyType).join(", ")}.`;
  if (file.size > MAX_UPLOAD) return `${label} must be 5 MB or smaller.`;
  return "";
}

function friendlyType(type) {
  if (type === "application/pdf") return "PDF";
  if (type === "image/jpeg") return "JPEG";
  if (type === "image/png") return "PNG";
  return type;
}

function stopCamera() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  selfieVideo.srcObject = null;
  selfieVideo.hidden = true;
  captureButton.hidden = true;
}

function revokePreview() {
  if (selfieUrl) {
    URL.revokeObjectURL(selfieUrl);
    selfieUrl = null;
  }
}

function resetSelfie() {
  stopCamera();
  revokePreview();
  selfieFile = null;
  selfiePreview.hidden = true;
  selfiePreview.removeAttribute("src");
  scanIdle.hidden = false;
  setStageState("idle");
  setScanStatus("Camera off · nothing is uploaded yet");
  setSelfieStatus("No selfie added yet.");
}

function applySelfie(file, sourceLabel) {
  const problem = validateUpload(file, SIGNUP_TYPES, "Selfie");
  if (problem) {
    setSelfieStatus(problem, "error");
    return false;
  }

  stopCamera();
  revokePreview();
  selfieFile = file;
  selfieUrl = URL.createObjectURL(file);
  selfiePreview.src = selfieUrl;
  selfiePreview.hidden = false;
  scanIdle.hidden = true;
  setStageState("preview");
  setScanStatus("Selfie ready · private preview only");
  setSelfieStatus(`${sourceLabel} added. You can retake it any time.`, "ready");
  return true;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setSelfieStatus("This browser cannot open a camera. Upload a selfie instead.", "error");
    return;
  }

  stopCamera();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
      audio: false,
    });

    revokePreview();
    selfieFile = null;
    selfiePreview.hidden = true;
    selfiePreview.removeAttribute("src");
    selfieVideo.srcObject = cameraStream;
    selfieVideo.hidden = false;
    scanIdle.hidden = true;
    captureButton.hidden = false;
    setStageState("live");
    setScanStatus("Camera live · keep one face in frame");
    setSelfieStatus("Camera is on. Center your face and capture when ready.");
    await selfieVideo.play().catch(() => {});
  } catch (error) {
    stopCamera();
    setStageState(selfieFile ? "preview" : "idle");
    if (!selfieFile) scanIdle.hidden = false;
    setSelfieStatus(
      error?.name === "NotAllowedError"
        ? "Camera permission was blocked. Upload a selfie instead."
        : "We could not open the camera. Upload a selfie instead.",
      "error"
    );
  }
}

function captureSelfie() {
  if (!selfieVideo.videoWidth || !selfieVideo.videoHeight) {
    setSelfieStatus("The camera is still warming up. Try again in a moment.", "error");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = selfieVideo.videoWidth;
  canvas.height = selfieVideo.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(selfieVideo, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(
    (blob) => {
      if (!blob) {
        setSelfieStatus("We could not capture that frame. Please try again.", "error");
        return;
      }
      const file = new File([blob], `selfie-${Date.now()}.jpg`, { type: "image/jpeg" });
      applySelfie(file, "Camera selfie");
    },
    "image/jpeg",
    0.9
  );
}

function validateSignup() {
  clearInvalid(signupForm);

  const field = (name) => signupForm.elements.namedItem(name);
  const value = (name) => String(field(name)?.value || "").trim();
  const errors = [];
  const add = (name, message) => errors.push({ field: name, message });

  if (value("name").length < 2) add("name", "Enter your full name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value("email"))) {
    add("email", "Enter a valid email address.");
  }
  if (!/^\+?[0-9][0-9\s-]{6,18}$/.test(value("phone"))) {
    add("phone", "Enter a valid phone number, including the country code.");
  }
  if (value("password").length < 8 || !/[A-Za-z]/.test(value("password")) || !/[0-9]/.test(value("password"))) {
    add("password", "Password must be at least 8 characters with a letter and a number.");
  }

  if (value("role") === "driver") {
    if (!value("vehicleType")) add("vehicleType", "Choose your vehicle type.");
    if (!/^[A-Z0-9][A-Z0-9 -]{3,13}$/i.test(value("plateNumber"))) {
      add("plateNumber", "Enter a valid plate number.");
    }
    const license = field("licenseDoc")?.files?.[0];
    const problem = validateUpload(license, LICENSE_TYPES, "Driving licence");
    if (problem) add("licenseDoc", problem);
  }

  if (!selfieFile) add("selfie", "Take or upload a selfie.");
  if (!field("consent")?.checked) add("consent", "Please agree to the safety and privacy terms.");

  if (errors.length) {
    for (const item of errors) markInvalid(signupForm, item.field);
    if (errors.some((item) => item.field === "selfie")) {
      setSelfieStatus("A selfie is needed for the face check.", "error");
    }
    showFormAlert(errors);
    if (errors[0].field === "selfie") cameraButton.focus();
    return false;
  }

  return true;
}

async function submitSignup(event) {
  event.preventDefault();
  clearFormAlert();

  if (!validateSignup()) return;

  const data = new FormData();
  for (const name of ["name", "email", "phone", "password", "role"]) {
    data.append(name, String(signupForm.elements.namedItem(name).value).trim());
  }
  if (signupForm.elements.namedItem("role").value === "driver") {
    const vehicleType = signupForm.elements.namedItem("vehicleType").value;
    const plateNumber = signupForm.elements.namedItem("plateNumber").value.trim();
    const license = signupForm.elements.namedItem("licenseDoc").files[0];
    data.append("vehicleType", vehicleType);
    data.append("plateNumber", plateNumber);
    data.append("licenseDoc", license, license.name);
  }
  data.append("selfie", selfieFile, selfieFile.name);

  setBusy(signupSubmit, true, "Checking your selfie…");

  try {
    const result = await api.post("/auth/signup", data);
    pendingEmail = result.user.email;
    pendingPhone = result.user.phone;
    openOtp("signup");
  } catch (error) {
    if (error?.code === "FACE_NOT_DETECTED" || error?.code === "INVALID_SELFIE") {
      resetSelfie();
      setSelfieStatus(error.message, "error");
      showFormAlert(
        [{ field: "selfie", message: error.message }],
        "Let's try that selfie again"
      );
      cameraButton.focus();
      return;
    }
    showApiError(error, signupForm, "We couldn't create your account");
  } finally {
    setBusy(signupSubmit, false);
  }
}

async function submitLogin(event) {
  event.preventDefault();
  clearFormAlert();

  const email = String(loginForm.elements.namedItem("email").value).trim();
  const password = String(loginForm.elements.namedItem("password").value);
  const errors = [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: "email", message: "Enter a valid email address." });
  }
  if (!password) errors.push({ field: "password", message: "Enter your password." });

  if (errors.length) {
    for (const item of errors) markInvalid(loginForm, item.field);
    showFormAlert(errors);
    return;
  }

  setBusy(loginSubmit, true, "Logging in…");

  try {
    const result = await api.post("/auth/login", { email, password });
    setToken(result.token);
    showOutcome(result.user, { fresh: false });
  } catch (error) {
    if (error?.code === "PHONE_NOT_VERIFIED") {
      pendingEmail = error.details?.[0]?.message || email;
      pendingPhone = "";
      openOtp("login");
      return;
    }
    showApiError(error, loginForm, "We couldn't log you in");
  } finally {
    setBusy(loginSubmit, false);
  }
}

function humanStatus(status) {
  if (status === "approved") return "Approved";
  if (status === "pending_review") return "Under human review";
  if (status === "rejected") return "Not approved";
  return "Verification pending";
}

function safeNext() {
  const next = new URLSearchParams(location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "";
  return next;
}

function destinationFor(user) {
  if (user.verificationStatus === "pending" || user.verificationStatus === "pending_review") {
    return "/profile.html";
  }
  if (user.verificationStatus === "rejected") return "/profile.html";
  return safeNext() || (user.role === "driver" ? "/driver.html" : user.role === "rider" ? "/book.html" : "/");
}

function showOutcome(user, { fresh = true } = {}) {
  resetSelfie();
  setScanStatus("Verification complete · image discarded");
  formAlert.hidden = true;

  const pending = user.verificationStatus === "pending" || user.verificationStatus === "pending_review";
  const rejected = user.verificationStatus === "rejected";
  const firstName = String(user.name || "").split(" ")[0] || "there";

  authPanelHead.hidden = true;
  signupForm.hidden = true;
  loginForm.hidden = true;
  authOutcome.hidden = false;
  authOutcome.focus({ preventScroll: true });

  const mark = $("#outcome-mark");
  mark.classList.toggle("is-pending", pending || rejected);
  $("#outcome-kicker").textContent = pending
    ? "Phone verified · under review"
    : rejected
      ? "Account needs attention"
      : fresh
        ? "Phone verified"
        : "Welcome back";

  $("#outcome-title").textContent = pending
    ? "You're verified. One last step."
    : rejected
      ? "We need to talk."
      : "You're in.";

  let copy;
  if (pending) {
    copy =
      "Your phone is confirmed. Our safety team is reviewing your selfie" +
      (user.role === "driver" ? " and driving licence" : "") +
      ". Most reviews finish within one working day. You'll be able to ride as soon as you're approved.";
  } else if (rejected) {
    copy =
      "Your account was not approved for rides. Please contact support so a person can help you resolve it.";
  } else if (fresh) {
    copy =
      "Your phone is confirmed and your account is approved. Your selfie was processed in memory and discarded — only a numeric embedding remains.";
  } else {
    copy = `Welcome back, ${firstName}. Your account is approved and ready for the city.`;
  }
  $("#outcome-copy").textContent = copy;

  const rows = [
    ["Name", user.name],
    ["Email", user.email],
    ["Role", user.role === "driver" ? "Driver" : user.role === "admin" ? "Admin" : "Rider"],
    ["Status", humanStatus(user.verificationStatus)],
  ];

  const container = $("#outcome-user");
  container.replaceChildren(
    ...rows.map(([label, value]) => {
      const row = document.createElement("div");
      row.className = "outcome-row";
      const labelNode = document.createElement("span");
      labelNode.textContent = label;
      const valueNode = document.createElement("strong");
      valueNode.textContent = value || "—";
      row.append(labelNode, valueNode);
      return row;
    })
  );

  const primary = $("#outcome-primary");
  primary.href = destinationFor(user);
  primary.textContent = pending
    ? "Check verification status"
    : rejected
      ? "View account details"
      : user.role === "driver"
        ? "Open driver dashboard"
        : user.role === "rider"
          ? "Book a ride"
          : "Back home";

  document.title = "Your SheDrive account";
}

async function restoreSession() {
  if (!getToken()) return;
  try {
    const result = await api.get("/auth/me");
    showOutcome(result.user, { fresh: false });
  } catch (error) {
    if (error?.status === 401 || error?.code === "ACCOUNT_UNAVAILABLE") {
      setToken(null);
    }
  }
}

function maskPhone(phone) {
  const value = String(phone || "");
  if (value.length <= 4) return "the phone on file";
  return `${"•".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function openOtp(purpose) {
  pendingPurpose = purpose;
  const loginFlow = purpose === "login";

  otpCopy.textContent = loginFlow
    ? `Enter the 6-digit code sent to ${maskPhone(pendingPhone)}. We'll send a fresh one now.`
    : `Enter the 6-digit code sent to ${maskPhone(pendingPhone)}. In demo mode it is printed in the backend log.`;

  otpInputs.forEach((input) => {
    input.value = "";
    input.classList.remove("is-filled", "is-error");
  });
  clearOtpAlert();
  clearFormAlert();
  otpModal.hidden = false;
  document.body.style.overflow = "hidden";
  lastFocused = document.activeElement;
  otpInputs[0].focus();

  startResendCountdown(30);

  if (loginFlow) {
    otpTimer.textContent = "Sending a fresh code…";
    requestOtpResend({ initial: true });
  }
}

function closeOtp() {
  otpModal.hidden = true;
  document.body.style.overflow = "";
  clearInterval(otpCountdown);
  otpCountdown = null;
  otpSubmit.disabled = false;
  setBusy(otpSubmit, false);

  if (pendingPurpose === "signup" && pendingEmail && !getToken()) {
    showFormAlert(
      [
        {
          message:
            "Your account is created, but your phone still needs verification. Reopen the code prompt to finish logging in.",
        },
      ],
      "One step left",
      { label: "Enter verification code", onClick: () => openOtp("signup") }
    );
  }

  if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
}

function clearOtpAlert() {
  otpAlert.hidden = true;
  otpAlertTitle.textContent = "Check the code";
  otpAlertList.replaceChildren();
  otpInputs.forEach((input) => input.classList.remove("is-error"));
}

function showOtpAlert(message, title = "Check the code") {
  otpAlertTitle.textContent = title;
  const li = document.createElement("li");
  li.textContent = message;
  otpAlertList.replaceChildren(li);
  otpAlert.hidden = false;
  otpInputs.forEach((input) => input.classList.add("is-error"));
}

function otpValue() {
  return otpInputs.map((input) => input.value).join("");
}

function distributeOtp(digits) {
  const clean = String(digits).replace(/\D/g, "").slice(0, 6);
  otpInputs.forEach((input, index) => {
    input.value = clean[index] || "";
    input.classList.toggle("is-filled", Boolean(input.value));
  });
  const nextEmpty = otpInputs.findIndex((input) => !input.value);
  (nextEmpty === -1 ? otpInputs[otpInputs.length - 1] : otpInputs[nextEmpty]).focus();
}

function startResendCountdown(seconds) {
  clearInterval(otpCountdown);
  otpResendSeconds = seconds;
  otpResend.disabled = true;

  const render = () => {
    otpTimer.textContent = `You can resend in 0:${String(otpResendSeconds).padStart(2, "0")}.`;
    if (otpResendSeconds <= 0) {
      clearInterval(otpCountdown);
      otpCountdown = null;
      otpResend.disabled = false;
      otpTimer.textContent = "Didn't get the code? Resend it.";
    }
    otpResendSeconds -= 1;
  };

  render();
  otpCountdown = setInterval(render, 1000);
}

async function requestOtpResend({ initial = false } = {}) {
  if (!pendingEmail) return;
  otpResend.disabled = true;
  if (!initial) otpTimer.textContent = "Sending a fresh code…";

  try {
    await api.post("/auth/resend-otp", { email: pendingEmail });
    clearOtpAlert();
    if (!initial) otpTimer.textContent = "New code sent.";
    startResendCountdown(30);
    otpInputs[0].focus();
  } catch (error) {
    clearInterval(otpCountdown);
    otpCountdown = null;
    otpResend.disabled = false;
    otpTimer.textContent = "Code not sent. Try resending it.";
    showOtpAlert(error?.message || "We could not resend the code. Try again.", "Code not sent");
  }
}

async function submitOtp(event) {
  event.preventDefault();
  clearOtpAlert();

  const code = otpValue();
  if (!/^\d{6}$/.test(code)) {
    showOtpAlert("Enter all six digits.");
    otpInputs.find((input) => !input.value)?.focus();
    return;
  }

  setBusy(otpSubmit, true, "Verifying…");

  try {
    const result = await api.post("/auth/verify-otp", { email: pendingEmail, otp: code });
    setToken(result.token);
    closeOtp();
    showOutcome(result.user, { fresh: true });
  } catch (error) {
    if (error?.code === "OTP_EXPIRED" || error?.code === "OTP_LOCKED") {
      showOtpAlert(error.message, error.code === "OTP_LOCKED" ? "Too many attempts" : "Code expired");
      otpResend.disabled = false;
      otpResend.focus();
    } else if (error?.code === "OTP_INVALID") {
      showOtpAlert(error.message, "That code didn't match");
      otpInputs[0].focus();
      otpInputs[0].select();
    } else {
      showOtpAlert(error?.message || "Something went wrong. Please try again.", "Verification failed");
    }
  } finally {
    setBusy(otpSubmit, false);
  }
}

function bindOtpInputs() {
  otpInputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      const digits = input.value.replace(/\D/g, "");
      if (digits.length > 1) {
        distributeOtp(digits);
        return;
      }
      input.value = digits.slice(-1);
      input.classList.toggle("is-filled", Boolean(input.value));
      input.classList.remove("is-error");
      if (input.value && index < otpInputs.length - 1) otpInputs[index + 1].focus();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && index > 0) {
        event.preventDefault();
        otpInputs[index - 1].value = "";
        otpInputs[index - 1].classList.remove("is-filled");
        otpInputs[index - 1].focus();
      } else if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        otpInputs[index - 1].focus();
      } else if (event.key === "ArrowRight" && index < otpInputs.length - 1) {
        event.preventDefault();
        otpInputs[index + 1].focus();
      }
    });
  });

  $("#otp-inputs").addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text") || "";
    if (!/\d/.test(text)) return;
    event.preventDefault();
    distributeOtp(text);
  });
}

function focusableInDialog() {
  return $$(
    'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    otpDialog
  ).filter((element) => element.offsetParent !== null);
}

function bindModal() {
  $("#otp-close").addEventListener("click", closeOtp);
  $("[data-otp-close]", otpModal).addEventListener("click", closeOtp);
  otpForm.addEventListener("submit", submitOtp);
  otpResend.addEventListener("click", () => requestOtpResend());

  document.addEventListener("keydown", (event) => {
    if (otpModal.hidden) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeOtp();
      return;
    }

    if (event.key !== "Tab") return;
    const items = focusableInDialog();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function init() {
  $$(".mode-btn, [data-mode]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      switchMode(button.dataset.mode);
    });
  });

  $$('input[name="role"]', signupForm).forEach((input) => {
    input.addEventListener("change", syncDriverFields);
  });

  signupForm.addEventListener("submit", submitSignup);
  loginForm.addEventListener("submit", submitLogin);
  logoutButton.addEventListener("click", () => {
    setToken(null);
    pendingEmail = "";
    pendingPhone = "";
    document.title = "Join SheDrive";
    switchMode("login");
    authPanelHead.hidden = false;
    loginForm.elements.namedItem("email")?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  for (const form of [signupForm, loginForm]) {
    form.addEventListener("input", (event) => {
      event.target.closest(".field, .consent")?.classList.remove("is-invalid");
      if (!formAlert.hidden && !form.querySelector(".is-invalid")) clearFormAlert();
    });
  }

  cameraButton.addEventListener("click", startCamera);
  captureButton.addEventListener("click", captureSelfie);

  selfieInput.addEventListener("change", () => {
    const file = selfieInput.files?.[0];
    selfieInput.value = "";
    if (file) applySelfie(file, "Uploaded selfie");
  });

  licenseInput.addEventListener("change", () => {
    const file = licenseInput.files?.[0];
    const problem = file ? validateUpload(file, LICENSE_TYPES, "Driving licence") : "Driving licence is required.";
    if (problem) {
      licenseInput.value = "";
      licenseName.textContent = problem;
      markInvalid(signupForm, "licenseDoc");
      return;
    }
    licenseName.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
    licenseInput.closest(".field")?.classList.remove("is-invalid");
  });

  bindOtpInputs();
  bindModal();
  syncDriverFields();
  const requestedMode = new URLSearchParams(window.location.search).get("mode");
  switchMode(requestedMode === "login" ? "login" : "signup");
  restoreSession();

  window.addEventListener("pagehide", () => {
    stopCamera();
    revokePreview();
    scan.destroy();
  });
}

init();
