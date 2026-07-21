export { api } from "./api.js";
export declare const reconcileUsage: import("firebase-functions/v2/scheduler").ScheduleFunction;
export declare const onInviteCreated: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    orgId: string;
    inviteId: string;
}>>;
