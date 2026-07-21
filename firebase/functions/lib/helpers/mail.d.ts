import type { Firestore } from "firebase-admin/firestore";
export interface MailContent {
    to: string;
    subject: string;
    html: string;
    text: string;
}
/**
 * Queue one email for the firestore-send-email extension by writing
 * mail/{id}. Callers pass a DETERMINISTIC id (e.g. `invite-{orgId}-{inviteId}`)
 * so a retriggered function overwrites the same doc instead of double-sending.
 */
export declare function queueMail(db: Firestore, id: string, { to, subject, html, text }: MailContent): Promise<void>;
