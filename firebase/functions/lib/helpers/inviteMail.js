"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendInviteEmailFor = sendInviteEmailFor;
const inviteEmail_js_1 = require("../email/inviteEmail.js");
const stripe_js_1 = require("./stripe.js");
const mail_js_1 = require("./mail.js");
/**
 * Queue the invite email for a newly created invite: renders the localized
 * email (invite.locale, 'en' fallback) and writes mail/{invite-{orgId}-{inviteId}}
 * for the firestore-send-email extension. The deterministic mail id makes
 * trigger retries/replays idempotent (the same doc is overwritten). Returns
 * true when a mail doc was queued, false when skipped (non-pending invite —
 * revoked/accepted docs must never email — or no usable email address).
 */
async function sendInviteEmailFor(db, orgId, inviteId, invite) {
    if (invite.status !== "pending")
        return false;
    const to = typeof invite.email === "string" ? invite.email : "";
    if (!to)
        return false;
    // Org name: prefer denormalized data on the invite, else read the org doc.
    let orgName = typeof invite.orgName === "string" ? invite.orgName : "";
    if (!orgName) {
        const org = await db.doc(`orgs/${orgId}`).get();
        const name = org.get("name");
        orgName = typeof name === "string" && name ? name : orgId;
    }
    // Same origin the billing redirects use (APP_URL, localhost:5173 in dev);
    // the route is the app's invite-accept page (see app/src/router).
    const inviteUrl = `${(0, stripe_js_1.appUrl)()}/invite/${orgId}/${inviteId}`;
    const rendered = (0, inviteEmail_js_1.renderInviteEmail)({
        orgName,
        role: typeof invite.role === "string" ? invite.role : "",
        inviteUrl,
        locale: typeof invite.locale === "string" ? invite.locale : undefined,
    });
    await (0, mail_js_1.queueMail)(db, `invite-${orgId}-${inviteId}`, { to, ...rendered });
    return true;
}
