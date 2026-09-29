// CORS behavior tests — verifies the allowlist logic responds correctly
// to preflight and actual requests from various origins.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { harness } from "./helpers.js";

describe("CORS", () => {
  describe("preflight (OPTIONS)", () => {
    it("204 with allow headers for a localhost dev origin", async () => {
      const res = await request(harness)
        .options("/health")
        .set("Origin", "http://localhost:5173")
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "Content-Type, Authorization");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
      expect(res.headers["access-control-allow-methods"]).toContain("POST");
      expect(res.headers["access-control-allow-headers"]).toContain("Content-Type");
      expect(res.headers["access-control-allow-headers"]).toContain("Authorization");
    });

    it("204 with allow headers for 127.0.0.1 variant", async () => {
      const res = await request(harness)
        .options("/health")
        .set("Origin", "http://127.0.0.1:5173")
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "Content-Type, Authorization");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    });

    it("204 with allow headers for localhost on any port", async () => {
      const res = await request(harness)
        .options("/health")
        .set("Origin", "http://localhost:9999")
        .set("Access-Control-Request-Method", "GET");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:9999");
    });

    it("204 with allow headers for capacitor origin", async () => {
      const res = await request(harness)
        .options("/health")
        .set("Origin", "capacitor://localhost")
        .set("Access-Control-Request-Method", "POST");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("capacitor://localhost");
    });

    it("no CORS header for a disallowed origin (browser blocks)", async () => {
      const res = await request(harness)
        .options("/health")
        .set("Origin", "https://evil.com")
        .set("Access-Control-Request-Method", "POST");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("actual requests", () => {
    it("reflects allowed origin on a real GET", async () => {
      const res = await request(harness)
        .get("/health")
        .set("Origin", "http://localhost:5173");
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    });

    it("no origin header → wildcard (non-browser / curl)", async () => {
      const res = await request(harness).get("/health");
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("disallowed origin gets no CORS header on a real request", async () => {
      const res = await request(harness)
        .get("/health")
        .set("Origin", "https://attacker.io");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});
