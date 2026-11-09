const config = require("../config/env");

const DECISIONS = new Set(["auto_approved", "needs_review", "no_face"]);

function unavailable(reason, { invalid = false, status = null } = {}) {
  return { available: false, invalid, status, reason };
}

async function verifySelfie({ buffer, mimetype }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.faceTimeoutMs);

  try {
    const form = new FormData();
    const filename = mimetype === "image/png" ? "selfie.png" : "selfie.jpg";
    form.append("selfie", new Blob([buffer], { type: mimetype }), filename);

    const response = await fetch(`${config.faceServiceUrl}/verify`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      return unavailable("face_service_rejected", {
        invalid: response.status >= 400 && response.status < 500,
        status: response.status,
      });
    }

    const payload = await response.json().catch(() => null);
    if (!payload || !DECISIONS.has(payload.decision)) {
      return unavailable("invalid_face_service_response");
    }

    const confidence = Number(payload.confidence);
    if (!Number.isFinite(confidence)) {
      return unavailable("invalid_face_service_response");
    }

    const embedding = Array.isArray(payload.embedding)
      ? payload.embedding.map(Number)
      : null;

    if (
      !embedding ||
      embedding.some((value) => !Number.isFinite(value)) ||
      (payload.decision !== "no_face" && embedding.length === 0)
    ) {
      return unavailable("invalid_face_service_response");
    }

    return {
      available: true,
      faceDetected: Boolean(payload.face_detected),
      gender: typeof payload.gender === "string" ? payload.gender : "unknown",
      confidence: Math.min(1, Math.max(0, confidence)),
      decision: payload.decision,
      embedding,
    };
  } catch (error) {
    return unavailable(error.name === "AbortError" ? "face_service_timeout" : "face_service_unreachable");
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { verifySelfie };
