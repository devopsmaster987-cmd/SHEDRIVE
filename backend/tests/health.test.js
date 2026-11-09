const request = require("supertest");
const app = require("../src/app");

describe("health and metrics endpoints", () => {
  test("GET /health returns the standard success envelope", async () => {
    const res = await request(app).get("/health").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeUndefined();
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.service).toBe("backend");
    expect(typeof res.body.data.uptimeSeconds).toBe("number");
  });

  test("GET /health/ready returns 503 while MongoDB is disconnected", async () => {
    const res = await request(app).get("/health/ready").expect(503);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_READY");
    expect(res.body.data.database).toBe("disconnected");
  });

  test("GET /metrics exposes Prometheus text metrics", async () => {
    const res = await request(app).get("/metrics").expect(200);

    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("shedrive_http_requests_total");
    expect(res.text).toContain("shedrive_http_request_duration_seconds");
  });

  test("GET /api describes the API", async () => {
    const res = await request(app).get("/api").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("SheDrive API");
  });

  test("unknown routes return a structured 404", async () => {
    const res = await request(app).get("/does-not-exist").expect(404);

    expect(res.body).toEqual({
      success: false,
      data: null,
      error: expect.objectContaining({ code: "NOT_FOUND" }),
    });
  });
});
