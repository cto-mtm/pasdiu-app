import type { NextFunction, Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import type { DecodedIdToken } from "firebase-admin/auth";

/** A request that passed requireAuth — `user` is the verified ID token. */
export interface AuthedRequest extends Request {
  user: DecodedIdToken;
}

/**
 * Express middleware: verify `Authorization: Bearer <Firebase ID token>` and
 * require a verified email (mirrors the app's login gate). On success the
 * decoded token is attached as `req.user`; otherwise the request ends with
 * 401 (missing/invalid token) or 403 (unverified email).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Missing Authorization: Bearer <ID token>" });
    return;
  }
  let decoded: DecodedIdToken;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired ID token" });
    return;
  }
  if (decoded.email_verified !== true) {
    res.status(403).json({ error: "Email not verified" });
    return;
  }
  (req as AuthedRequest).user = decoded;
  next();
}
