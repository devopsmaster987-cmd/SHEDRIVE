const fs = require("node:fs/promises");
const path = require("node:path");
const config = require("../src/config/env");
const {
  saveLicenseDoc,
  readLicenseDoc,
  removeLicenseDoc,
} = require("../src/services/storageService");

beforeEach(async () => {
  await fs.rm(config.storageDir, { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(config.storageDir, { recursive: true, force: true });
});

test("stores, reads and removes a licence document under a generated name", async () => {
  const stored = await saveLicenseDoc({
    buffer: Buffer.from("%PDF-1.4 test"),
    mimetype: "application/pdf",
  });

  const filename = path.basename(stored.path);
  expect(stored.url).toBe(`/api/admin/driver-documents/${filename}`);
  expect(filename).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/
  );

  const document = await readLicenseDoc(filename);
  expect(document.contentType).toBe("application/pdf");
  expect(document.buffer.toString()).toBe("%PDF-1.4 test");

  await removeLicenseDoc(stored.path);
  await expect(readLicenseDoc(filename)).rejects.toMatchObject({
    status: 404,
    code: "DOCUMENT_NOT_FOUND",
  });
});

test("rejects path traversal and unexpected filenames", async () => {
  await expect(readLicenseDoc("../../etc/passwd")).rejects.toMatchObject({
    status: 404,
    code: "DOCUMENT_NOT_FOUND",
  });
  await expect(readLicenseDoc("not-a-document.pdf")).rejects.toMatchObject({
    status: 404,
    code: "DOCUMENT_NOT_FOUND",
  });
});
