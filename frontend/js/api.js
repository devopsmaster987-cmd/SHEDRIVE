// Small fetch wrapper shared by every page.
// - Adds the JWT access token when present.
// - Understands the backend envelope { success, data, error }.
// - Throws a readable ApiError so pages can show friendly messages.

const TOKEN_KEY = "shedrive:token";
const API_BASE = import.meta.env.VITE_API_URL || "";

export class ApiError extends Error {
  constructor(message, { status = 0, code = "NETWORK_ERROR", details = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest(path, { method = "GET", body, headers = {}, signal } = {}) {
  const token = getToken();
  const isFormData = body instanceof FormData;

  const finalHeaders = {
    Accept: "application/json",
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };

  let response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: finalHeaders,
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    throw new ApiError("We could not reach SheDrive. Check your connection and try again.", {
      code: "NETWORK_ERROR",
      details: error,
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON responses (proxy errors, etc.) fall through to a generic message.
  }

  if (!response.ok || payload?.success === false) {
    throw new ApiError(payload?.error?.message || "Something went wrong. Please try again.", {
      status: response.status,
      code: payload?.error?.code || "REQUEST_FAILED",
      details: payload?.error?.details || null,
    });
  }

  return payload?.data ?? payload;
}

export const api = {
  get: (path, options) => apiRequest(path, { ...options, method: "GET" }),
  post: (path, body, options) => apiRequest(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => apiRequest(path, { ...options, method: "PATCH", body }),
  delete: (path, options) => apiRequest(path, { ...options, method: "DELETE" }),
};
