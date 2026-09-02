# Moodline App — v1 Implementation Plan

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

Frontend and backend are now **two separate services** in one repo (`/frontend`, `/backend`), talking over a JSON REST API.

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite, TypeScript** (SPA, React Router for `/`, `/login`, `/register`, `/u/:username`, `/requests`, `/settings`) | Plain SPA calling an external API — no server-rendering complexity to coordinate across two languages/runtimes. |
| Styling | **Tailwind CSS** | Fast to build a minimal UI without a design-system dependency. |
| Backend | **FastAPI (Python)** | Async, Pydantic-based request/response validation, automatic OpenAPI docs — a good fit for a small JSON REST API. |
| Database | **Postgres** (hosted on **Neon**) | Relational fit for users/statuses/friendships/reactions with FKs and uniqueness constraints; free tier, scale-to-zero. |
| ORM | **SQLModel** (SQLAlchemy + Pydantic, by the FastAPI author) + **Alembic** for migrations | One model definition serves as both the DB table and the API schema; Alembic handles versioned migrations. |
| Auth | **Custom minimal auth**: username + Argon2id-hashed password (`argon2-cffi`), server-side `Session` table, session ID in an httpOnly, Secure, **`SameSite=None`** cookie (required since frontend and backend are on different origins). FastAPI's `CORSMiddleware` configured with the exact frontend origin + `allow_credentials=True` (cannot use `*` once credentials are involved). No third-party auth provider — all assume email/OAuth identity, which we must avoid. | Keeps full control over never touching PII; cross-site cookie is the standard way to keep the session token out of frontend JS entirely (avoids JWT-in-localStorage XSS exposure). |
| Rate limiting | **`slowapi`** (FastAPI-compatible) backed by **Upstash Redis** | Needed since no email verification lowers the cost of spam accounts/posts/friend-request flooding; Redis backing keeps limits consistent if the backend scales beyond one instance. |
| Expiry cleanup | A standalone script (`backend/app/jobs/cleanup_expired.py`) run on a schedule by the **hosting provider's cron job feature** (e.g. Render Cron Job / Railway Cron), talking to the DB directly — no public HTTP endpoint needed for this. | Removes an entire attack surface (no secret-protected endpoint to guess/replay) compared to the earlier Next.js design; paired with lazy filtering for instant read-time correctness. |
| Hosting | **Vercel** (frontend static build) + **Render or Railway** (FastAPI backend + Postgres + cron job, one provider for all three) + **Upstash** (Redis for rate limiting) | Keeps the backend, DB, and its cron job on one provider for simplicity; frontend stays on Vercel since it's just a static SPA build. |

## Data Model (`backend/app/models.py`, SQLModel classes)

Explicitly **never stored**: email, phone, real name, birthdate, OAuth IDs, IP-linked profile data. (IP may be used transiently in Redis for rate limiting, never persisted to Postgres.)

- **User**: `id`, `username` (unique, case-insensitive), `password_hash`, `created_at`.
- **Session**: `id` (random token, stored hashed), `user_id` → User, `created_at`, `expires_at`.
- **Status**: `id`, `user_id` → User (unique constraint as a race-condition backstop), `text` (≤140 chars), `emoji` (single grapheme, validated), `created_at`, `expires_at` (nullable = "until replaced").
- **FriendRequest**: `id`, `requester_id` → User, `addressee_id` → User, `status` (PENDING/ACCEPTED/DECLINED enum), `created_at`, `responded_at`. Unique constraint on `(requester_id, addressee_id)`.
- **Reaction**: `id`, `status_id` → Status (`ON DELETE CASCADE`), `user_id` → User, `type` (WORRIED/SUPPORT/HAPPY enum), `created_at`. Unique constraint on `(status_id, user_id)` (one reaction per user per status).

**"One current status at a time"**: enforced in application logic — creating a new status runs inside a SQLAlchemy/SQLModel session transaction that deletes the user's existing status (cascading its reactions) then inserts the new one. The DB-level unique constraint on `Status.user_id` is a safety net against concurrent double-submits.

**Reactions expire with their status** automatically via `ON DELETE CASCADE` — no separate cleanup logic needed.

## Key Routes / Endpoints (v1)

**Frontend routes (React Router)**: `/register`, `/login`, `/` (feed of friends' current statuses), `/u/:username` (profile), `/requests` (incoming/outgoing friend requests), `/settings` (logout, delete account).

**Backend API (FastAPI routers)**:
- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`
- `POST /status` (transactional replace), `DELETE /status` (clear own status early)
- `GET /feed` — friends' non-expired statuses, newest first
- `GET /users/{username}` — profile data, gated by friendship (see visibility below)
- `POST /friend-requests`, `GET /friend-requests`, `PATCH /friend-requests/{id}` (accept/decline)
- `POST /status/{id}/reactions`, `DELETE /status/{id}/reactions` — only allowed between friends

(No public cleanup endpoint — expiry cleanup runs as a direct DB script on a schedule, see Tech Stack table.)

## Profile Visibility Rules

`/u/:username` exists for everyone (so people can find and friend-request a known username), but content is gated:
- **Not logged in**: sees only that the username exists, no content.
- **Logged in, not friends**: sees username + "Send friend request" button, no status content.
- **Friends**: sees full current status, expiry countdown, and can react.
- **Self**: always sees and can clear/replace their own status.

A shared `are_friends(user_a, user_b)` helper (in `backend/app/services/friends.py`) is used by both the profile route and the reaction endpoint to enforce this consistently.

## Status Expiry Enforcement

Two layers, both required:
1. **Lazy filtering** on every read (feed, profile): `WHERE expires_at > now() OR expires_at IS NULL`, so a not-yet-swept expired row is never shown.
2. **Scheduled cleanup script** (`backend/app/jobs/cleanup_expired.py`, run every 5–15 min by the hosting provider's cron feature): `DELETE FROM status WHERE expires_at IS NOT NULL AND expires_at < now()`, cascading reactions via the DB foreign key — this is what actually removes data from disk.

## Build Order

**Execution approach**: implement one milestone at a time. After each numbered milestone below, stop and let the user review/test before starting the next one — do not implement multiple milestones in a single pass.

1. Scaffold: `/frontend` (Vite + React + TypeScript + Tailwind) and `/backend` (FastAPI + SQLModel + Alembic) as two projects in the repo; connect backend to Neon Postgres; base layout/routing on the frontend; env vars for both.
2. Data model: write SQLModel classes in `backend/app/models.py`, run first Alembic migration.
3. Auth core: register/login/logout endpoints, Argon2id password hashing, session table + httpOnly `SameSite=None` cookie, CORS middleware configured for the frontend origin with credentials, `get_current_user()` FastAPI dependency, rate limiting on register/login, the "no recovery" warning UI at signup.
4. Status CRUD: transactional create/replace, delete, "my current status" on own profile.
5. Expiry: lazy filters everywhere + `cleanup_expired.py` script + hosting provider's cron job config; verify cascade delete.
6. Friend graph: send/accept/decline endpoints, `/requests` page, `are_friends()` helper.
7. Profile page with the four-tier visibility rules above.
8. Feed: query + UI + empty states.
9. Reactions: fixed 3-emoji UI, one-per-user-per-status, friends-only enforcement.
10. Abuse hardening: `slowapi` + Upstash Redis rate limits (register per-IP, login per-username with backoff, status posts per-user, friend requests per-user/hour), basic text length/profanity validation on status text.
11. Polish: expiry countdown component, loading/empty states, minimal responsive pass, account deletion flow.
12. Deploy: Vercel (frontend) + Render/Railway (backend + Postgres + cron job) + Upstash (Redis) wiring, verify CORS/cookie behavior across the two real origins, end-to-end smoke test.

## Known Risks (accepted for v1, revisit later)

- **No password recovery** — by design; covered by a clear signup-time warning only.
- **Username squatting/impersonation** — no identity verification is possible without collecting PII; accepted tradeoff of the anonymous model.
- **Status text itself can carry harassment** even though reactions are safe — v1 gets basic length/profanity validation; a report/block mechanism is a near-term follow-up, not required for v1.
- **No email means no "new device login" alerts** — mitigate by showing active sessions with manual revoke in `/settings`.
- **Cross-origin cookie auth adds real complexity**: `SameSite=None` cookies require `Secure` (HTTPS-only, so local dev needs either HTTPS locally or a documented dev-only relaxation), and browsers are increasingly restrictive about third-party/cross-site cookies (e.g. Safari ITP) — this is more fragile than the previous same-origin Next.js design and should be tested early (Milestone 3), not left until deploy.

## Verification

- Manual end-to-end walkthrough after each milestone: register two test users, add as friends, post statuses with different expiry durations, confirm feed/profile visibility rules, react with each of the 3 types, confirm reactions and statuses disappear after expiry (both via lazy filter immediately and via the cleanup script run against the DB).
- FastAPI's auto-generated OpenAPI docs (`/docs`) for manually exercising each endpoint during development.
- Run `cleanup_expired.py` manually against a dev DB to verify it deletes only truly expired rows and cascades reactions.
- Confirm the session cookie is actually sent/accepted cross-origin (frontend on one port/domain, backend on another) before relying on it further into the build.
