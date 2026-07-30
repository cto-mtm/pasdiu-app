import type { Request, Response } from "express";
import { logger } from "firebase-functions/v2";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { AuthedRequest } from "./auth.js";

export const MANAGER_ROLES = ["admin", "pm"];

/**
 * Roles that consume a seat. Client-role members are external reviewers — they
 * are unlimited and free on every plan (BUSINESS_MODEL §3), so they must never
 * count against `usage.seats` or the plan's seatLimit.
 */
export const TEAM_ROLES = ["admin", "pm", "contractor"];

/**
 * Error carrying an HTTP status — thrown inside handlers/transactions.
 * `message` doubles as the machine-readable error code the app switches on;
 * `details` is optional context (validation output, offending ids) echoed
 * alongside it rather than being crammed into the code.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Express 4 does not catch async errors — wrap every async handler. */
export function asyncHandler(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    handler(req, res).catch((err: unknown) => {
      if (err instanceof ApiError) {
        res.status(err.status).json(
          err.details === undefined
            ? { error: err.message }
            : { error: err.message, details: err.details }
        );
        return;
      }
      logger.error("api error", err);
      res.status(500).json({ error: "Internal error" });
    });
  };
}

export function userOf(req: Request): DecodedIdToken {
  return (req as AuthedRequest).user;
}

export function displayNameOf(user: DecodedIdToken): string {
  return (typeof user.name === "string" && user.name) || user.email || "";
}

export function emailOf(user: DecodedIdToken): string {
  return (user.email ?? "").toLowerCase();
}

/** 403 unless the caller has a manager-role membership in the org. */
export async function requireManagerOf(db: Firestore, orgId: string, uid: string): Promise<void> {
  const snap = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (!snap.exists || !MANAGER_ROLES.includes(snap.get("role"))) {
    throw new ApiError(403, "Managers only");
  }
}
