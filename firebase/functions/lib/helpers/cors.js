"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyCors = applyCors;
// REPLACE_ME — swap example.com for your real web origin(s) before deploying.
// The last two entries are what the iOS/Android (Capacitor) shells send as their
// Origin header. DO NOT DELETE THEM — native API calls fail CORS without them.
const ALLOWED_ORIGINS = [
    "https://example.com",
    "https://www.example.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "capacitor://localhost",
    "http://localhost",
];
/**
 * Apply CORS headers for allow-listed origins and handle the preflight OPTIONS
 * request. Returns `true` if the request was a preflight and has been fully
 * handled (the caller should stop); `false` otherwise (continue routing).
 */
function applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Vary", "Origin");
    }
    res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return true;
    }
    return false;
}
