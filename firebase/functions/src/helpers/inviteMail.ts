import type { Firestore } from "firebase-admin/firestore";
import { renderInviteEmail } from "../email/inviteEmail.js";
import { appUrl } from "./stripe.js";
import { queueMail } from "./mail.js";

// Invite → email pipeline (the core of the onInviteCreated trigger in
// src/index.ts, kept as a plain exported function so it's directly testable
// against the emulator — same pattern as reconcileOrg; see docs/testing.md).

/** Raw orgs/{orgId}/invites/{inviteId} doc data (untrusted shape). */
export interface InviteDocData {
  email?: unknown;
  role?: unknown;
  status?: unknown;
  locale?: unknown;
  orgName?: unknown; // optional denormalized org name (not written today)
}

/**
 * Queue the invite email for a newly created invite: renders the localized
 * email (invite.locale, 'en' fallback) and writes mail/{invite-{orgId}-{inviteId}}
 * for the firestore-send-email extension. The deterministic mail id makes
 * trigger retries/replays idempotent (the same doc is overwritten). Returns
 * true when a mail doc was queued, false when skipped (non-pending invite —
 * revoked/accepted docs must never email — or no usable email address).
 */
export async function sendInviteEmailFor(
  db: Firestore,
  orgId: string,
  inviteId: string,
  invite: InviteDocData
): Promise<boolean> {
  if (invite.status !== "pending") return false;
  const to = typeof invite.email === "string" ? invite.email : "";
  if (!to) return false;

  // Org name: prefer denormalized data on the invite, else read the org doc.
  let orgName = typeof invite.orgName === "string" ? invite.orgName : "";
  if (!orgName) {
    const org = await db.doc(`orgs/${orgId}`).get();
    const name = org.get("name") as unknown;
    orgName = typeof name === "string" && name ? name : orgId;
  }

  // Same origin the billing redirects use (APP_URL, localhost:5173 in dev);
  // the route is the app's invite-accept page (see app/src/router).
  const inviteUrl = `${appUrl()}/invite/${orgId}/${inviteId}`;

  const rendered = renderInviteEmail({
    orgName,
    role: typeof invite.role === "string" ? invite.role : "",
    inviteUrl,
    locale: typeof invite.locale === "string" ? invite.locale : undefined,
  });
  await queueMail(db, `invite-${orgId}-${inviteId}`, { to, ...rendered });
  return true;
}
