import { FieldValue, getFirestore } from "firebase-admin/firestore";

// Server-side cascade delete for the workspace hierarchy (sub-group / project /
// client). It lives on the Admin SDK for two reasons the client can't work
// around: deliverables are `create, delete: if false` in firestore.rules
// (functions-only), and the usage rule lets managers touch only
// activeClients/activeTasks — never activeDeliverables. A half-client,
// half-server cascade would be non-atomic and could orphan the very
// deliverables/subcollections this exists to remove, so the whole thing runs
// here.

const BATCH_LIMIT = 400; // under Firestore's 500-op cap, leaving counter room

// A doc plus its versions/notes subcollection refs — the two subcollections
// every task and every deliverable carries. listDocuments() returns refs
// without reading the documents, so this stays cheap even for big cascades.
async function withSubcollections(
  ref: FirebaseFirestore.DocumentReference
): Promise<FirebaseFirestore.DocumentReference[]> {
  const [versions, notes] = await Promise.all([
    ref.collection("versions").listDocuments(),
    ref.collection("notes").listDocuments(),
  ]);
  return [...versions, ...notes, ref];
}

export interface CascadeScope {
  orgId: string;
  // Every task/deliverable in the scope being deleted, as query snapshots (we
  // read their deliverableId/status fields to compute the counter deltas).
  taskDocs: FirebaseFirestore.QueryDocumentSnapshot[];
  deliverableDocs: FirebaseFirestore.QueryDocumentSnapshot[];
  // Docs with no subcollections to walk — sub-groups plus the root
  // project/client doc.
  extraRefs: FirebaseFirestore.DocumentReference[];
  // True only for a client delete, so activeClients moves by one.
  clientRemoved?: boolean;
}

export interface CascadeResult {
  taskCount: number;
  deliverableCount: number;
}

// Deletes everything in `scope` in chunked batches and moves the usage
// counters to match. The counter deltas mirror the CREATE paths exactly, which
// is what keeps the live counters from drifting negative:
//   - activeTasks counts ONLY standalone tasks (deliverableId == ''). Stage
//     tasks are gated by the deliverable limit and never incremented
//     activeTasks at creation (see the batch endpoint), so removing them must
//     not decrement it.
//   - activeDeliverables counts only deliverables still 'active' — the same
//     filter reconcile and the batch-create increment use.
export async function cascadeDelete(scope: CascadeScope): Promise<CascadeResult> {
  const db = getFirestore();
  const { orgId, taskDocs, deliverableDocs, extraRefs, clientRemoved } = scope;

  const refGroups = await Promise.all([
    ...taskDocs.map((d) => withSubcollections(d.ref)),
    ...deliverableDocs.map((d) => withSubcollections(d.ref)),
  ]);
  const refs = [...refGroups.flat(), ...extraRefs];

  const standaloneTasks = taskDocs.filter((d) => !d.get("deliverableId")).length;
  const activeDeliverables = deliverableDocs.filter((d) => d.get("status") === "active").length;

  const usagePatch: { [key: string]: FirebaseFirestore.FieldValue } = {};
  if (standaloneTasks) usagePatch.activeTasks = FieldValue.increment(-standaloneTasks);
  if (activeDeliverables) usagePatch.activeDeliverables = FieldValue.increment(-activeDeliverables);
  if (clientRemoved) usagePatch.activeClients = FieldValue.increment(-1);
  const hasCounter = Object.keys(usagePatch).length > 0;
  const usageRef = db.doc(`orgs/${orgId}/usage/current`);
  const patch = usagePatch as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>;

  // Chunked deletes; the counter patch rides in the first chunk so it commits
  // atomically with (at least the first slice of) the docs it accounts for.
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    if (i === 0 && hasCounter) batch.update(usageRef, patch);
    for (const ref of refs.slice(i, i + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
  }
  // extraRefs always carries the root doc, so refs is never empty in practice;
  // this only guards a caller that somehow passes an empty scope with a
  // pending counter move.
  if (!refs.length && hasCounter) await usageRef.update(patch);

  return { taskCount: taskDocs.length, deliverableCount: deliverableDocs.length };
}
