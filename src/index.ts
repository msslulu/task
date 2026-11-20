import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { createDb } from './db';
import { tasks } from './db/schema';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/health/db', async (c) => {
	try {
		const table = await c.env.DB
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
			.first<{ name: string }>();

		if (!table) {
			console.error('D1 health check failed: tasks table is missing');
			return c.json({ status: 'error', error: 'The tasks table is missing.' }, 503);
		}

		return c.json({ status: 'ok', database: 'task-app-db', table: 'tasks' });
	} catch (error) {
		console.error('D1 health check failed', error);
		return c.json({ status: 'error', error: 'The database is unavailable.' }, 503);
	}
});

app.get('/api/tasks', async (c) => {
	const db = createDb(c.env.DB);
	const result = await db.select().from(tasks).orderBy(desc(tasks.createdAt)).all();

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
	const [task] = await db
		.insert(tasks)
		.values({ title, createdAt: now, updatedAt: now })
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
	const updates = {
		...(hasTitle ? { title } : {}),
		...(hasCompleted ? { completed } : {}),
		updatedAt: new Date(),
	};
	const [task] = await db
		.update(tasks)
		.set(updates)
		.where(eq(tasks.id, id))
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
	const [deletedTask] = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id }).all();

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
