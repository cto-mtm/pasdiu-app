// Calendar feed — the outward ICS sync (docs: routes/calendar.ts).
//
// POST /orgs/:orgId/calendar-feed follows the standard matrix (401/403/role/
// happy/side-effects + idempotency). GET /calendar/:token is token-authed by
// design — Google Calendar polls it with no Authorization header — so its
// deny legs are 404s (a probe must not learn whether a token exists), and its
// "role" legs assert on feed CONTENT: managers get the org's dated tasks,
// contractors only their own, and undated tasks never appear.
import { beforeEach, describe, expect, it } from "vitest";
import { getFirestore } from "firebase-admin/firestore";
import {
  clearFirestore,
  get,
  getAnon,
  makeUserToken,
  post,
  postAnon,
  seedMember,
  seedOrg,
  seedTask,
} from "./helpers.js";

const ORG = "org-cal";
const OTHER_ORG = "org-cal-other";

async function seedBase() {
  await seedOrg(ORG);
  await seedOrg(OTHER_ORG);
  await seedMember(ORG, "u-cal-admin", "admin");
  await seedMember(ORG, "u-cal-crew", "contractor");
  await seedMember(ORG, "u-cal-client", "client");
  await seedMember(OTHER_ORG, "u-cal-outsider", "admin");
}

async function feedTokenFor(uid: string, email: string): Promise<string> {
  const token = await makeUserToken({ uid, email });
  const res = await post(`/orgs/${ORG}/calendar-feed`, token);
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe("POST /orgs/:orgId/calendar-feed", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedBase();
  });

  it("401 unauthenticated", async () => {
    const res = await postAnon(`/orgs/${ORG}/calendar-feed`);
    expect(res.status).toBe(401);
  });

  it("403 unverified email", async () => {
    const token = await makeUserToken({ uid: "u-cal-unverified", email: "cal-unverified@test.dev", emailVerified: false });
    const res = await post(`/orgs/${ORG}/calendar-feed`, token);
    expect(res.status).toBe(403);
  });

  it("403 wrong org (manager of another org)", async () => {
    const token = await makeUserToken({ uid: "u-cal-outsider", email: "cal-outsider@test.dev" });
    const res = await post(`/orgs/${ORG}/calendar-feed`, token);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_a_member");
  });

  it("403 client role (clients have no schedule)", async () => {
    const token = await makeUserToken({ uid: "u-cal-client", email: "cal-client@test.dev" });
    const res = await post(`/orgs/${ORG}/calendar-feed`, token);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("no_schedule_for_clients");
  });

  it("creates a feed doc and is idempotent per member+org", async () => {
    const token = await makeUserToken({ uid: "u-cal-crew", email: "cal-crew@test.dev" });
    const first = await post(`/orgs/${ORG}/calendar-feed`, token);
    expect(first.status).toBe(200);
    expect(typeof first.body.token).toBe("string");
    expect(first.body.token.length).toBeGreaterThanOrEqual(24);

    // Side-effect: the token doc maps back to exactly this member.
    const doc = await getFirestore().doc(`calendarFeeds/${first.body.token}`).get();
    expect(doc.exists).toBe(true);
    expect(doc.get("uid")).toBe("u-cal-crew");
    expect(doc.get("orgId")).toBe(ORG);

    // Second call returns the SAME token — no doc pileup.
    const second = await post(`/orgs/${ORG}/calendar-feed`, token);
    expect(second.status).toBe(200);
    expect(second.body.token).toBe(first.body.token);
    const all = await getFirestore().collection("calendarFeeds").where("uid", "==", "u-cal-crew").get();
    expect(all.size).toBe(1);
  });
});

describe("GET /calendar/:token", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedBase();
    // Dated tasks for two different assignees, plus one undated task that
    // must never appear in any feed.
    await seedTask(ORG, "t-cal-mine", { assigneeUid: "u-cal-crew", title: "Edit video 7" });
    await seedTask(ORG, "t-cal-other", { assigneeUid: "u-cal-admin", title: "Record video 9" });
    await seedTask(ORG, "t-cal-undated", { assigneeUid: "u-cal-crew", title: "Someday task", dueAt: null });
  });

  it("404 unknown token", async () => {
    const res = await getAnon("/calendar/definitely-not-a-token");
    expect(res.status).toBe(404);
  });

  it("404 after the member leaves the workspace (feed dies with membership)", async () => {
    const feedToken = await feedTokenFor("u-cal-crew", "cal-crew@test.dev");
    await getFirestore().doc(`orgs/${ORG}/members/u-cal-crew`).delete();
    const res = await getAnon(`/calendar/${feedToken}`);
    expect(res.status).toBe(404);
  });

  it("contractor feed: own dated tasks only, as text/calendar (with or without .ics)", async () => {
    const feedToken = await feedTokenFor("u-cal-crew", "cal-crew@test.dev");
    const res = await getAnon(`/calendar/${feedToken}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/calendar");
    const body = res.text;
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("UID:task-t-cal-mine@pasdiu");
    expect(body).toContain("SUMMARY:Edit video 7");
    // Not another member's task, not the undated one.
    expect(body).not.toContain("t-cal-other");
    expect(body).not.toContain("t-cal-undated");

    // The bare-token URL serves the identical feed.
    const bare = await getAnon(`/calendar/${feedToken}`);
    expect(bare.status).toBe(200);
    expect(bare.text).toContain("UID:task-t-cal-mine@pasdiu");
  });

  it("manager feed: every dated task in the org, nothing cross-org", async () => {
    await seedTask(OTHER_ORG, "t-cal-foreign", { title: "Foreign org task" });
    const feedToken = await feedTokenFor("u-cal-admin", "cal-admin@test.dev");
    const res = await getAnon(`/calendar/${feedToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("UID:task-t-cal-mine@pasdiu");
    expect(res.text).toContain("UID:task-t-cal-other@pasdiu");
    expect(res.text).not.toContain("t-cal-undated");
    expect(res.text).not.toContain("t-cal-foreign");
  });

  it("escapes ICS metacharacters in titles", async () => {
    await seedTask(ORG, "t-cal-escape", {
      assigneeUid: "u-cal-crew",
      title: "Cut; splice, render\\ship",
    });
    const feedToken = await feedTokenFor("u-cal-crew", "cal-crew@test.dev");
    const res = await getAnon(`/calendar/${feedToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Cut\\; splice\\, render\\\\ship");
  });

  it("GET with an ID token but no feed relationship still 404s (token is the only credential)", async () => {
    const idToken = await makeUserToken({ uid: "u-cal-admin", email: "cal-admin@test.dev" });
    const res = await get("/calendar/not-a-feed-token", idToken);
    expect(res.status).toBe(404);
  });
});
