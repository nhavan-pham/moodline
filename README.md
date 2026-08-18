# social-status

A minimal social app for sharing how you're doing right now — nothing more.

There are no posts, no photos, no comment threads. You set a **status**: a short line of text plus one emoji. Friends see it. It expires. That's the whole app.

## Why

Most social apps reward long-form performance — the more you post, the more there is. This is the opposite: a single line that describes your current state, shared with people who actually know you, and that quietly disappears instead of piling up.

## How it works

- **Post a status** — up to 140 characters of text plus one emoji, describing how you're doing.
- **Choose how long it lasts** — 1 hour, 6 hours, 24 hours, or until you replace it. After that, it's gone — not hidden, actually deleted from the database.
- **Add friends** — mutual friend requests, not one-way follows. Your status is only visible to people who've accepted (or been accepted by) you.
- **React, kindly** — friends can respond with exactly one of three reactions: 🥺 worried about you, 🤗 sending support, 🎉 happy for you. There's no like button, no angry face, no laughing-at-you emoji. The reaction set is fixed on purpose.

## Design principles

- **No personal identity, ever.** Accounts are just a username and password — no email, no phone number, no real name. There's nothing to leak because there's nothing collected. The tradeoff: if you forget your password, there is no recovery. You're warned about this at signup.
- **Nothing lingers.** Expired statuses and their reactions are deleted, not archived. A status is a snapshot of a moment, not a permanent record.
- **Friends-only by default.** Status content (especially something like "feeling anxious today") isn't broadcast to strangers or scraped from a public profile — only accepted friends can see it or react to it.
- **Reactions can't be used to pile on.** The fixed, supportive-only reaction set is a deliberate constraint to keep the app emotionally safe.

## Status

Early planning stage — no application code yet. See [`PLAN.md`](./PLAN.md) for the full v1 architecture: tech stack, data model, API routes, and the milestone-by-milestone build order.

## Planned stack

React + Vite (TypeScript) · Tailwind CSS · FastAPI (Python) · Postgres (Neon) · SQLModel + Alembic · custom username/password auth · Vercel (frontend) + Render/Railway (backend, DB, scheduled expiry cleanup).
