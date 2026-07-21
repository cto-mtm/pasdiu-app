import type { NextFunction, Request, Response } from "express";
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
export declare function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void>;
