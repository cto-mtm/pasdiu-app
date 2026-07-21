import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

export interface MailContent {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Queue one email doc in `mail/{id}`. Callers pass a DETERMINISTIC id
 * (e.g. `invite-{orgId}-{inviteId}`) so a retriggered function overwrites
 * the same doc instead of double-sending.
 */
export async function queueMail(
  db: Firestore,
  id: string,
  { to, subject, html, text }: MailContent
): Promise<void> {
  await db.doc(`mail/${id}`).set({
    to: [to],
    message: { subject, html, text },
    createdAt: FieldValue.serverTimestamp(),
  });
}
