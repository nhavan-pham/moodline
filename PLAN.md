# Social Status App — v1 Implementation Plan

## Context

The user wants a minimal social app where people post only a short status — a bit of text plus one emoji — to broadcast "how I'm doing right now." No long-form posts, photos, or comment threads. Two core values shape every decision below: **privacy** (no personal identity is ever collected, so nothing can leak or be lost) and **emotional safety** (reactions are limited to caring/supportive ones only — no mocking or negative reactions). The working directory is currently empty; this is a from-scratch build.

Confirmed decisions from discussion with the user:
- Web app only for v1.
- Accounts are **anonymous**: username + password only, no email/phone/real name ever stored.
- Status = short text (≤140 chars) + one emoji, expiry duration **chosen per post** (1h / 6h / 24h / "until replaced").
- Social graph is **friends/following**, and profile content is **friends-only** (not truly public) — sensitive statuses like "feeling anxious" shouldn't be visible to strangers.
- Reactions are a **fixed set of 3**: 🥺 Worried about you · 🤗 Sending support · 🎉 Happy for you. No free-for-all emoji picker, no negative reactions.
- No account recovery mechanism in v1 — a clear one-time warning at signup covers the "forgot password = permanent loss" tradeoff instead.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + API | **Next.js 14+ (App Router), TypeScript** | One deployable unit for UI + API/Server Actions, simple Vercel deploy. |
| Styling | **Tailwind CSS** | Fast to build a minimal UI without a design-system dependency. |
| Database | **Postgres** (hosted on **Neon**) | Relational fit for users/statuses/friendships/reactions with FKs and uniqueness constraints; free tier, scale-to-zero. |
| ORM | **Prisma** | Strong TypeScript DX, migrations, `schema.prisma` doubles as living documentation. |
| Auth | **Custom minimal auth**: username + Argon2id-hashed password, server-side `Session` table, session ID in an httpOnly/secure/sameSite cookie. No third-party auth provider (Supabase Auth/Clerk/NextAuth's default providers all assume email or OAuth identity, which we must avoid). | Keeps full control over never touching PII; ~150 lines of well-understood code. |
| Rate limiting | **Upstash Redis + `@upstash/ratelimit`** | Needed since no email verification lowers the cost of spam accounts/posts/friend-request flooding. |
| Expiry cleanup | **Vercel Cron** hitting an internal `/api/cron/cleanup-expired` route (secret-protected), every 5–15 min | Actually deletes expired rows from disk; paired with lazy filtering for instant correctness. |
| Hosting | **Vercel** (app) + **Neon** (DB) + **Upstash** (rate limiting) | Minimal ops, generous free tiers, fits a solo/small-team greenfield project. |

## Data Model (`prisma/schema.prisma`)

Explicitly **never stored**: email, phone, real name, birthdate, OAuth IDs, IP-linked profile data. (IP may be used transiently in Redis for rate limiting, never persisted to Postgres.)

- **User**: `id`, `username` (unique, case-insensitive), `passwordHash`, `createdAt`.
- **Session**: `id` (random token, stored hashed), `userId` → User, `createdAt`, `expiresAt`.
- **Status**: `id`, `userId` → User (`@@unique` as a race-condition backstop), `text` (≤140 chars), `emoji` (single grapheme, validated), `createdAt`, `expiresAt` (nullable = "until replaced").
- **FriendRequest**: `id`, `requesterId` → User, `addresseeId` → User, `status` (PENDING/ACCEPTED/DECLINED), `createdAt`, `respondedAt`. `@@unique([requesterId, addresseeId])`.
- **Reaction**: `id`, `statusId` → Status (`onDelete: Cascade`), `userId` → User, `type` (WORRIED/SUPPORT/HAPPY), `createdAt`. `@@unique([statusId, userId])` (one reaction per user per status).

**"One current status at a time"**: enforced in application logic — creating a new status runs inside a Prisma `$transaction` that deletes the user's existing status (cascading its reactions) then inserts the new one. The DB-level unique constraint on `Status.userId` is a safety net against concurrent double-submits.

**Reactions expire with their status** automatically via cascade delete — no separate cleanup logic needed.

## Key Routes / Endpoints (v1)

**Pages**: `/register`, `/login`, `/` (feed of friends' current statuses), `/u/[username]` (profile), `/requests` (incoming/outgoing friend requests), `/settings` (logout, delete account).

**API / Server Actions**:
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `POST /api/status` (transactional replace), `DELETE /api/status` (clear own status early)
- `GET /api/feed` — friends' non-expired statuses, newest first
- `GET /api/users/[username]` — profile data, gated by friendship (see visibility below)
- `POST /api/friend-requests`, `GET /api/friend-requests`, `PATCH /api/friend-requests/[id]` (accept/decline)
- `POST /api/status/[id]/reactions`, `DELETE /api/status/[id]/reactions` — only allowed between friends
- `POST /api/cron/cleanup-expired` (cron-only, secret header) — bulk-deletes expired statuses, cascading reactions

## Profile Visibility Rules

`/u/[username]` exists for everyone (so people can find and friend-request a known username), but content is gated:
- **Not logged in**: sees only that the username exists, no content.
- **Logged in, not friends**: sees username + "Send friend request" button, no status content.
- **Friends**: sees full current status, expiry countdown, and can react.
- **Self**: always sees and can clear/replace their own status.

A shared `areFriends(userA, userB)` helper (in `lib/friends.ts`) is used by both the profile route and the reaction endpoint to enforce this consistently.

## Status Expiry Enforcement

Two layers, both required:
1. **Lazy filtering** on every read (feed, profile): `WHERE expiresAt > now() OR expiresAt IS NULL`, so a not-yet-swept expired row is never shown.
2. **Cron cleanup** (`/api/cron/cleanup-expired`, every 5–15 min): `DELETE FROM Status WHERE expiresAt IS NOT NULL AND expiresAt < now()`, cascading reactions — this is what actually removes data from disk.

## Build Order

**Execution approach**: implement one milestone at a time. After each numbered milestone below, stop and let the user review/test before starting the next one — do not implement multiple milestones in a single pass.

1. Scaffold: Next.js + TypeScript + Tailwind + Prisma, connect to Neon, base layout, env vars.
2. Data model: write `schema.prisma`, run first migration.
3. Auth core: register/login/logout, session cookie middleware, `getCurrentUser()` helper, password hashing, rate limiting on register/login, the "no recovery" warning UI at signup.
4. Status CRUD: transactional create/replace, delete, "my current status" on own profile.
5. Expiry: lazy filters everywhere + cron route + Vercel Cron config; verify cascade delete.
6. Friend graph: send/accept/decline endpoints, `/requests` page, `areFriends()` helper.
7. Profile page with the four-tier visibility rules above.
8. Feed: query + UI + empty states.
9. Reactions: fixed 3-emoji UI, one-per-user-per-status, friends-only enforcement.
10. Abuse hardening: Upstash rate limits (register per-IP, login per-username with backoff, status posts per-user, friend requests per-user/hour), basic text length/profanity validation on status text.
11. Polish: expiry countdown component, loading/empty states, minimal responsive pass, account deletion flow.
12. Deploy: Vercel + Neon + Upstash wiring, Vercel Cron schedule, end-to-end smoke test.

## Known Risks (accepted for v1, revisit later)

- **No password recovery** — by design; covered by a clear signup-time warning only.
- **Username squatting/impersonation** — no identity verification is possible without collecting PII; accepted tradeoff of the anonymous model.
- **Status text itself can carry harassment** even though reactions are safe — v1 gets basic length/profanity validation; a report/block mechanism is a near-term follow-up, not required for v1.
- **No email means no "new device login" alerts** — mitigate by showing active sessions with manual revoke in `/settings`.

## Verification

- Manual end-to-end walkthrough after each milestone: register two test users, add as friends, post statuses with different expiry durations, confirm feed/profile visibility rules, react with each of the 3 types, confirm reactions and statuses disappear after expiry (both via lazy filter immediately and via cron deletion from the DB).
- `npx prisma studio` to inspect DB state directly and confirm cascade deletes work as expected.
- Run the cron cleanup route manually (`curl` with the secret header) to verify it deletes only truly expired rows.
