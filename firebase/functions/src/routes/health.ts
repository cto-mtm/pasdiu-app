import express from "express";

export const healthRouter = express.Router();

// ── GET /health (public) ────────────────────────────────────────────────────
healthRouter.get("/", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});
