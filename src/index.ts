import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import {
	createSession,
	getCurrentUser,
	hashPassword,
	isValidEmail,
	normalizeEmail,
	requireAuth,
	revokeSession,
	verifyPassword,
} from './auth';
import { createDb } from './db';
import { tasks, users } from './db/schema';

const app = new Hono<{ Bindings: Env; Variables: { user: { id: number; email: string } } }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/health/db', async (c) => {
	try {
		const table = await c.env.DB
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tasks', 'users', 'sessions')")
			.all<{ name: string }>();

		const tables = new Set(table.results.map((item) => item.name));
		if (!['tasks', 'users', 'sessions'].every((name) => tables.has(name))) {
			console.error('D1 health check failed: required tables are missing', [...tables]);
			return c.json({ status: 'error', error: 'Required database tables are missing.' }, 503);
		}

		return c.json({ status: 'ok', database: 'task-app-db', tables: ['tasks', 'users', 'sessions'] });
	} catch (error) {
		console.error('D1 health check failed', error);
		return c.json({ status: 'error', error: 'The database is unavailable.' }, 503);
	}
});

app.post('/api/auth/register', async (c) => {
	const body = await c.req.json<{ email?: unknown; password?: unknown }>().catch(() => null);
	const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
	const password = typeof body?.password === 'string' ? body.password : '';

	if (!isValidEmail(email)) return c.json({ error: 'Please enter a valid email address.' }, 400);
	if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters.' }, 400);

	const db = createDb(c.env.DB);
	const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
	if (existing) return c.json({ error: 'This email is already registered.' }, 409);

	const passwordData = await hashPassword(password);
	const now = new Date();

	try {
		await db.insert(users).values({
			email: email,
			passwordHash: passwordData.hash,
			passwordSalt: passwordData.salt,
			createdAt: now,
			updatedAt: now,
		}).run();
	} catch (error) {
		console.error('Register failed', error);
		return c.json({ error: 'Unable to create the account.' }, 500);
	}

	const user = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email)).get();
	if (!user) return c.json({ error: 'Unable to create the account.' }, 500);

	await createSession(c, user.id);
	return c.json({ data: user }, 201);
});

app.post('/api/auth/login', async (c) => {
	const body = await c.req.json<{ email?: unknown; password?: unknown }>().catch(() => null);
	const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
	const password = typeof body?.password === 'string' ? body.password : '';
	const db = createDb(c.env.DB);
	const user = await db.select().from(users).where(eq(users.email, email)).get();

	if (!user || !(await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
		return c.json({ error: 'Invalid email or password.' }, 401);
	}

	await createSession(c, user.id);
	return c.json({ data: { id: user.id, email: user.email } });
});

app.get('/api/auth/me', async (c) => {
	const user = await getCurrentUser(c);
	if (!user) return c.json({ error: 'Please log in first.' }, 401);
	return c.json({ data: user });
});

app.post('/api/auth/logout', async (c) => {
	await revokeSession(c);
	return c.json({ data: null });
});

app.use('/api/tasks', requireAuth);
app.use('/api/tasks/*', requireAuth);

app.get('/api/tasks', async (c) => {
	const db = createDb(c.env.DB);
	const user = c.get('user');
	const result = await db.select().from(tasks).where(eq(tasks.userId, user.id)).orderBy(desc(tasks.createdAt)).all();

	return c.json({ data: result });
});

app.post('/api/tasks', async (c) => {
	const body = await c.req.json<{ title?: unknown }>().catch(() => null);
	const title = typeof body?.title === 'string' ? body.title.trim() : '';

	if (!title) {
		return c.json({ error: 'The title field is required.' }, 400);
	}

	const now = new Date();
	const db = createDb(c.env.DB);
	const user = c.get('user');
	const [task] = await db
		.insert(tasks)
		.values({ userId: user.id, title, createdAt: now, updatedAt: now })
		.returning()
		.all();

	return c.json({ data: task }, 201);
});

app.patch('/api/tasks/:id', async (c) => {
	const id = Number(c.req.param('id'));
	const body = await c.req.json<{ title?: unknown; completed?: unknown }>().catch(() => null);
	const hasTitle = typeof body === 'object' && body !== null && 'title' in body;
	const hasCompleted = typeof body === 'object' && body !== null && 'completed' in body;
	const title = typeof body?.title === 'string' ? body.title.trim() : undefined;
	const completed = typeof body?.completed === 'boolean' ? body.completed : undefined;

	if (
		!Number.isInteger(id) ||
		(!hasTitle && !hasCompleted) ||
		(hasTitle && !title) ||
		(hasTitle && typeof body?.title !== 'string') ||
		(hasCompleted && typeof body?.completed !== 'boolean')
	) {
		return c.json({ error: 'Provide a non-empty title or a boolean completed field.' }, 400);
	}

	const db = createDb(c.env.DB);
	const user = c.get('user');
	const updates = {
		...(hasTitle ? { title } : {}),
		...(hasCompleted ? { completed } : {}),
		updatedAt: new Date(),
	};
	const [task] = await db
		.update(tasks)
		.set(updates)
		.where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))
		.returning()
		.all();

	if (!task) {
		return c.json({ error: 'Task not found.' }, 404);
	}

	return c.json({ data: task });
});

app.delete('/api/tasks/:id', async (c) => {
	const id = Number(c.req.param('id'));

	if (!Number.isInteger(id)) {
		return c.json({ error: 'A valid task id is required.' }, 400);
	}

	const db = createDb(c.env.DB);
	const user = c.get('user');
	const [deletedTask] = await db.delete(tasks)
		.where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))
		.returning({ id: tasks.id })
		.all();

	if (!deletedTask) {
		return c.json({ error: 'Task not found.' }, 404);
	}

	return c.json({ data: deletedTask });
});

app.all('*', (c) => {
	if (c.req.path.startsWith('/api/')) {
		return c.notFound();
	}

	return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
	console.error('Unhandled request error', {
		method: c.req.method,
		path: c.req.path,
		message: error instanceof Error ? error.message : String(error),
	});

	if (c.req.path.startsWith('/api/')) {
		return c.json({ error: 'Internal server error.' }, 500);
	}

	return c.text('Internal Server Error', 500);
});

export default {
	fetch: app.fetch,

	// Keep the scheduled handler alongside the Hono HTTP application.
	async scheduled(event): Promise<void> {
		const resp = await fetch('https://api.cloudflare.com/client/v4/ips');
		const wasSuccessful = resp.ok ? 'success' : 'fail';

		console.log(`trigger fired at ${event.cron}: ${wasSuccessful}`);
	},
} satisfies ExportedHandler<Env>;
