import type { Request, Response } from "express";

/**
 * Origins permitted to make cross-origin requests. In production (K_SERVICE is
 * set) only the explicit allowlist is honored. In local dev (emulators) any
 * localhost-like origin is accepted so Vite on any port/interface just works.
 */
const isProduction = !!process.env.K_SERVICE;

const PROD_ORIGINS: string[] = [
  "capacitor://localhost",
  "http://localhost",
  ...(process.env.APP_URL ? [process.env.APP_URL] : []),
];

function isAllowedOrigin(origin: string): boolean {
  if (!isProduction) {
    // Local dev: accept any localhost / 127.0.0.1 origin (any port).
    return (
      origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1") ||
      origin.startsWith("capacitor://")
    );
  }
  return PROD_ORIGINS.includes(origin);
}

/**
 * Apply CORS headers for all incoming requests and handle the preflight OPTIONS request.
 * Returns `true` if the request was a preflight and has been fully handled (the caller should stop);
 * `false` otherwise (continue routing).
 */
export function applyCors(req: Request, res: Response): boolean {
  const origin = req.headers.origin;

  if (origin && isAllowedOrigin(origin)) {
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
