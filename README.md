# App

A small, production-shaped starter built on the **ScoreProphet stack**, with
**email-based registration and a verification-link flow**. It is the
product-agnostic foundation — add your own features on top.

## Stack

- Next.js 15 (App Router, `standalone` output) + React 19
- Prisma 7 + SQLite via `better-sqlite3` (no external database to run)
- `iron-session` httpOnly cookie sessions
- `bcryptjs` password hashing (cost 12)
- `nodemailer` SMTP for verification + password-reset emails
- Tailwind CSS + shadcn-style UI components
- Vitest unit tests
- Multi-stage Docker + docker-compose

## Auth flow

- **Register** with email + password (+ optional name) → a verification link is
  emailed. The account is inactive until verified.
- **Verify** by clicking the link → the account is activated and the user is
  signed in. Verification is consumed by a button click (a server action), so
  email-client link prefetchers don't burn the token.
- **Login** requires a verified email; unverified users are offered a resend.
- **Forgot / reset password** via a one-hour, single-use, hashed token.
- **Profile**: change password, delete account.

Security details carried over from the reference stack: bcrypt with a
constant-time dummy hash on the login "user not found" path, hashed tokens at
rest, per-IP rate limiting on every auth action, silent responses on
password-reset / resend to avoid email enumeration, and strict security headers
+ CSP in `next.config.mjs`.

The first account registered with `ADMIN_EMAIL` is granted `isAdmin`.

## Environment

Copy `.env.example` to `.env` and fill it in:

```bash
DATABASE_URL="file:./dev.db"
APP_URL="http://localhost:3000"
APP_NAME="App"
SESSION_SECRET="at_least_32_characters_random_string"   # openssl rand -base64 32
ADMIN_EMAIL="you@example.com"
SMTP_HOST="smtp.example.com"
SMTP_PORT="465"
SMTP_USER="no-reply@example.com"
SMTP_PASSWORD="..."
SMTP_FROM="App <no-reply@example.com>"
```

## Local development

```bash
npm install
DATABASE_URL="file:./dev.db" npx prisma migrate dev
npm run dev          # http://localhost:3000
```

> No SMTP configured yet? Registration will report that the verification email
> couldn't be sent. For local testing, point SMTP at a catcher like
> [Mailpit](https://github.com/axllent/mailpit) (`SMTP_HOST=localhost`,
> `SMTP_PORT=1025`) and read the link from its inbox.

## Validation

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

## Deployment (overseas / no ICP 备案, for users in China)

This image is self-contained (SQLite on a mounted volume), which makes it a good
fit for a single Hong Kong / overseas box.

```bash
cp .env.example .env   # then edit it
docker compose up -d --build
```

`docker-compose.yml` keeps the database in the `app_data` volume at
`/data/app.db`; migrations run automatically on container start.

Notes for serving mainland-China users from an unfiled (no 备案) overseas host:

- **Host in Hong Kong / Singapore / Japan** and put it behind HTTPS. A box on a
  CN2 GIA line, or a Hong Kong / Cloudflare front, keeps latency reasonable.
  Mainland origin servers and mainland CDN nodes require 备案 — keep the whole
  chain overseas.
- **Email deliverability to +86 inboxes is the thing to get right.** Pick an SMTP
  provider with decent China routing, set up SPF / DKIM / DMARC on your sending
  domain, and use a real From address. Verification + reset both depend on it.
- A no-备案 site can be throttled or blocked by the GFW; that risk is inherent to
  this setup. Always serve over HTTPS.

## Project layout

```
src/
  actions/auth.ts        # register / verify / login / logout / reset / profile actions
  app/                   # App Router pages (home, login, register, verify-email, …)
  components/            # navbar, auth shell, form message, ui/*
  lib/                   # db, session, auth, email, tokens, rate-limit, validation
prisma/schema.prisma     # User + EmailVerificationToken + PasswordResetToken
```
