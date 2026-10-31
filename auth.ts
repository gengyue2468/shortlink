import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { API_KEY, BASE_URL } from "./config";
import { getClientIp } from "./analytics";

export type AppEnv = { Bindings: { remoteAddress?: string } };
const cookieName = "shortlink_session";
const lifetime = 8 * 60 * 60 * 1000;
const sessions = new Map<string, number>();
const attempts = new Map<string, { count: number; expires: number }>();
const digest = (value: string) => createHash("sha256").update(value).digest();

export function validKey(value: unknown): boolean {
  return (
    typeof value === "string" && timingSafeEqual(digest(value), digest(API_KEY))
  );
}

function sessionValid(c: Context<AppEnv>): boolean {
  const token = getCookie(c, cookieName);
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires || expires <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function sameOrigin(c: Context<AppEnv>): boolean {
  const origin = c.req.header("origin");
  // TLS may terminate at the reverse proxy, leaving an HTTP backend request.
  // Use the configured public origin, never arbitrary forwarded host headers.
  return origin === new URL(BASE_URL).origin || origin === new URL(c.req.url).origin;
}

export const authorize = createMiddleware<AppEnv>(async (c, next) => {
  const authorization = c.req.header("authorization");
  if (authorization !== undefined) {
    if (
      !authorization.startsWith("Bearer ") ||
      !validKey(authorization.slice(7))
    ) {
      return c.text("Unauthorized", 401);
    }
  } else {
    if (!sessionValid(c)) return c.text("Unauthorized", 401);
    if (!["GET", "HEAD"].includes(c.req.method) && !sameOrigin(c)) {
      return c.text("Forbidden", 403);
    }
  }
  await next();
});

// Bound both maps. Sessions intentionally expire when the process restarts.
export function loginAllowed(c: Context<AppEnv>): boolean {
  const now = Date.now();
  for (const [ip, value] of attempts)
    if (value.expires <= now) attempts.delete(ip);
  const ip = getClientIp(c.req.raw, c.env?.remoteAddress) || "unknown";
  let value = attempts.get(ip);
  if (!value) {
    if (attempts.size >= 1000) return false;
    value = { count: 0, expires: now + 10 * 60 * 1000 };
    attempts.set(ip, value);
  }
  return ++value.count <= 10;
}

export function startSession(c: Context<AppEnv>): void {
  const oldToken = getCookie(c, cookieName);
  if (oldToken) sessions.delete(oldToken);
  for (const [token, expires] of sessions)
    if (expires <= Date.now()) sessions.delete(token);
  if (sessions.size >= 256) sessions.delete(sessions.keys().next().value!);
  const token = randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + lifetime);
  setCookie(c, cookieName, token, {
    httpOnly: true,
    secure: new URL(BASE_URL).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: lifetime / 1000,
  });
}

export function endSession(c: Context<AppEnv>): void {
  const token = getCookie(c, cookieName);
  if (token) sessions.delete(token);
  deleteCookie(c, cookieName, { path: "/" });
}
