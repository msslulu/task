import { and, eq, gt } from 'drizzle-orm';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';

import { createDb } from './db';
import { sessions, users } from './db/schema';

export const SESSION_COOKIE = 'taskflow_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type AuthUser = Pick<typeof users.$inferSelect, 'id' | 'email'>;

export type AuthBindings = {
	Bindings: Env;
	Variables: { user: AuthUser };
};

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return bytesToBase64Url(new Uint8Array(digest));
}

export async function hashPassword(password: string, salt?: string) {
	const saltBytes = salt ? base64UrlToBytes(salt) : crypto.getRandomValues(new Uint8Array(16));
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: saltBytes, iterations: 100_000, hash: 'SHA-256' },
		key,
		256,
	);
	return {
		salt: bytesToBase64Url(saltBytes),
		hash: bytesToBase64Url(new Uint8Array(bits)),
	};
}

export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
	const actual = await hashPassword(password, salt);
	return actual.hash === expectedHash;
}

export function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getRequestToken(c: Context<AuthBindings>): string | undefined {
	const authorization = c.req.header('Authorization');
	if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim();
	return getCookie(c, SESSION_COOKIE);
}

export async function createSession(c: Context<AuthBindings>, userId: number): Promise<void> {
	const rawToken = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
	const db = createDb(c.env.DB);

	await db.insert(sessions).values({
		userId,
		tokenHash: await sha256(rawToken),
		expiresAt,
		createdAt: now,
	}).run();

	setCookie(c, SESSION_COOKIE, rawToken, {
		httpOnly: true,
		secure: new URL(c.req.url).protocol === 'https:',
		sameSite: 'Lax',
		path: '/',
		maxAge: SESSION_TTL_SECONDS,
	});
}

export function clearSession(c: Context<AuthBindings>): void {
	deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function revokeSession(c: Context<AuthBindings>): Promise<void> {
	const rawToken = getRequestToken(c);
	if (rawToken) {
		await createDb(c.env.DB).delete(sessions).where(eq(sessions.tokenHash, await sha256(rawToken))).run();
	}
	clearSession(c);
}

export async function getCurrentUser(c: Context<AuthBindings>): Promise<AuthUser | null> {
	const rawToken = getRequestToken(c);
	if (!rawToken) return null;

	const db = createDb(c.env.DB);
	const now = new Date();
	const result = await db
		.select({ id: users.id, email: users.email, sessionId: sessions.id })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.tokenHash, await sha256(rawToken)), gt(sessions.expiresAt, now)))
		.get();

	if (!result) {
		clearSession(c);
		return null;
	}

	return { id: result.id, email: result.email };
}

export const requireAuth: MiddlewareHandler<AuthBindings> = async (c, next) => {
	const user = await getCurrentUser(c);
	if (!user) return c.json({ error: 'Please log in first.' }, 401);
	c.set('user', user);
	await next();
};
