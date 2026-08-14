# Security Posture

Pasdiu handles project management data for creative/production studios —
client information, project details, deliverable content, financial quotes,
and multi-role team collaboration. While not subject to HIPAA, client data
is confidential and org isolation is the primary security concern.

## The architecture IS the security model

- **API gateway:** all business-critical writes flow through the Cloud
  Functions API. Firestore security rules provide defense-in-depth for
  direct client reads (some views read Firestore directly via mappers for
  performance), but role checks on member docs are the primary enforcement.
- **Access control:** Firebase Auth ID tokens. Roles (`admin`, `pm`,
  `contractor`, `client`) live on **member docs**
  (`orgs/{orgId}/members/{uid}`) — NOT on `users/{uid}` (which is
  identity-only). The router reads the role via `useAuthStore`'s live
  member listener.
- **Org isolation:** every Firestore query is scoped by `orgId`. A user can
  belong to multiple orgs, but each request targets exactly one and is
  permission-checked against that org's member doc. Org-switching goes
  exclusively through `liveDoc()` / `activateOrg()` in `stores/auth.ts`.
- **Role enforcement:** routes and rules check role membership. Client-portal
  users see only their own projects/deliverables. Contractors see only what
  they're assigned to. PMs and admins have broader access within their org.
- **Transmission security:** TLS everywhere (platform default). Never put
  client names, project details, or financial data in URLs or query strings.
- **Log hygiene:** log org ids, project ids, and user ids — never client
  names, deliverable content, or quote amounts in plain text logs.

## Data protection principles

- **Org boundary is sacred:** no query may return data from an org the caller
  doesn't belong to. This is enforced in both security rules and API routes.
- **Role-appropriate visibility:** client-portal users never see internal
  notes, contractor rates, or other clients' data.
- **Entitlements never hold data hostage:** a lapsed plan goes read-only
  (writes blocked) but reads and full export stay open forever. Billing gates
  live in `@pasdiu/shared` (`plans.ts`) and are enforced server-side.
- **Soft deletes preferred:** for client-visible data (deliverables, projects),
  prefer soft deletes to preserve audit trails and allow recovery.

## Storage (deliverable assets)

File uploads go to Storage paths scoped by org id, gated by `storage.rules`
checking the caller's org membership. Client-portal downloads are scoped to
the client's own projects only.

## Secrets (Secret Manager)

Set each with `firebase functions:secrets:set <NAME>`:

| Secret | Used by | Notes |
|--------|---------|-------|
| `STRIPE_WEBHOOK_SECRET` | `POST /billing/stripe/webhook` | absent → webhook 400s |
| `STRIPE_SECRET_KEY` | Checkout session creation | absent → checkout 500s |

## Platform checklist (before production)

1. **Blaze plan** — required for Cloud Functions egress.
2. Set the Firebase project id in `.firebaserc` (deploy script refuses while
   the placeholder remains).
3. Hosting site + target configured.
4. Secrets provisioned in Secret Manager (see table above).
5. `app/.env` has `VITE_API_URL` pointing to the deployed function URL.
6. Firestore indexes deployed (`firestore.indexes.json`).
7. Security rules reviewed and deployed (`firebase/firestore.rules`,
   `firebase/storage.rules`).

## Stripe integration

- Webhook endpoint: signature-verified, handles `checkout.session.completed`,
  `invoice.paid`, `customer.subscription.updated`,
  `customer.subscription.deleted`.
- No card numbers stored — Stripe handles all payment data.
- Plan status is derived from webhook events and stored in the org's billing
  doc (plan, status, usage counts — no PII).

## What we do NOT store

- Credit card numbers (Stripe handles all payment data)
- Passwords in our database (Firebase Auth handles credentials)
- Personal data beyond what's necessary for org membership (name, email, role)
