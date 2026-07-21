import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { reconcileAllOrgs } from "../helpers/reconcile.js";

// Nightly usage-counter healer (PAYWALL_PLAN Phase 2/4): recounts every org's
// members/clients/tasks and corrects orgs/{orgId}/usage/current when the
// client-maintained counters have drifted. NOTE: the emulator registers but
// never *fires* schedules — in dev, trigger the same logic on demand via
// POST /orgs/:orgId/reconcile (api.ts).
// us-east4, not us-east5: onSchedule creates its Cloud Scheduler job in the
// function's region, and Cloud Scheduler is not offered in us-east5.
export const reconcileUsage = onSchedule(
  { schedule: "every 24 hours", region: "us-east4" },
  async () => {
    const summary = await reconcileAllOrgs();
    logger.info("usage reconciliation", summary);
  }
);
