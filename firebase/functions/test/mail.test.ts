// Invite emails — sendInviteEmailFor (the onInviteCreated trigger's core)
// called directly against the emulator, same pattern as reconcileOrg: the
// deployed Firestore trigger isn't running under vitest, so the thin wrapper
// in src/index.ts stays untested here and the plain function carries the
// logic (docs/testing.md). Assertions target the extension-shaped doc the
// firestore-send-email extension consumes: { to: [..], message: {...} }.
import { describe, it, expect, beforeEach } from "vitest";
import { getFirestore } from "firebase-admin/firestore";
import { sendInviteEmailFor } from "../src/helpers/inviteMail.js";
import { clearFirestore, seedOrg, seedInvite } from "./helpers.js";

const ORG = "org-a";
// appUrl() (helpers/stripe.ts) reads APP_URL lazily on every call — drop any
// value inherited from the shell so the expected origin is the default.
delete process.env.APP_URL;
const INVITE_URL = (inviteId: string) => `http://localhost:5173/invite/${ORG}/${inviteId}`;

interface MailMessage {
  subject: string;
  html: string;
  text: string;
}

/** The invite doc as the trigger would receive it (event.data.data()). */
async function inviteData(inviteId: string): Promise<Record<string, unknown>> {
  const snap = await getFirestore().doc(`orgs/${ORG}/invites/${inviteId}`).get();
  return snap.data() ?? {};
}

async function runFor(inviteId: string): Promise<boolean> {
  return sendInviteEmailFor(getFirestore(), ORG, inviteId, await inviteData(inviteId));
}

async function mailSnap(inviteId: string) {
  return getFirestore().doc(`mail/invite-${ORG}-${inviteId}`).get();
}

beforeEach(async () => {
  await clearFirestore();
  await seedOrg(ORG); // org name: "Org org-a"
});

describe("sendInviteEmailFor (onInviteCreated's core)", () => {
  it("queues an extension-shaped mail doc for a pending invite", async () => {
    await seedInvite(ORG, "inv-mail-en", { email: "mail-en@test.dev", role: "pm" });
    const queued = await runFor("inv-mail-en");
    expect(queued).toBe(true);

    const snap = await mailSnap("inv-mail-en");
    expect(snap.exists).toBe(true);
    expect(snap.get("to")).toEqual(["mail-en@test.dev"]);
    expect(snap.get("createdAt")).toBeTruthy();

    const message = snap.get("message") as MailMessage;
    // Subject names the org (read from the org doc — the invite carries no orgName).
    expect(message.subject).toBe(`You're invited to Org ${ORG} on Pasdiu`);
    // HTML: invite link, localized copy, localized role name; plain-URL fallback too.
    expect(message.html).toContain(INVITE_URL("inv-mail-en"));
    expect(message.html).toContain("You've been invited to join");
    expect(message.html).toContain("Project Manager");
    // Text alternative carries the same link.
    expect(message.text).toContain(INVITE_URL("inv-mail-en"));
  });

  it("renders Spanish when the invite carries locale: 'es'", async () => {
    await seedInvite(ORG, "inv-mail-es", { email: "mail-es@test.dev", role: "pm", locale: "es" });
    expect(await runFor("inv-mail-es")).toBe(true);

    const message = (await mailSnap("inv-mail-es")).get("message") as MailMessage;
    expect(message.subject).toBe(`Te han invitado a Org ${ORG} en Pasdiu`);
    expect(message.html).toContain("Gestor de proyecto"); // es role name
    expect(message.html).toContain(INVITE_URL("inv-mail-es"));
  });

  it("falls back to English when the invite has no locale", async () => {
    // seedInvite's default shape has no locale (pre-locale invites still work).
    await seedInvite(ORG, "inv-mail-noloc", { email: "mail-noloc@test.dev" });
    expect(await runFor("inv-mail-noloc")).toBe(true);

    const message = (await mailSnap("inv-mail-noloc")).get("message") as MailMessage;
    expect(message.subject).toBe(`You're invited to Org ${ORG} on Pasdiu`);
  });

  it("prefers the invite's denormalized orgName over the org doc", async () => {
    await seedInvite(ORG, "inv-mail-denorm", { email: "mail-denorm@test.dev", orgName: "Denorm Studio" });
    expect(await runFor("inv-mail-denorm")).toBe(true);

    const message = (await mailSnap("inv-mail-denorm")).get("message") as MailMessage;
    expect(message.subject).toBe("You're invited to Denorm Studio on Pasdiu");
  });

  it("skips a revoked invite (no mail doc)", async () => {
    await seedInvite(ORG, "inv-mail-rev", { email: "mail-rev@test.dev", status: "revoked" });
    expect(await runFor("inv-mail-rev")).toBe(false);
    expect((await mailSnap("inv-mail-rev")).exists).toBe(false);
  });

  it("skips an accepted invite (no mail doc)", async () => {
    await seedInvite(ORG, "inv-mail-acc", { email: "mail-acc@test.dev", status: "accepted" });
    expect(await runFor("inv-mail-acc")).toBe(false);
    expect((await mailSnap("inv-mail-acc")).exists).toBe(false);
  });

  it("is idempotent: a retriggered invite overwrites the same deterministic doc", async () => {
    await seedInvite(ORG, "inv-mail-twice", { email: "mail-twice@test.dev" });
    expect(await runFor("inv-mail-twice")).toBe(true);
    expect(await runFor("inv-mail-twice")).toBe(true);

    const all = await getFirestore().collection("mail").get();
    expect(all.size).toBe(1); // one doc, not two sends
    expect(all.docs[0].id).toBe(`invite-${ORG}-inv-mail-twice`);
  });
});
