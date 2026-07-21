"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueMail = queueMail;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Queue one email for the firestore-send-email extension by writing
 * mail/{id}. Callers pass a DETERMINISTIC id (e.g. `invite-{orgId}-{inviteId}`)
 * so a retriggered function overwrites the same doc instead of double-sending.
 */
async function queueMail(db, id, { to, subject, html, text }) {
    // Shape required by the extension: `to` (array) + `message.{subject,html,text}`.
    await db.doc(`mail/${id}`).set({
        to: [to],
        message: { subject, html, text },
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
}
