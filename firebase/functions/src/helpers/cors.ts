import type { Request, Response } from "express";

/**
 * Apply CORS headers for all incoming requests and handle the preflight OPTIONS request.
 * Returns `true` if the request was a preflight and has been fully handled (the caller should stop);
 * `false` otherwise (continue routing).
 */
export function applyCors(req: Request, res: Response): boolean {
  const origin = req.headers.origin;

  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  } else {
    res.set("Access-Control-Allow-Origin", "*");
  }

  res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, stripe-signature");
  res.set("Access-Control-Max-Age", "3600");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}
