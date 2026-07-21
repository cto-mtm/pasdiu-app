"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const auth_1 = require("firebase-admin/auth");
/**
 * Express middleware: verify `Authorization: Bearer <Firebase ID token>` and
 * require a verified email (mirrors the app's login gate). On success the
 * decoded token is attached as `req.user`; otherwise the request ends with
 * 401 (missing/invalid token) or 403 (unverified email).
 */
async function requireAuth(req, res, next) {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) {
        res.status(401).json({ error: "Missing Authorization: Bearer <ID token>" });
        return;
    }
    let decoded;
    try {
        decoded = await (0, auth_1.getAuth)().verifyIdToken(token);
    }
    catch {
        res.status(401).json({ error: "Invalid or expired ID token" });
        return;
    }
    if (decoded.email_verified !== true) {
        res.status(403).json({ error: "Email not verified" });
        return;
    }
    req.user = decoded;
    next();
}
