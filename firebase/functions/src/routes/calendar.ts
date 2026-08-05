import { randomBytes } from "node:crypto";
import express from "express";
import { getFirestore } from "firebase-admin/firestore";
import { requireAuth } from "../helpers/auth.js";
import { ApiError, asyncHandler, userOf, MANAGER_ROLES } from "../helpers/apiErrors.js";

// Outward-only calendar sync via an iCalendar (ICS) subscription feed.
//
// Model: `calendarFeeds/{token}` maps an unguessable token to { uid, orgId }.
// The token IS the credential — Google/Apple/Outlook poll the feed URL with
// no auth header, so possession of the URL grants read access to the caller's
// task schedule (titles + due dates only). The collection has no rules entry:
// Firestore's default-deny keeps it functions-only.
//
// Managers get every org task with a due date; contractors get their own.
// Client-role members have no schedule and are denied a feed outright.

export const calendarRouter = express.Router();

// ── ICS formatting (RFC 5545) ───────────────────────────────────────────────

// TEXT values: backslash-escape backslash/semicolon/comma, newline → \n.
function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Content lines fold at 75 octets; continuation lines start with a space.
// Folding on character count is slightly conservative vs. octets for
// multi-byte text, which is fine — shorter lines are always legal.
function foldLine(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

function icsDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

interface FeedEvent {
  id: string;
  title: string;
  status: string;
  dueAt: Date;
}

function buildIcs(events: FeedEvent[], now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pasdiu//Task Schedule//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Pasdiu",
  ];
  for (const e of events) {
    // All-day event on the due date (DTEND is exclusive → next day). Due
    // dates render as day-level deadlines in the app, so a timed event would
    // imply a precision the data doesn't have.
    const end = new Date(e.dueAt.getTime() + 86400000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${e.id}@pasdiu`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.dueAt)}`,
      `DTEND;VALUE=DATE:${icsDate(end)}`,
      `SUMMARY:${escapeIcs(e.title)}`,
      `DESCRIPTION:${escapeIcs(`Status: ${e.status}`)}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ── POST /orgs/:orgId/calendar-feed (authed; get-or-create) ─────────────────
// Idempotent: one feed token per member per org. Returns { token }; the app
// builds the subscription URL from its own API base, so the server never has
// to know where it's hosted.
calendarRouter.post(
  "/orgs/:orgId/calendar-feed",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId } = req.params;
    const db = getFirestore();

    const member = await db.doc(`orgs/${orgId}/members/${user.uid}`).get();
    if (!member.exists) throw new ApiError(403, "not_a_member");
    if (member.get("role") === "client") throw new ApiError(403, "no_schedule_for_clients");

    const existing = await db
      .collection("calendarFeeds")
      .where("uid", "==", user.uid)
      .where("orgId", "==", orgId)
      .limit(1)
      .get();
    if (!existing.empty) {
      res.json({ token: existing.docs[0].id });
      return;
    }

    const token = randomBytes(24).toString("base64url");
    await db.doc(`calendarFeeds/${token}`).set({ uid: user.uid, orgId, createdAt: new Date() });
    res.json({ token });
  })
);

// ── GET /calendar/:token (public; token IS the auth) ────────────────────────
// Accepts an optional .ics suffix (some clients insist on the extension).
// Every failure is a plain 404 — a probe must not learn whether a token
// exists, was revoked, or belongs to a removed member.
const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 180;
const FEED_LIMIT = 500;

calendarRouter.get(
  "/calendar/:token",
  asyncHandler(async (req, res) => {
    const token = req.params.token.replace(/\.ics$/, "");
    const db = getFirestore();

    const feed = await db.doc(`calendarFeeds/${token}`).get();
    if (!feed.exists) throw new ApiError(404, "not_found");
    const { uid, orgId } = feed.data() as { uid: string; orgId: string };

    // Membership is re-checked on every poll — removing a member from the
    // workspace kills their feed without any cleanup step.
    const member = await db.doc(`orgs/${orgId}/members/${uid}`).get();
    if (!member.exists) throw new ApiError(404, "not_found");
    const role = member.get("role") as string;
    if (!MANAGER_ROLES.includes(role) && role !== "contractor") throw new ApiError(404, "not_found");

    const now = new Date();
    const from = new Date(now.getTime() - WINDOW_PAST_DAYS * 86400000);
    const to = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86400000);

    let q = db
      .collection("tasks")
      .where("orgId", "==", orgId)
      .where("dueAt", ">=", from)
      .where("dueAt", "<=", to);
    if (!MANAGER_ROLES.includes(role)) q = q.where("assigneeUid", "==", uid);
    const snap = await q.orderBy("dueAt").limit(FEED_LIMIT).get();

    const events: FeedEvent[] = snap.docs.map((d) => ({
      id: d.id,
      title: (d.get("title") as string) ?? "",
      status: (d.get("status") as string) ?? "",
      dueAt: (d.get("dueAt") as FirebaseFirestore.Timestamp).toDate(),
    }));

    res
      .set("Content-Type", "text/calendar; charset=utf-8")
      .set("Cache-Control", "private, max-age=300")
      .send(buildIcs(events, now));
  })
);
