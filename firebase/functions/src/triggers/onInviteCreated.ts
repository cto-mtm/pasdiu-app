import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { sendInviteEmailFor } from "../helpers/inviteMail.js";

// NOTE: this function needs no secrets — invite emails are queued as mail/
// docs and delivered by the firestore-send-email extension, which holds its
// own SMTP credentials (extension config + its SMTP_PASSWORD secret, not here).

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
    if (!event.data) {
      logger.warn("onInviteCreated fired with no event data");
      return;
    }
    const { orgId, inviteId } = event.params;
    const data = event.data.data();
    logger.info("onInviteCreated triggered", {
      orgId,
      inviteId,
      email: typeof data.email === "string" ? data.email : "<missing>",
      status: data.status,
    });
    try {
      const queued = await sendInviteEmailFor(getFirestore(), orgId, inviteId, data);
      if (queued) {
        logger.info("invite email queued", { orgId, inviteId });
      } else {
        logger.warn("invite email was NOT queued (sendInviteEmailFor returned false)", { orgId, inviteId });
      }
    } catch (err) {
      logger.error("invite email failed with exception", { orgId, inviteId, error: String(err) });
    }
  }
);
