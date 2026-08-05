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
import { DEFAULT_PIPELINE_STAGES, atDueHour, stageDueDates } from "@pasdiu/shared";

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
 *  - o_northlight stays FREE and AT its 3-seat limit ON PURPOSE — it demos
 *    the seat gate + upsell (invites there are denied by the rules).
 */
const FREE_PLAN = { plan: "free", seatLimit: 3, clientLimit: 3, taskLimit: 500, deliverableLimit: 50, subscriptionStatus: "none" };
const STUDIO_PLAN = { plan: "studio", seatLimit: 20, clientLimit: -1, taskLimit: 10000, deliverableLimit: 2000, subscriptionStatus: "active" };

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
    // Free plan, 3 members = AT the seat limit ON PURPOSE: inviting from
    // Northlight demos the seat gate + upsell. Use Pasdiu Studio to demo a
    // working invite flow.
    billing: FREE_PLAN,
    members: [
      { uid: "u_north", role: "admin" },
      { uid: "u_editor", role: "contractor" }, // shared contractor — second workspace
      { uid: "u_editor2", role: "contractor" }, // fills the 3rd free seat
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
  const DEFAULT_PIPELINE = { stages: DEFAULT_STAGES };
  for (const org of ORGS) {
    batch.set(db.doc(`orgs/${org.id}`), {
      name: org.name,
      createdAt: new Date(),
      ownerUid: org.ownerUid,
      ...org.billing,
      pipeline: DEFAULT_PIPELINE,
      defaultCapacityPointsPerDay: 10,
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
        // Capacity points: contractors/pms produce; admins and clients don't.
        capacityPointsPerDay: (m.role === "contractor" || m.role === "pm") ? 10 : 0,
      };
      if (m.clientId) member.clientId = m.clientId;
      batch.set(db.doc(`orgs/${org.id}/members/${m.uid}`), member);
    }
    // Entitlement counters: real counts derived from the seeded arrays below.
    // `seats` counts TEAM members only — client-role reviewers are free and
    // unlimited on every plan, so they never occupy a seat.
    //
    // activeTasks must count the deliverables' STAGE-tasks too. They are task
    // documents like any other, the rules' underTaskLimit gate reads this
    // counter, and counting only the standalone TASKS array left the emulator
    // reporting 12 where 31 documents existed — so the plan gate behaved
    // differently in dev than it does against real data.
    batch.set(db.doc(`orgs/${org.id}/usage/current`), {
      seats: org.members.filter((m) => m.role !== "client").length,
      activeClients: CLIENTS.filter((c) => c.orgId === org.id).length,
      activeTasks:
        TASKS.filter((t) => subGroupOf(t.sg).orgId === org.id).length
        + DELIVERABLES.filter((d) => d.orgId === org.id)
          .reduce((n, d) => n + stagesFor(d).length, 0),
      activeDeliverables: DELIVERABLES.filter((d) => d.orgId === org.id && d.status === "active").length,
    });
  }
  await batch.commit();
}

const now = Date.now();
const days = (n) => new Date(now + n * 86400000);
// Due dates are calendar days, pinned to the shared DUE_HOUR_UTC convention
// (see shared/src/workflow.ts) — the same one the batch endpoint writes, so
// seeded work renders on the intended day in every timezone. `days()` stays
// as-is for true instants: createdAt, completedAt, session start/end times.
const dueDay = (n) => atDueHour(days(n));

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

// The board pages sub-groups: it loads the newest few (highest `order`) and
// offers "load earlier" for the rest. `p_summer` deliberately carries FOUR so
// that path is reachable in local dev — with only two, every project fits on
// the first page and the pagination UI never appears.
const SUBGROUPS = [
  { id: "sg_may", orgId: "o_pasdiu", projectId: "p_summer", name: "May archive", order: 0 },
  { id: "sg_june", orgId: "o_pasdiu", projectId: "p_summer", name: "June archive", order: 1 },
  { id: "sg_reels", orgId: "o_pasdiu", projectId: "p_summer", name: "Instagram Reels", order: 2 },
  { id: "sg_yt", orgId: "o_pasdiu", projectId: "p_summer", name: "YouTube Cutdowns", order: 3 },
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
  // Older batches — off the board's first page until "load earlier" is used.
  { id: "t14", sg: "sg_may", title: "May recap reel", status: "done", assignee: "u_editor", due: -60, order: 0, versions: 1, visible: true },
  { id: "t15", sg: "sg_june", title: "June recap reel", status: "done", assignee: "u_editor2", due: -30, order: 0, versions: 1, visible: true },
  // Standalone tasks are STANDALONE work (deliverableId '') — never a copy of
  // a deliverable's name. The earlier seed titled t1/t2/t4/t11 identically to
  // del_1/del_2/del_4/del_5, which demoed as two "Reel 02"s with different
  // version threads and made the deliverable model look broken.
  { id: "t1", sg: "sg_reels", title: "Reels cover thumbnails", status: "in_progress", assignee: "u_editor", due: 2, order: 0, versions: 2, visible: true },
  { id: "t2", sg: "sg_reels", title: "Caption + hashtag pack", status: "revisions", assignee: "u_editor2", due: 1, order: 1, versions: 3, visible: true },
  { id: "t3", sg: "sg_reels", title: "Music licensing check", status: "backlog", assignee: "u_editor", due: 5, order: 2, versions: 0, visible: false },
  { id: "t4", sg: "sg_yt", title: "Cutdown captions (EN/ES)", status: "approved", assignee: "u_editor2", due: -1, order: 0, versions: 2, visible: true },
  { id: "t5", sg: "sg_yt", title: "30s Cutdown", status: "done", assignee: "u_editor", due: -3, order: 1, versions: 1, visible: true },
  { id: "t6", sg: "sg_hero", title: "Hero Film — Grade", status: "in_progress", assignee: "u_editor2", due: 4, order: 0, versions: 1, visible: false },
  { id: "t7", sg: "sg_hero", title: "Hero Film — Sound mix", status: "blocked", assignee: "u_editor", due: 7, order: 1, versions: 0, visible: false, blockedReason: "Waiting on VO stems from the client's audio vendor." },
  { id: "t8", sg: "sg_tiktok", title: "TikTok 01 — Hook edit", status: "revisions", assignee: "u_editor", due: 1, order: 0, versions: 2, visible: true },
  { id: "t9", sg: "sg_tiktok", title: "TikTok 02 — Trend cut", status: "in_progress", assignee: "u_editor2", due: 3, order: 1, versions: 1, visible: true },
  { id: "t10", sg: "sg_gifs", title: "Newsletter GIF pack", status: "delivered", assignee: "u_editor2", due: -2, order: 0, versions: 1, visible: false, deliveryNote: "Final pack delivered via Drive folder → Marketing/GIFs, handed to Sam." },
  // Northlight Post — the shared contractor (u_editor) has work in BOTH orgs.
  { id: "t11", sg: "sg_spots", title: "Roast reveal mood board", status: "in_progress", assignee: "u_editor", due: 3, order: 0, versions: 1, visible: true },
  { id: "t12", sg: "sg_spots", title: "Spot 02 — Barista story", status: "backlog", assignee: "u_editor", due: 6, order: 1, versions: 0, visible: false },
  { id: "t13", sg: "sg_spots", title: "Spot 03 — Grand opening", status: "revisions", assignee: "u_north", due: 1, order: 2, versions: 2, visible: true },
];

function subGroupOf(sgId) {
  return SUBGROUPS.find((s) => s.id === sgId);
}
// The stages a deliverable actually instantiates as tasks (skipped ones make
// no task). Single source of truth for both the usage counter above and the
// stage-task seeding below, so the two can't drift.
function stagesFor(d) {
  const skip = new Set(d.skipStageIds ?? []);
  return DEFAULT_STAGES.filter((s) => !skip.has(s.id));
}
function clientOf(projectId) {
  return PROJECTS.find((p) => p.id === projectId).clientId;
}

// One plan per deliverable for its stage-tasks: stage, status, assignee, due.
// Single source of truth for BOTH the stage-task docs and the deliverable's
// stageSummary — in production the onTaskWrite trigger keeps the summary
// mirroring the tasks, so seeding them from separate data would ship a
// drifted summary the portal renders from.
const STAGE_STATUSES = ["done", "done", "in_progress", "backlog", "backlog"];
const STAGE_ASSIGNEES = ["u_editor", "u_editor", "u_editor2", "u_editor2", "u_editor"];
function stageTaskPlan(d) {
  const stages = stagesFor(d);
  const stageDue = stageDueDates(stages, dueDay(d.dueInDays), "end");
  return stages.map((stage, si) => ({
    stage,
    si,
    // For delivered deliverables, all stages are done.
    status: d.status === "delivered" ? "done" : STAGE_STATUSES[si],
    assignee: d.orgId === "o_northlight" ? "u_editor" : STAGE_ASSIGNEES[si],
    dueAt: stageDue[si],
  }));
}

// Demo media link for a cut — pasdiu.com placeholders so every "Watch"
// affordance (portal latest-cut button, per-version links) is exercisable.
const cutUrl = (id, v) => `https://pasdiu.com/cuts/${id}-v${v}`;

// Default deliverable types seeded per org.
const DELIVERABLE_TYPES = [
  { id: "dt_longform_pasdiu", orgId: "o_pasdiu", name: "Long-form", weight: 15, order: 0 },
  { id: "dt_short_pasdiu", orgId: "o_pasdiu", name: "Short", weight: 3, order: 1 },
  { id: "dt_clip_pasdiu", orgId: "o_pasdiu", name: "Clip", weight: 1, order: 2 },
  { id: "dt_longform_north", orgId: "o_northlight", name: "Long-form", weight: 15, order: 0 },
  { id: "dt_short_north", orgId: "o_northlight", name: "Short", weight: 3, order: 1 },
  { id: "dt_clip_north", orgId: "o_northlight", name: "Clip", weight: 1, order: 2 },
];

// Default pipeline stages — seeded onto each org AND snapshotted onto each
// deliverable at creation, from the same constant real org creation uses.
const DEFAULT_STAGES = DEFAULT_PIPELINE_STAGES;

// Demo deliverables — a few in Pasdiu Studio to demonstrate the model.
// Each deliverable has stage-tasks that link back via deliverableId + stageId.
//
// `dueInDays` is the deliverable's ANCHOR: its stage deadlines are chained
// backwards from it by the stages' durations (scheduleMode 'end'), exactly as
// the batch endpoint does. Staggering the anchors mirrors a batch created
// across a due window.
//
// `skipStageIds` may only ever name OPTIONAL stages — the endpoint rejects
// skipping a required one, because a required stage with no task reads as the
// deliverable's current stage forever.
const DELIVERABLES = [
  { id: "del_1", orgId: "o_pasdiu", clientId: "c_aurora", projectId: "p_summer", subGroupId: "sg_reels", subGroupName: "Instagram Reels", typeId: "dt_short_pasdiu", name: "Reel 01 — Teaser", status: "active", clientVisible: true, order: 0, versions: 2, dueInDays: 6 },
  { id: "del_2", orgId: "o_pasdiu", clientId: "c_aurora", projectId: "p_summer", subGroupId: "sg_reels", subGroupName: "Instagram Reels", typeId: "dt_short_pasdiu", name: "Reel 02 — Product hero", status: "active", priority: "high", clientVisible: true, order: 1, versions: 3, dueInDays: 9 },
  // Skips the optional Discovery stage: four stage-tasks, not five.
  { id: "del_3", orgId: "o_pasdiu", clientId: "c_aurora", projectId: "p_summer", subGroupId: "sg_reels", subGroupName: "Instagram Reels", typeId: "dt_short_pasdiu", name: "Reel 03 — Testimonial", status: "active", priority: "low", clientVisible: false, order: 2, versions: 0, dueInDays: 12, skipStageIds: ["s_discovery"] },
  { id: "del_4", orgId: "o_pasdiu", clientId: "c_aurora", projectId: "p_summer", subGroupId: "sg_yt", subGroupName: "YouTube Cutdowns", typeId: "dt_longform_pasdiu", name: "60s Cutdown", status: "delivered", clientVisible: true, order: 0, versions: 2, dueInDays: -4, approvedBy: "u_client", approvedVia: "portal", approvalNote: "Looks great — approved!" },
  { id: "del_5", orgId: "o_northlight", clientId: "c_beacon", projectId: "p_roast", subGroupId: "sg_spots", subGroupName: "Launch Spots", typeId: "dt_short_north", name: "Spot 01 — Roast reveal", status: "active", clientVisible: true, order: 0, versions: 1, dueInDays: 8 },
];

// ── Packages — what the agency sold to the client (type × quantity × period).
// The PackageQuota widget on the project board renders these.
const PACKAGES = [
  {
    id: "pkg_summer",
    orgId: "o_pasdiu",
    clientId: "c_aurora",
    projectId: "p_summer",
    name: "Summer Launch — Monthly",
    lines: [
      { typeId: "dt_short_pasdiu", quantity: 8, period: "month" },
      { typeId: "dt_longform_pasdiu", quantity: 2, period: "month" },
    ],
    startsOn: days(-30),
    active: true,
  },
  {
    id: "pkg_q3",
    orgId: "o_pasdiu",
    clientId: "c_northwind",
    projectId: "p_q3",
    name: "Q3 Campaign — Quarterly",
    lines: [
      { typeId: "dt_short_pasdiu", quantity: 12, period: "quarter" },
      { typeId: "dt_clip_pasdiu", quantity: 20, period: "quarter" },
    ],
    startsOn: days(-15),
    active: true,
  },
];

// ── Recording sessions — booked shoots that appear on the CalendarPage.
const SESSIONS = [
  {
    id: "ses_1",
    orgId: "o_pasdiu",
    clientId: "c_aurora",
    projectId: "p_summer",
    name: "Summer Reels — Studio A",
    location: "Studio A, Downtown",
    date: days(3),
    startsAt: days(3),
    endsAt: days(3),
    // Shoots record CAPTURE-stage tasks of deliverables — that's what a
    // session's task list means in the deliverable model.
    taskIds: ["del_1_s_capture", "del_2_s_capture"],
    notes: "Bring extra lighting kits. Talent arrives at 9 AM.",
  },
  {
    id: "ses_2",
    orgId: "o_pasdiu",
    clientId: "c_northwind",
    projectId: "p_q3",
    name: "TikTok batch shoot",
    location: "Northwind HQ rooftop",
    date: days(5),
    startsAt: days(5),
    endsAt: days(5),
    taskIds: ["t8", "t9"],
    notes: "Confirm props delivery the day before.",
  },
  {
    id: "ses_3",
    orgId: "o_northlight",
    clientId: "c_beacon",
    projectId: "p_roast",
    name: "Roast reveal on-location",
    location: "Beacon Coffee flagship, 4th St.",
    date: days(7),
    startsAt: days(7),
    endsAt: days(7),
    taskIds: ["del_5_s_capture"],
    notes: "Barista consent forms needed.",
  },
];

async function seedData() {
  const batch = db.batch();

  for (const c of CLIENTS) batch.set(db.doc(`clients/${c.id}`), { orgId: c.orgId, name: c.name, meta: c.meta });
  for (const p of PROJECTS)
    batch.set(db.doc(`projects/${p.id}`), {
      orgId: p.orgId, clientId: p.clientId, name: p.name, defaultView: p.defaultView, brief: p.brief,
      meta: [{ label: "Budget", value: "$12k" }, { label: "Kickoff", value: "Jun 1" }],
    });
  for (const s of SUBGROUPS)
    batch.set(db.doc(`subGroups/${s.id}`), { orgId: s.orgId, projectId: s.projectId, name: s.name, order: s.order, meta: [] });

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
      dueAt: dueDay(t.due),
      createdAt: days(-10),
      completedAt: done ? days(t.due) : null,
      deliverableId: "",
      stageId: "",
    });
  }
  await batch.commit();

  // Deliverable types
  const dtBatch = db.batch();
  for (const dt of DELIVERABLE_TYPES) {
    dtBatch.set(db.doc(`deliverableTypes/${dt.id}`), { orgId: dt.orgId, name: dt.name, weight: dt.weight, order: dt.order });
  }
  await dtBatch.commit();

  // Deliverables (with stage snapshots, approval fields, and initial stageSummary)
  const delBatch = db.batch();
  for (const d of DELIVERABLES) {
    delBatch.set(db.doc(`deliverables/${d.id}`), {
      orgId: d.orgId,
      clientId: d.clientId,
      projectId: d.projectId,
      subGroupId: d.subGroupId,
      subGroupName: d.subGroupName,
      typeId: d.typeId,
      stages: DEFAULT_STAGES,
      // Mirrors the stage-tasks seeded below (same plan) — the portal and the
      // contact profile render stage progress from this projection, so an
      // empty summary would demo as "no progress" until a task write happens
      // to fire the healing trigger.
      stageSummary: stageTaskPlan(d).map(({ stage, status, assignee, dueAt }) => ({
        stageId: stage.id,
        name: stage.name,
        status,
        assigneeUid: assignee,
        assigneeName: userByUid(assignee).name,
        dueAt,
      })),
      name: d.name,
      status: d.status,
      // Mostly "normal" so the priority chip stays an exception, with one of
      // each extreme to exercise the sort.
      priority: d.priority ?? "normal",
      clientVisible: d.clientVisible,
      // The portal's "Watch the latest cut" button — pasdiu.com placeholder.
      latestVersionUrl: d.versions > 0 ? cutUrl(d.id, d.versions) : "",
      order: d.order,
      meta: [],
      createdAt: days(-10),
      deliveredAt: d.status === "delivered" ? days(-1) : null,
      // Approval attribution — populated on delivered/approved deliverables.
      approvedBy: d.approvedBy ?? "",
      approvedVia: d.approvedVia ?? "",
      approvedAt: d.approvedBy ? days(-1) : null,
      approvalNote: d.approvalNote ?? "",
    });
  }
  await delBatch.commit();

  // Deliverable versions + notes (mirrors the task pattern above).
  for (const d of DELIVERABLES) {
    for (let v = 1; v <= (d.versions || 0); v++) {
      const vid = `v${v}`;
      await db.doc(`deliverables/${d.id}/versions/${vid}`).set({
        label: `v${v}`,
        note: v === d.versions ? "Latest version for review." : "Superseded.",
        createdAt: days(-d.versions + v - 1),
        // Every deliverable version is watchable — superseded cuts stay
        // reviewable in real workflows too.
        mediaUrl: cutUrl(d.id, v),
      });
    }
    // Add a feedback note on the latest version for deliverables with versions.
    if (d.versions >= 1) {
      const latest = `v${d.versions}`;
      await db.doc(`deliverables/${d.id}/notes/n1`).set({
        versionId: latest,
        authorUid: d.orgId === "o_northlight" ? "u_north" : "u_pm",
        body: "Looking good — tighten the intro and check color grade consistency.",
        resolved: false,
        createdAt: days(-1),
      });
    }
  }

  // Stage-tasks: one task per stage per deliverable (mirrors what the batch-
  // create endpoint does). These populate the "Stage tasks" section and make
  // stages clickable.
  //
  // Deadlines come from the SAME stageDueDates() the endpoint uses, chained
  // off each deliverable's anchor — so the demo shows the real per-stage
  // schedule instead of an invented ladder that would drift from production.
  const stBatch = db.batch();
  for (const d of DELIVERABLES) {
    for (const { stage, si, status, assignee, dueAt } of stageTaskPlan(d)) {
      const taskId = `${d.id}_${stage.id}`;
      const done = status === "done" || status === "approved" || status === "delivered";
      stBatch.set(db.doc(`tasks/${taskId}`), {
        orgId: d.orgId,
        title: `${stage.name}: ${d.name}`,
        description: "",
        subGroupId: d.subGroupId,
        projectId: d.projectId,
        clientId: d.clientId,
        status,
        assigneeUid: assignee,
        // The pipeline itself says which stages the client participates in
        // (Review/Approval are clientFacing) — those stage-tasks are shared
        // whenever the deliverable is, so the portal's stage chips link into
        // the Iteration Room like they do for real batch-created work.
        clientVisible: stage.clientFacing === true && d.clientVisible === true,
        blockedReason: "",
        blockedAt: null,
        deliveryNote: "",
        meta: [],
        order: si,
        dueAt,
        createdAt: days(-10),
        completedAt: done ? days(-5 + si) : null,
        deliverableId: d.id,
        stageId: stage.id,
      });
    }
  }
  await stBatch.commit();

  // Packages
  const pkgBatch = db.batch();
  for (const pkg of PACKAGES) {
    pkgBatch.set(db.doc(`packages/${pkg.id}`), {
      orgId: pkg.orgId,
      clientId: pkg.clientId,
      projectId: pkg.projectId,
      name: pkg.name,
      lines: pkg.lines,
      startsOn: pkg.startsOn,
      active: pkg.active,
    });
  }
  await pkgBatch.commit();

  // Recording sessions
  const sesBatch = db.batch();
  for (const ses of SESSIONS) {
    sesBatch.set(db.doc(`sessions/${ses.id}`), {
      orgId: ses.orgId,
      clientId: ses.clientId,
      projectId: ses.projectId,
      name: ses.name,
      location: ses.location,
      date: ses.date,
      startsAt: ses.startsAt,
      endsAt: ses.endsAt,
      taskIds: ses.taskIds,
      notes: ses.notes,
      createdAt: days(-5),
    });
  }
  await sesBatch.commit();

  // Versions + threaded notes on TASKS (separate writes; small volume).
  for (const t of TASKS) {
    for (let v = 1; v <= t.versions; v++) {
      const vid = `v${v}`;
      await db.doc(`tasks/${t.id}/versions/${vid}`).set({
        label: `v${v}`,
        note: v === t.versions ? "Latest cut for review." : "Superseded.",
        createdAt: days(-t.versions + v - 1),
        // Latest cut gets a pasdiu.com placeholder link; superseded ones stay
        // empty so the Iteration Room's no-media poster block stays demoable.
        mediaUrl: v === t.versions ? cutUrl(t.id, v) : "",
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
