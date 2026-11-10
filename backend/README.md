# Water Delivery: Backend (Auth foundation)

Node.js 22 · TypeScript · Express 5 · Prisma · PostgreSQL

## Quick start (local)

```bash
cp .env                 
npm install
npx prisma migrate dev --name init    
npm run seed                          
npm run dev                           # http://localhost:4000
npm test
```
You need a local Postgres, or run only the DB: `docker compose up db -d` and use
`DATABASE_URL=postgresql://water:<POSTGRES_PASSWORD>@localhost:5432/water?schema=public`
(the db service doesn't publish a port by default; add `ports: ["5432:5432"]` for local dev).

With `SMS_PROVIDER=console` the OTP is printed in the server log, so you can test without paying for SMS.

## Production (Docker)

```bash
docker compose up -d --build   # db -> migrate (prisma migrate deploy) -> api
```
Put the API behind HTTPS (nginx, Caddy, or a cloud load balancer) and set `TRUST_PROXY=1`.

## Endpoints  (`/api/v1/auth`)

| Method | Path | Body | Notes |

| POST | `/register` | name, phone, password, email? | Creates unverified user, sends OTP by SMS |
| POST | `/verify-otp` | phone, code | Returns `user` + `tokens` |
| POST | `/resend-otp` | phone | 60s cooldown, 5/hour cap |
| POST | `/login` | phone, password | `403 PHONE_NOT_VERIFIED` re-sends an OTP |
| POST | `/refresh` | refreshToken | Rotates the refresh token |
| POST | `/logout` | refreshToken | Revokes it |
| GET  | `/me` | – | `Authorization: Bearer <accessToken>` |

Health: `GET /health` (liveness), `GET /ready` (checks the database).
Errors always look like `{ "error": { "code", "message", "details?", "requestId" } }`.

```bash
curl -X POST localhost:4000/api/v1/auth/register -H 'content-type: application/json' \
  -d '{"name":"Jane Doe","phone":"0712345678","password":"Passw0rd123"}'
curl -X POST localhost:4000/api/v1/auth/verify-otp -H 'content-type: application/json' \
  -d '{"phone":"0712345678","code":"123456"}'
```

## Security built in

- OTP: crypto-random 6 digits, stored as keyed HMAC (never plain), 5-minute expiry, single use, 5 attempts, 60s resend cooldown, 5 sends/hour.
- Passwords: bcrypt (12 rounds), min 8 chars with letters + numbers; 5 failed logins lock the account for 15 minutes; constant-ish timing for unknown numbers.
- Sessions: 15-minute JWT access tokens (HS256, pinned algorithm) + opaque refresh tokens stored hashed, rotated on every use, with reuse detection that revokes all sessions.
- Helmet headers, strict CORS allow-list, 10 KB body limit, per-route rate limiting, request IDs in logs and error responses, secrets validated at boot (the app refuses to start in production with console SMS or weak secrets).
- Generic responses on resend/verify so attackers can't enumerate which numbers are registered.

## Before you go live: checklist

- [ ] Commit `prisma/migrations` (from `migrate dev`).
- [ ] Switch `SMS_PROVIDER=africastalking`, register a sender ID, and fund the account.
- [ ] Use a shared rate-limit store (Redis) once you run more than one instance.
- [ ] Managed Postgres with automated backups; secrets in your host's secret manager.
- [ ] Add Sentry (or similar) for error monitoring; ship logs somewhere searchable.
- [ ] Add integration tests against a test database in CI.
- [ ] Review the Kenya Data Protection Act obligations (register with the ODPC, privacy policy, consent).

## Next modules
products → orders → M-Pesa (Daraja STK Push + callback) → card gateway webhook → Socket.IO → admin endpoints (`requireRole('ADMIN')` is ready in `src/middleware/auth.ts`).
