const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const config = require("../config/env");
const AppError = require("../utils/AppError");

const LICENSE_TYPES = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

const LICENSE_MIME_TYPES = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

const LICENSE_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/;

async function saveLicenseDoc(file) {
  if (!file || !file.buffer) {
    throw new AppError("A driving licence document is required.", {
      status: 422,
      code: "LICENSE_DOCUMENT_REQUIRED",
    });
  }

  const extension = LICENSE_TYPES[file.mimetype];
  if (!extension) {
    throw new AppError("Licence documents must be PDF, JPEG or PNG.", {
      status: 415,
      code: "UNSUPPORTED_LICENSE_DOCUMENT",
    });
  }

  const directory = path.join(config.storageDir, "license-docs");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });

  const filename = `${crypto.randomUUID()}${extension}`;
  const fullPath = path.join(directory, filename);
  await fs.writeFile(fullPath, file.buffer, { mode: 0o600 });

  return {
    path: fullPath,
    url: `/api/admin/driver-documents/${filename}`,
  };
}

async function readLicenseDoc(filename) {
  if (!LICENSE_FILENAME.test(filename)) {
    throw new AppError("Document not found.", { status: 404, code: "DOCUMENT_NOT_FOUND" });
  }

  const extension = path.extname(filename);
  const fullPath = path.join(config.storageDir, "license-docs", filename);

  try {
    const buffer = await fs.readFile(fullPath);
    return { buffer, contentType: LICENSE_MIME_TYPES[extension], filename };
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new AppError("Document not found.", { status: 404, code: "DOCUMENT_NOT_FOUND" });
    }
    throw error;
  }
}

async function removeLicenseDoc(fullPath) {
  if (!fullPath) return;
  const root = path.resolve(config.storageDir);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(`${root}${path.sep}`)) return;
  await fs.rm(resolved, { force: true });
}

module.exports = { saveLicenseDoc, readLicenseDoc, removeLicenseDoc };
