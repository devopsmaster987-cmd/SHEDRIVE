import { api } from "./api.js";
import {
  bootPage,
  initials,
  setBusy,
  showToast,
  statusLabel,
} from "./shell.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const EFFECTS_KEY = "shedrive:reduce-effects";

let user = null;
let contacts = [];

const ROLE_COPY = {
  rider: "Rider account",
  driver: "Driver account",
  admin: "Admin account",
};

function formatJoined(value) {
  if (!value) return "Joined recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Joined recently";
  return `Joined ${new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(date)}`;
}

function applyStatus(status) {
  const badge = $("#profile-status");
  badge.textContent = statusLabel(status);
  badge.classList.remove("is-warning", "is-danger");
  if (status === "pending_review" || status === "pending") badge.classList.add("is-warning");
  if (status === "rejected") badge.classList.add("is-danger");
}

function updateIdentity() {
  $("#identity-avatar").textContent = initials(user.name);
  $("#identity-name").textContent = user.name;
  $("#identity-email").textContent = user.email;
  $("#identity-role").textContent = ROLE_COPY[user.role] || "SheDrive member";
  $("#identity-joined").textContent = formatJoined(user.createdAt);
  $("#profile-role").textContent = ROLE_COPY[user.role] || "SheDrive member";
  applyStatus(user.verificationStatus);

  $("#name-input").value = user.name || "";
  $("#email-input").value = user.email || "";
  $("#phone-input").value = user.phone || "";
  $("#role-input").value = ROLE_COPY[user.role] || "Member";

  const navName = $(".app-user-copy strong");
  const navAvatar = $(".app-avatar");
  if (navName) navName.textContent = user.name;
  if (navAvatar) navAvatar.textContent = initials(user.name);
}

function updateContactCount() {
  $("#contact-count").textContent = `${contacts.length} / 5`;
  $("#contact-empty").hidden = contacts.length > 0;
  $("#add-contact").disabled = contacts.length >= 5;
}

function renderContacts(focusIndex = -1) {
  const list = $("#contact-list");
  list.replaceChildren();

  contacts.forEach((contact, index) => {
    const row = document.createElement("div");
    row.className = "contact-row";

    const fields = [
      { key: "name", label: "Name", value: contact.name, placeholder: "Maya Khan", maxlength: 80 },
      { key: "phone", label: "Phone", value: contact.phone, placeholder: "+91 98765 43210", maxlength: 20 },
      { key: "relationship", label: "Relationship", value: contact.relationship, placeholder: "Sister", maxlength: 40 },
    ];

    for (const item of fields) {
      const label = document.createElement("label");
      label.className = "app-field";
      const caption = document.createElement("span");
      caption.textContent = item.label;
      const input = document.createElement("input");
      input.type = item.key === "phone" ? "tel" : "text";
      input.value = item.value || "";
      input.placeholder = item.placeholder;
      input.maxLength = item.maxlength;
      input.dataset.index = String(index);
      input.dataset.field = item.key;
      input.addEventListener("input", () => {
        contacts[index][item.key] = input.value;
      });
      label.append(caption, input);
      row.append(label);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-contact";
    remove.dataset.remove = String(index);
    remove.setAttribute("aria-label", `Remove ${contact.name || "emergency contact"}`);
    remove.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:15px;height:15px;margin:auto"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    row.append(remove);
    list.append(row);
  });

  updateContactCount();

  if (focusIndex >= 0) {
    const target = list.querySelector(`input[data-index="${focusIndex}"][data-field="name"]`);
    target?.focus();
  }
}

function addContact() {
  if (contacts.length >= 5) {
    showToast("You can keep up to five emergency contacts.", { tone: "error" });
    return;
  }
  contacts.push({ name: "", phone: "", relationship: "" });
  renderContacts(contacts.length - 1);
}

function collectContacts() {
  const collected = [];
  const phonePattern = /^\+?[0-9][0-9\s-]{6,18}$/;

  contacts.forEach((contact, index) => {
    const name = String(contact.name || "").trim();
    const phone = String(contact.phone || "").trim();
    const relationship = String(contact.relationship || "").trim();

    if (!name && !phone && !relationship) return;
    if (name.length < 2) {
      throw new Error(`Contact ${index + 1} needs a name.`);
    }
    if (!phonePattern.test(phone)) {
      throw new Error(`Contact ${index + 1} needs a valid phone number.`);
    }
    collected.push({ name, phone, relationship });
  });

  return collected;
}

async function saveProfile(button) {
  const name = $("#name-input").value.trim();
  if (name.length < 2) {
    showToast("Enter your full name.", { tone: "error" });
    $("#name-input").focus();
    return;
  }

  let emergencyContacts;
  try {
    emergencyContacts = collectContacts();
  } catch (error) {
    showToast(error.message, { tone: "error" });
    return;
  }

  setBusy(button, true, "Saving…");
  try {
    const result = await api.patch("/users/me", { name, emergencyContacts });
    user = result.user;
    contacts = result.user.emergencyContacts.map((contact) => ({ ...contact }));
    updateIdentity();
    renderContacts();
    showToast("Your profile is updated.", { tone: "success" });
  } catch (error) {
    const message = error?.details?.[0]?.message || error?.message || "We could not save those changes.";
    showToast(message, { tone: "error" });
  } finally {
    setBusy(button, false);
  }
}

function syncEffectsToggle() {
  const checkbox = $("#effects-page");
  if (!checkbox) return;
  checkbox.checked = document.documentElement.classList.contains("reduce-effects");
}

function initEffectsToggle() {
  syncEffectsToggle();
  $("#effects-page").addEventListener("change", (event) => {
    const reduce = event.target.checked;
    document.documentElement.classList.toggle("reduce-effects", reduce);
    $("#app-effects")?.setAttribute("aria-pressed", String(reduce));
    try {
      localStorage.setItem(EFFECTS_KEY, reduce ? "1" : "0");
    } catch {
      /* Preferences are optional. */
    }
  });

  $("#app-effects")?.addEventListener("click", () => {
    window.setTimeout(syncEffectsToggle, 0);
  });
}

function bindEvents() {
  $("#details-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveProfile($("#details-save"));
  });

  $("#contacts-save").addEventListener("click", () => saveProfile($("#contacts-save")));
  $("#add-contact").addEventListener("click", addContact);

  $("#contact-list").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove]");
    if (!remove) return;
    const index = Number(remove.dataset.remove);
    contacts.splice(index, 1);
    renderContacts();
  });

  initEffectsToggle();
}

async function main() {
  user = await bootPage();
  if (!user) return;

  contacts = Array.isArray(user.emergencyContacts)
    ? user.emergencyContacts.map((contact) => ({ ...contact }))
    : [];

  updateIdentity();
  renderContacts();
  bindEvents();
}

main();
