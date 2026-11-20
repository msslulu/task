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
