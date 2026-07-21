import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { sendInviteEmailFor } from "../helpers/inviteMail.js";

// NOTE: this function needs no secrets — invite emails are queued as mail/
// docs and delivered by the firestore-send-email extension, which holds its
// own credentials (RESEND_API_KEY lives in the extension config, not here).

// Invite email: when a manager creates an invite (client-side write, gated by
// firestore.rules), render the localized email and queue it as a `mail` doc
// for the firestore-send-email extension (prod-only; see README "Invite
// emails"). Thin wrapper — the logic lives in helpers/inviteMail.ts as a
// plain function so integration tests call it directly (docs/testing.md).
export const onInviteCreated = onDocumentCreated(
  {
    document: "orgs/{orgId}/invites/{inviteId}",
    region: "us-east5",
  },
  async (event) => {
    if (!event.data) return;
    const { orgId, inviteId } = event.params;
    const queued = await sendInviteEmailFor(getFirestore(), orgId, inviteId, event.data.data());
    if (queued) logger.info("invite email queued", { orgId, inviteId });
  }
);
