# Workspaces, Billing Portal & Payments — Design

**Product:** **KriJaxAutomation** (formerly Astreus Tech Tester Tool), made by KriJax Software and Development. Internal identifiers (`qaflow`, the `astreus` Postgres schema, `astreus-` function prefixes, `ASTREUS_*` env names) are deliberately unchanged — renaming them would orphan data and break the shared-project isolation rules.
**Goal:** Let KriJax sell the tool to other companies. Each company gets an isolated **workspace** inside the one shared Supabase deployment; KriJax provisions companies, sets plans, invoices them, and collects card payments from a **web billing portal**.

Decisions made with the owner on 2026-08-27:
- Companies are **provisioned by KriJax** in the web portal (no self-signup, no invite codes). The desktop app has **no** vendor admin screen.
- **One workspace per user** (no switcher). Roles: **Owner / Admin / Member**.
- **Plan + price per workspace, enforced seat/project limits, manual invoices, suspend/reactivate, and Stripe card payments.**
- Portal is a **Vite + React SPA, self-hosted by KriJax** as a static bundle; its backend is Supabase Edge Functions in the existing project.
- Tenant isolation = shared tables scoped by `workspaceId` (approach A), preserving the binding "Astreus owns exactly one Postgres schema (`astreus`)" rule.

## Decomposition (build in this order)

| # | Sub-project | Depends on | Delivers |
|---|---|---|---|
| 1 | **Desktop workspaces** | — | schema + migration, scoped store, membership resolution, roles, limits, Workspace screen, gate screens, branding |
| 2 | **KriJax Billing Portal** | 1 | `astreus-admin` edge function, portal SPA: provisioning, plans/prices, manual invoices, suspend/reactivate |
| 3 | **Stripe payments** | 2 | payment links per invoice, `astreus-stripe-webhook`, auto mark-paid + reactivate |

Each gets its own implementation plan. 1 is shippable alone (KriJax provisions via a seed script until 2 lands).

---

## Sub-project 1 — Desktop workspaces

### 1.1 Data model (Prisma, `astreus` schema)

```prisma
model Workspace {
  id            String   @id            // "ws-<slug>"
  name          String
  slug          String   @unique
  plan          String   @default("free")   // free | team | business | vendor
  maxMembers    Int?                        // null = unlimited
  maxProjects   Int?                        // null = unlimited
  status        String   @default("active") // active | suspended
  // billing (owned by sub-project 2/3, columns created now to avoid a second migration)
  pricePerMonth Decimal? @db.Decimal(10, 2)
  currency      String   @default("PHP")
  billingEmail  String?
  stripeCustomerId String?
  createdAt     DateTime
  updatedAt     DateTime
  members       WorkspaceMember[]
  invoices      Invoice[]
}

model WorkspaceMember {
  id          String    @id
  workspaceId String
  email       String                      // lower-cased; the invite key
  userId      String?                     // Supabase auth uid, filled on first login ("claim")
  role        String                      // owner | admin | member
  createdAt   DateTime
  joinedAt    DateTime?
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@unique([workspaceId, email])
  @@index([userId])
}

model Invoice {
  id            String    @id            // "inv-<yyyymm>-<slug>-<n>"
  workspaceId   String
  periodStart   DateTime
  periodEnd     DateTime
  amount        Decimal   @db.Decimal(10, 2)
  currency      String
  status        String    @default("draft") // draft | sent | paid | overdue | void
  dueDate       DateTime
  paidAt        DateTime?
  paymentMethod String?                   // manual | stripe
  stripeCheckoutId String?
  notes         String?
  createdAt     DateTime
  updatedAt     DateTime
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, status])
}
```

Every tenant table gains `workspaceId String @default("ws-krijax")` + `@@index([workspaceId])`: `Project`, `Suite`, `Run`, `Ticket`, `CredentialProfile`, `Schedule`. The default makes the migration additive — existing rows land in KriJax's house workspace.

`TicketCounter` becomes per-workspace (each company gets its own `BUG-1, BUG-2…`):

```prisma
model TicketCounter {
  id          Int    @id @default(autoincrement())
  workspaceId String @unique @default("ws-krijax")
  value       Int    @default(0)
}
```

Deployment stays `npm run db:push`. The schema-drift test's expected `astreus` table set grows from 7 to 10 (`Workspace`, `WorkspaceMember`, `Invoice`); public-schema assertions unchanged.

### 1.2 Migration of existing data

After `db:push`, the new idempotent `npm run db:seed-workspaces`:
1. upserts `Workspace { id: "ws-krijax", name: "KriJax", slug: "krijax", plan: "vendor", limits null }`;
2. upserts an **owner** `WorkspaceMember` for every email in `ASTREUS_PLATFORM_ADMINS`.

Safety net: a platform admin who signs in with no membership gets a KriJax owner membership created on the spot — the vendor can never lock themselves out.

### 1.3 Identity → workspace resolution

`.env` gains `ASTREUS_PLATFORM_ADMINS=<comma-separated emails>` (KriJax staff). Main process, after Supabase sign-in:
1. `resolveMembership({ userId, email })` — by `userId`; else by `email`, **claiming** it (set `userId`, `joinedAt`).
2. None + platform admin → `ensureVendorWorkspace(email)`, resolve again.
3. Session `tenant = { workspaceId, role, platformAdmin }`, cleared on logout.
4. `auth:status` / `auth:changed` payloads gain `workspace: { id, name, plan, status } | null`, `role`, `platformAdmin`.

Renderer gate (`App.jsx`): signed in with `workspace === null` → **NoWorkspace** screen ("You're signed in as x@y but not a member of any workspace yet — ask your administrator.") with Sign out. `status === "suspended"` → **Suspended** screen ("This workspace is suspended — contact KriJax Software and Development.") with Sign out. Both are checked again on every `auth:changed`, so a suspension from the portal takes effect at the member's next launch/refresh.

### 1.4 Store scoping — enforced in one place

`createCloudStore({ prisma, supabase, localStore, getWorkspaceId })`. Every tenant method: reads add `where: { workspaceId }` (lists) or `findFirst({ where: { id, workspaceId } })` (gets — a foreign row is simply "not found"); writes stamp `workspaceId` and constrain updates/deletes on it (`updateMany`/`deleteMany` with `{ id, workspaceId }`); `getWorkspaceId() === null` throws `Error('No active workspace')`. `nextTicketId()` upserts `TicketCounter` by `workspaceId`. `runDir`, credential blobs and settings stay device-local and unscoped.

`saveProject` on **create** checks `count(workspace projects) < maxProjects` when non-null, else throws `Error('Project limit reached for your plan (N). Contact KriJax to upgrade.')`.

The v1 JSON store is untouched — tests and the no-cloud fallback keep running as a single implicit workspace. The REST API needs no change: it uses the same scoped store.

### 1.5 Workspace service + roles (engine, pure Node)

`src/engine/workspaces.js` → `createWorkspaceService({ prisma, supabase, platformAdminEmails })`:

| Method | Caller | Behavior |
|---|---|---|
| `resolveMembership({ userId, email })` | main | §1.3 lookup + claim |
| `ensureVendorWorkspace(email)` | main | §1.2 safety net |
| `getWorkspace(id)` / `usage(id)` | main | workspace row; `{ members, maxMembers, projects, maxProjects }` |
| `listMembers(workspaceId)` | any member | |
| `inviteMember(workspaceId, { email, role })` | owner/admin | enforces `maxMembers`; creates login if needed (below) |
| `changeRole(workspaceId, memberId, role)` | owner/admin | admins cannot grant owner; last owner cannot be demoted |
| `removeMember(workspaceId, memberId)` | owner/admin | last owner cannot be removed |
| `renameWorkspace(id, name)` | owner | |
| `deleteWorkspace(id)` | owner | cascades members/invoices; tenant rows via `deleteMany({ workspaceId })` |

The same module exposes the **provisioning** primitives the portal's edge function mirrors in SQL (§2.2): `createWorkspace`, `updateWorkspace`, `listWorkspaces` — kept here so the seed script and tests can drive them from Node.

**Creating a login for an invited email:** `supabase.auth.admin.createUser({ email, password: <generated 16-char>, email_confirm: true })` with the existing service-role client. The temporary password is **returned once** for hand-off and never stored. "Already registered" → no password; the existing account claims the membership at first login. Emails lower-cased everywhere.

`src/engine/roles.js`: `can(role, action)` for `invite`, `remove_member`, `change_role`, `edit_workspace`, `delete_workspace`, `delete_project`. Owner: all. Admin: all but `delete_workspace`. Member: none of these (all QA actions remain open to members).

### 1.6 IPC + renderer

Channels (behind the signed-in guard, plus `requireRole` where marked): `workspace:current`, `workspace:members:list`, `workspace:members:invite` (owner/admin → `{ member, tempPassword|null }`), `workspace:members:changeRole`, `workspace:members:remove` (owner/admin), `workspace:rename`, `workspace:delete` (owner). `projects:remove` additionally requires `delete_project`.

Renderer: **product rename** — every user-visible "Astreus Tech Tester Tool" string (window title, sidebar wordmark, login, Settings/About, README/docs/Guide, installer `productName`) becomes **"KriJaxAutomation"**; the sidebar shows the workspace name under the wordmark and a footer line **"Made by KriJax Software and Development"**; nav gains **Workspace** (`#/workspace`): plan card with usage bars, members table with role chips, owner/admin controls (Invite → one-time temp-password dialog with Copy; role dropdown; Remove with confirm), owner-only Rename and Delete (typed confirmation); members see it read-only. Login footer and Settings → About carry the vendor line; the Account card shows "Workspace: <name> · <role>". Refusals surface as toasts with the error's message.

### 1.7 Testing (sub-project 1)

`test/roles.test.js` (offline matrix). `test/workspaces.test.js` (live, skips without `DATABASE_URL`, `astreus-test-` rows cleaned in `finally`): create workspace + owner; invite enforces `maxMembers`; claim-by-email; last-owner protections; stranger resolves null; `createUser` against `astreus-test-<rand>@example.invalid`, deleted via `auth.admin.deleteUser`. `test/cloud-store.test.js`: two workspaces — A's rows invisible to B, independent ticket ids, `maxProjects` enforced. `test/cloud-db.test.js`: 10 tables. Smoke stays green with no `.env`. Manual E2E: seed a "Golden Paws Co." workspace + owner → sign in as owner in a second instance → invite a member → confirm no KriJax data is visible.

---

## Sub-project 2 — KriJax Billing Portal (web)

### 2.1 Shape

A separate Vite + React SPA at `portal/` in this repo (same Tailwind tokens and shadcn-style primitives copied from the renderer for one visual family; **arrow functions only**). Static build output (`portal/dist`) that KriJax self-hosts anywhere that serves static files. Only platform admins can use it — it is not for customers.

Auth: supabase-js in the browser with the **publishable** key; the admin signs in with the same Supabase account as the desktop app. The SPA never holds the service-role key.

### 2.2 Backend: `astreus-admin` Edge Function

All privileged work goes through one Supabase Edge Function deployed to the existing project, named with the `astreus-` prefix to respect the shared-project isolation rule:

- **Auth check:** reads the caller's JWT, resolves the user with supabase-js, and requires `email ∈ ASTREUS_PLATFORM_ADMINS` (function secret). Anything else → 403.
- **DB access:** the Deno `postgres` driver against `DATABASE_URL` with `search_path = astreus` — no PostgREST exposure of the schema, no RLS needed. SQL mirrors the Prisma models; a comment in both places says "keep in sync with schema.prisma".
- **Actions** (JSON `{ action, ...params }` → JSON): `workspaces.list` (with member/project counts and outstanding invoice totals), `workspaces.create` (workspace + owner membership + owner login via `auth.admin.createUser`, returning the one-time temp password), `workspaces.update` (name, plan, limits, price, currency, billingEmail), `workspaces.suspend` / `workspaces.reactivate`, `workspaces.delete`, `members.list/invite/changeRole/remove` (same rules as §1.5, for support), `invoices.list`, `invoices.create` (period, amount defaults from `pricePerMonth`, due date), `invoices.markSent/markPaid/markOverdue/void`, `invoices.generateMonthly` (one draft per active paid-plan workspace for the chosen month, skipping ones that already exist).
- Secrets: `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ASTREUS_PLATFORM_ADMINS` — set as function secrets, never in the SPA bundle.

### 2.3 Portal screens

- **Sign in** (platform admins only; a non-admin sees "This portal is for KriJax staff").
- **Companies** — table: name, plan, status chip, members/limit, projects/limit, price, outstanding balance, last invoice. Row → **Company detail**: edit plan/limits/price/currency/billing email; Suspend/Reactivate; members (support view); invoices tab; Delete (typed confirmation). **New company** form → one-time owner temp-password dialog.
- **Invoices** — all invoices with status filters; **Generate this month's invoices**; per-row mark Sent/Paid/Overdue/Void; "Copy payment link" (sub-project 3).
- **Dashboard** — MRR (sum of active `pricePerMonth`), active/suspended counts, overdue total.

### 2.4 Testing (sub-project 2)

Edge function unit tests with Deno's test runner against the SQL helpers (skipped without `DATABASE_URL`); a Node integration test that calls the deployed function with a platform-admin JWT is manual (documented). Portal: component tests for the invoice state machine (`draft → sent → paid|overdue|void`), plus a manual E2E: provision "Golden Paws Co.", generate an invoice, mark paid, suspend, confirm the desktop app shows the Suspended screen.

---

## Sub-project 3 — Stripe payments

- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` as function secrets.
- `astreus-admin` gains `invoices.createPaymentLink`: creates (or reuses `stripeCustomerId`) a Stripe Customer, then a **Stripe Checkout Session** for the invoice amount with `metadata.invoiceId`; stores `stripeCheckoutId`; returns the hosted URL. KriJax sends that link to the customer — customers never log into the portal.
- New `astreus-stripe-webhook` Edge Function: verifies the signature, on `checkout.session.completed` marks the invoice `paid` (`paymentMethod: "stripe"`, `paidAt`) and, if the workspace was suspended for non-payment, **reactivates** it. Idempotent on repeated events.
- Portal: "Copy payment link" on unpaid invoices; paid-by-Stripe badge; payment history on Company detail.
- Testing: Stripe CLI `stripe listen`/`trigger checkout.session.completed` against a local function run; webhook idempotency test.

---

## Error handling (all sub-projects)

No membership / suspended → gate screens, never a blank window. Limit reached → actionable message naming the limit. Last-owner protections → refused with a clear message. `createUser` failures other than "already registered" surface verbatim and leave no half-provisioned state. Edge function errors return `{ error }` with the proper status; the portal toasts them. Cloud boot failure keeps the desktop's local fallback.

## Out of scope

Workspace switching / multi-membership, self-signup or invite codes, per-workspace branding, Postgres RLS (isolation lives in the single store layer + the admin function; the service key never reaches clients), audit logs, emailed invites/invoices (links and temp passwords are handed over out-of-band), tax/VAT handling, refunds via the portal, customer-facing billing pages.

---

## Backlog — sub-projects 4–7 (requested 2026-09-03, to be brainstormed/specced after 1–3)

| # | Sub-project | Depends on | One-line scope |
|---|---|---|---|
| 4 | **Media storage policy** | 1, 2 | Screenshots/videos stay on the customer's device by default; cloud media is a paid plan add-on (`Workspace.cloudMedia` flag set from the portal). First run asks the customer where evidence should live and explains the cost; the cloud store only uploads when the flag is on, otherwise runs keep local media and `Open Folder` works as in v1. |
| 5 | **Scripting templates (Playwright)** | 1 | A "script" suite type alongside recorded suites: the QA writes/pastes a Playwright script from starter templates (login, CRUD, form validation, API-route check); the runner executes it in the same evidence-capturing harness (video, screenshots, console/network, security audit). |
| 6 | **PDF reports + Excel manual test scripts** | 1 | Report Builder gains a PDF export (same content as the Excel report, branded KriJaxAutomation); Excel import/export of manual test cases (step / expected / actual / status) so manual testing lives beside automated suites. |
| 7 | **SaaS polish** | 1–6 | Performance pass (startup, list virtualization for big workspaces), UI refinements across screens, and the auto-update channel already in place is kept as the delivery path. |

Each will get its own brainstorm → spec section → plan, in that order, once sub-project 1 is merged and sub-project 2 (the portal the owner asked to start next) is delivered.
