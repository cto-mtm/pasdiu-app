import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { rebuildLatestVersion } from "../helpers/deliverableProjections.js";

// Trigger: when a version is added/edited/removed under a deliverable,
// re-stamp latestVersionUrl/latestVersionLabel on the deliverable doc from
// the newest version by createdAt. Versions are written from the Iteration
// Room via the client SDK, which cannot touch the deliverable doc itself
// (firestore.rules) — without this trigger the portal's "Watch the latest
// cut" button freezes at whatever the batch endpoint or seed wrote.
// The rebuild lives in helpers/deliverableProjections.ts so tests can drive
// it directly (the one-shot suite runs without the functions emulator).

export const onVersionWrite = onDocumentWritten(
  {
    document: "deliverables/{deliverableId}/versions/{versionId}",
    region: "us-east5",
  },
  async (event) => {
    const { deliverableId, versionId } = event.params;

    const result = await rebuildLatestVersion(getFirestore(), deliverableId);
    if (!result.updated) {
      logger.warn("onVersionWrite: deliverable not found, skipping", {
        deliverableId,
        versionId,
      });
      return;
    }

    logger.info("latestVersion updated", { deliverableId, versionId });
  }
);
