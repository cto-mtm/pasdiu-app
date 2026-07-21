import type { Firestore } from "firebase-admin/firestore";
/** Raw orgs/{orgId}/invites/{inviteId} doc data (untrusted shape). */
export interface InviteDocData {
    email?: unknown;
    role?: unknown;
    status?: unknown;
    locale?: unknown;
    orgName?: unknown;
}
/**
 * Queue the invite email for a newly created invite: renders the localized
 * email (invite.locale, 'en' fallback) and writes mail/{invite-{orgId}-{inviteId}}
 * for the firestore-send-email extension. The deterministic mail id makes
 * trigger retries/replays idempotent (the same doc is overwritten). Returns
 * true when a mail doc was queued, false when skipped (non-pending invite —
 * revoked/accepted docs must never email — or no usable email address).
 */
export declare function sendInviteEmailFor(db: Firestore, orgId: string, inviteId: string, invite: InviteDocData): Promise<boolean>;
