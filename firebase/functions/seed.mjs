// Seed the Auth + Firestore emulators with a coherent multi-tenant Pasdiu dataset.
//
//   Run the emulators first (npm run emulators in firebase/), then:
//   npm run seed            (from firebase/)  — or: node seed.mjs (from functions/)
//
// Idempotent: uses fixed document ids and set(), so re-running overwrites
// rather than duplicating. Requires NO credentials — the emulator project id
// is `demo-app`, which runs fully offline.
//
// Multi-tenancy: TWO orgs are seeded so the multi-org scenario stays
// permanently testable — `o_pasdiu` (the original dataset) and `o_northlight`
// (a second studio). `u_editor` is a member of BOTH (the shared-contractor
// scenario that drives the org switcher). users/{uid} docs are identity-only;
// role/clientId live on orgs/{orgId}/members/{uid}.
import admin from "firebase-admin";

// Point the Admin SDK at the emulators (defaults match firebase.json).
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

admin.initializeApp({ projectId: "demo-app" });
const db = admin.firestore();
const auth = admin.auth();

const PASSWORD = "pasdiu123";

/** Auth users: fixed uids so member docs and task assignees line up. */
const USERS = [
  { uid: "u_admin", email: "admin@pasdiu.test", name: "Ava Admin" },
  { uid: "u_pm", email: "pm@pasdiu.test", name: "Paula Ramos" },
  { uid: "u_editor", email: "editor@pasdiu.test", name: "Eddie Cross" },
  { uid: "u_editor2", email: "editor2@pasdiu.test", name: "Nora Vela" },
  { uid: "u_client", email: "client@pasdiu.test", name: "Cleo Marsh" },
  { uid: "u_north", email: "north@pasdiu.test", name: "Nora Northlight" },
];
const userByUid = (uid) => USERS.find((u) => u.uid === uid);

/**
 * Orgs + per-org memberships (role/clientId are PER ORG — u_editor is a
 * contractor in both orgs from a single account). The billing block
 * (plan/limits/subscriptionStatus) is Admin-SDK-only in the rules; the
 * limits here mirror PLAN_LIMITS in src/plans.ts.
 *
 * Plans are deliberately split:
 *  - o_pasdiu is on the paid STUDIO plan → seat room for the invite flow and
 *    a paid-plan org to exercise the paid UI in dev.
 *  - o_northlight stays FREE and AT its 2-seat limit ON PURPOSE — it demos
 *    the seat gate + upsell (invites there are denied by the rules).
 */
const FREE_PLAN = { plan: "free", seatLimit: 2, clientLimit: 3, taskLimit: 500, subscriptionStatus: "none" };
const STUDIO_PLAN = { plan: "studio", seatLimit: 15, clientLimit: 25, taskLimit: 10000, subscriptionStatus: "active" };

const ORGS = [
  {
    id: "o_pasdiu",
    name: "Pasdiu Studio",
    ownerUid: "u_admin",
    billing: STUDIO_PLAN,
    members: [
      { uid: "u_admin", role: "admin" },
      { uid: "u_pm", role: "pm" },
      { uid: "u_editor", role: "contractor" },
      { uid: "u_editor2", role: "contractor" },
      { uid: "u_client", role: "client", clientId: "c_aurora" },
    ],
  },
  {
    id: "o_northlight",
    name: "Northlight Post",
    ownerUid: "u_north",
    // Free plan, 2 members = AT the seat limit ON PURPOSE: inviting from
    // Northlight demos the seat gate + upsell. Use Pasdiu Studio to demo a
    // working invite flow.
    billing: FREE_PLAN,
    members: [
      { uid: "u_north", role: "admin" },
      { uid: "u_editor", role: "contractor" }, // shared contractor — second workspace
    ],
  },
];

async function seedUsers() {
  for (const u of USERS) {
    try {
      // emailVerified: the app enforces verified emails at login; demo accounts
      // are pre-verified so local dev keeps its one-click logins.
      await auth.createUser({ uid: u.uid, email: u.email, password: PASSWORD, displayName: u.name, emailVerified: true });
    } catch (e) {
      if (e.code === "auth/uid-already-exists" || e.code === "auth/email-already-exists") {
        await auth.updateUser(u.uid, { email: u.email, password: PASSWORD, displayName: u.name, emailVerified: true });
      } else throw e;
    }
    // Identity ONLY — no role/clientId here (those live on member docs).
    await db.doc(`users/${u.uid}`).set({ displayName: u.name, email: u.email, createdAt: new Date() });
  }
}

async function seedOrgs() {
  const batch = db.batch();
  for (const org of ORGS) {
    batch.set(db.doc(`orgs/${org.id}`), {
      name: org.name,
      createdAt: new Date(),
      ownerUid: org.ownerUid,
      ...org.billing,
    });
    for (const m of org.members) {
      const u = userByUid(m.uid);
      const member = {
        uid: m.uid,
        orgId: org.id,
        orgName: org.name,
        displayName: u.name,
        email: u.email,
        role: m.role,
        joinedAt: new Date(),
      };
      if (m.clientId) member.clientId = m.clientId;
      batch.set(db.doc(`orgs/${org.id}/members/${m.uid}`), member);
    }
    // Entitlement counters (Phase 2): real counts derived from the seeded
    // arrays below. activeTasks counts ALL live task docs regardless of
    // status — "active" means the doc exists, not that work is in flight.
    // (The Admin SDK bypasses the rules gates, so the demo data seeds fine
    // even where it sits AT a plan limit, e.g. Northlight's seats.)
    batch.set(db.doc(`orgs/${org.id}/usage/current`), {
      seats: org.members.length,
      activeClients: CLIENTS.filter((c) => c.orgId === org.id).length,
      activeTasks: TASKS.filter((t) => subGroupOf(t.sg).orgId === org.id).length,
    });
  }
  await batch.commit();
}

const now = Date.now();
const days = (n) => new Date(now + n * 86400000);

/** Clients → Projects → Sub-Groups → Tasks (+ versions + threaded notes). */
// Every domain doc carries its org's id (required + immutable in the rules).
const CLIENTS = [
  { id: "c_aurora", orgId: "o_pasdiu", name: "Aurora Films",
    meta: [{ label: "Industry", value: "Film & TV" }, { label: "Main contact", value: "Dana Wells" }, { label: "Timezone", value: "PT" }] },
  { id: "c_northwind", orgId: "o_pasdiu", name: "Northwind Media",
    meta: [{ label: "Industry", value: "Advertising" }, { label: "Main contact", value: "Ravi Okonkwo" }] },
  { id: "c_beacon", orgId: "o_northlight", name: "Beacon Coffee",
    meta: [{ label: "Industry", value: "Food & Beverage" }, { label: "Main contact", value: "June Park" }] },
];

const PROJECTS = [
  { id: "p_summer", orgId: "o_pasdiu", clientId: "c_aurora", name: "Summer Launch", defaultView: "kanban",
    brief: { brandGuidelinesUrl: "https://example.com/aurora/brand.pdf", sopUrl: "https://example.com/aurora/sop", links: ["Dropbox master folder", "Music license sheet"],
      fields: [{ label: "Aspect ratio", value: "9:16" }, { label: "Max runtime", value: "30s" }, { label: "Delivery", value: "H.264 / MP4" }] } },
  { id: "p_sizzle", orgId: "o_pasdiu", clientId: "c_aurora", name: "Brand Sizzle", defaultView: "list",
    brief: { brandGuidelinesUrl: "https://example.com/aurora/brand.pdf", sopUrl: "", links: ["Storyboard v2"], fields: [{ label: "Aspect ratio", value: "16:9" }] } },
  { id: "p_q3", orgId: "o_pasdiu", clientId: "c_northwind", name: "Q3 Campaign", defaultView: "kanban",
    brief: { brandGuidelinesUrl: "https://example.com/northwind/brand.pdf", sopUrl: "https://example.com/northwind/sop", links: ["Brand kit", "Voiceover script"], fields: [] } },
  { id: "p_roast", orgId: "o_northlight", clientId: "c_beacon", name: "Roast Reveal", defaultView: "kanban",
    brief: { brandGuidelinesUrl: "https://example.com/beacon/brand.pdf", sopUrl: "", links: ["Shot list"], fields: [{ label: "Aspect ratio", value: "1:1" }] } },
];

const SUBGROUPS = [
  { id: "sg_reels", orgId: "o_pasdiu", projectId: "p_summer", name: "Instagram Reels", order: 0 },
  { id: "sg_yt", orgId: "o_pasdiu", projectId: "p_summer", name: "YouTube Cutdowns", order: 1 },
  { id: "sg_hero", orgId: "o_pasdiu", projectId: "p_sizzle", name: "Hero Film", order: 0 },
  { id: "sg_tiktok", orgId: "o_pasdiu", projectId: "p_q3", name: "TikToks", order: 0 },
  { id: "sg_gifs", orgId: "o_pasdiu", projectId: "p_q3", name: "Newsletter GIFs", order: 1 },
  { id: "sg_spots", orgId: "o_northlight", projectId: "p_roast", name: "Launch Spots", order: 0 },
];

// status ∈ backlog | in_progress | blocked | revisions | approved | delivered | done
// visible → clientVisible: only these tasks appear in the client portal
// (internal work like grades, sound mixes, and backlog stays hidden).
// blocked/delivered document themselves via blockedReason / deliveryNote.
const TASKS = [
  { id: "t1", sg: "sg_reels", title: "Reel 01 — Teaser", status: "in_progress", assignee: "u_editor", due: 2, order: 0, versions: 2, visible: true },
  { id: "t2", sg: "sg_reels", title: "Reel 02 — Product hero", status: "revisions", assignee: "u_editor2", due: 1, order: 1, versions: 3, visible: true },
  { id: "t3", sg: "sg_reels", title: "Reel 03 — Testimonial", status: "backlog", assignee: "u_editor", due: 5, order: 2, versions: 0, visible: false },
  { id: "t4", sg: "sg_yt", title: "60s Cutdown", status: "approved", assignee: "u_editor2", due: -1, order: 0, versions: 2, visible: true },
  { id: "t5", sg: "sg_yt", title: "30s Cutdown", status: "done", assignee: "u_editor", due: -3, order: 1, versions: 1, visible: true },
  { id: "t6", sg: "sg_hero", title: "Hero Film — Grade", status: "in_progress", assignee: "u_editor2", due: 4, order: 0, versions: 1, visible: false },
  { id: "t7", sg: "sg_hero", title: "Hero Film — Sound mix", status: "blocked", assignee: "u_editor", due: 7, order: 1, versions: 0, visible: false, blockedReason: "Waiting on VO stems from the client's audio vendor." },
  { id: "t8", sg: "sg_tiktok", title: "TikTok 01 — Hook edit", status: "revisions", assignee: "u_editor", due: 1, order: 0, versions: 2, visible: true },
  { id: "t9", sg: "sg_tiktok", title: "TikTok 02 — Trend cut", status: "in_progress", assignee: "u_editor2", due: 3, order: 1, versions: 1, visible: true },
  { id: "t10", sg: "sg_gifs", title: "Newsletter GIF pack", status: "delivered", assignee: "u_editor2", due: -2, order: 0, versions: 1, visible: false, deliveryNote: "Final pack delivered via Drive folder → Marketing/GIFs, handed to Sam." },
  // Northlight Post — the shared contractor (u_editor) has work in BOTH orgs.
  { id: "t11", sg: "sg_spots", title: "Spot 01 — Roast reveal", status: "in_progress", assignee: "u_editor", due: 3, order: 0, versions: 1, visible: true },
  { id: "t12", sg: "sg_spots", title: "Spot 02 — Barista story", status: "backlog", assignee: "u_editor", due: 6, order: 1, versions: 0, visible: false },
  { id: "t13", sg: "sg_spots", title: "Spot 03 — Grand opening", status: "revisions", assignee: "u_north", due: 1, order: 2, versions: 2, visible: true },
];

function subGroupOf(sgId) {
  return SUBGROUPS.find((s) => s.id === sgId);
}
function clientOf(projectId) {
  return PROJECTS.find((p) => p.id === projectId).clientId;
}

async function seedData() {
  const batch = db.batch();

  for (const c of CLIENTS) batch.set(db.doc(`clients/${c.id}`), { orgId: c.orgId, name: c.name, meta: c.meta });
  for (const p of PROJECTS)
    batch.set(db.doc(`projects/${p.id}`), {
      orgId: p.orgId, clientId: p.clientId, name: p.name, defaultView: p.defaultView, brief: p.brief,
      meta: [{ label: "Budget", value: "$12k" }, { label: "Kickoff", value: "Jun 1" }],
    });
  for (const s of SUBGROUPS)
    batch.set(db.doc(`subGroups/${s.id}`), { orgId: s.orgId, projectId: s.projectId, name: s.name, order: s.order });

  for (const t of TASKS) {
    const sg = subGroupOf(t.sg);
    const projectId = sg.projectId;
    const clientId = clientOf(projectId);
    const done = t.status === "done" || t.status === "approved" || t.status === "delivered";
    batch.set(db.doc(`tasks/${t.id}`), {
      orgId: sg.orgId,
      title: t.title,
      description: `Deliverable: ${t.title}. Cut, review, and iterate to approval.`,
      subGroupId: t.sg,
      projectId,
      clientId,
      status: t.status,
      assigneeUid: t.assignee,
      clientVisible: t.visible,
      blockedReason: t.blockedReason ?? "",
      blockedAt: t.status === "blocked" ? days(-2) : null,
      deliveryNote: t.deliveryNote ?? "",
      meta: t.versions > 0 ? [{ label: "Format", value: "MP4 / H.264" }] : [],
      order: t.order,
      dueAt: days(t.due),
      createdAt: days(-10),
      completedAt: done ? days(t.due) : null,
    });
  }
  await batch.commit();

  // Versions + threaded notes (separate writes; small volume).
  for (const t of TASKS) {
    for (let v = 1; v <= t.versions; v++) {
      const vid = `v${v}`;
      await db.doc(`tasks/${t.id}/versions/${vid}`).set({
        label: `v${v}`,
        note: v === t.versions ? "Latest cut for review." : "Superseded.",
        createdAt: days(-t.versions + v - 1),
        mediaUrl: "", // placeholder — Iteration Room shows a poster block when empty
      });
    }
    if (t.versions >= 1) {
      const isNorthlight = subGroupOf(t.sg).orgId === "o_northlight";
      const latest = `v${t.versions}`;
      await db.doc(`tasks/${t.id}/notes/n1`).set({
        versionId: latest,
        authorUid: isNorthlight ? "u_north" : "u_pm",
        body: "Tighten the first 2 seconds.",
        resolved: false,
        createdAt: days(-1),
      });
      if (t.status === "revisions" && !isNorthlight) {
        await db.doc(`tasks/${t.id}/notes/n2`).set({
          versionId: latest, authorUid: "u_client", body: "Logo should hold a beat longer.", resolved: false, createdAt: days(-1),
        });
      }
    }
  }
}

await seedUsers();
await seedOrgs();
await seedData();
console.log("✔ Seeded auth users + 2 orgs (o_pasdiu, o_northlight) + Firestore data into the emulators (project demo-app).");
console.log("  editor@pasdiu.test belongs to BOTH orgs — use it to demo the org switcher.");
console.log("  Login with any of:", USERS.map((u) => u.email).join(", "), `(password: ${PASSWORD})`);
process.exit(0);
