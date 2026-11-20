# task

Cloudflare Workers + D1 demo project.

## Deploy

Before the first production deployment, make sure Wrangler is authenticated and apply the D1 migrations:

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

The `deploy` script also runs the remote migration automatically before deploying the Worker. The API uses the `DB` binding, which must point to the `task-app-db` D1 database.

Useful checks after deployment:

```text
/health       Worker health check
/health/db    D1 binding and tasks table check
/api/tasks    Task list API
```

## Authentication

The app provides email/password registration, login, logout and current-user APIs. Authentication uses an HttpOnly session cookie, and task records are isolated by user.

The first deployment after adding authentication must apply the new D1 migration:

```bash
npm run db:migrate:remote
npm run deploy
```

Available endpoints:

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout
```
