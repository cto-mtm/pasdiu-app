import type { Request, Response } from "express";

/**
 * Origins permitted to make cross-origin requests. Capacitor origins are
 * included for native builds; APP_URL covers the production frontend.
 * Any origin NOT in this list is rejected (no CORS header → browser blocks).
 */
const ALLOWED_ORIGINS: string[] = [
  "http://localhost:5173",
  "http://localhost:4000",
  "http://localhost:5000",
  "capacitor://localhost",
  "http://localhost",
  ...(process.env.APP_URL ? [process.env.APP_URL] : []),
];

/**
 * Apply CORS headers for all incoming requests and handle the preflight OPTIONS request.
 * Returns `true` if the request was a preflight and has been fully handled (the caller should stop);
 * `false` otherwise (continue routing).
 */
export function applyCors(req: Request, res: Response): boolean {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  } else if (!origin) {
    // Non-browser requests (server-to-server, curl) have no origin header.
    res.set("Access-Control-Allow-Origin", "*");
  }
  // If origin is set but not in the allowlist, no CORS header is emitted
  // and the browser will block the response.

  res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, stripe-signature");
  res.set("Access-Control-Max-Age", "3600");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}
