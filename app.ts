import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { registerLink, trackClick } from "./analytics";
import { BASE_URL } from "./config";
import { links } from "./database";
import {
  authorize,
  endSession,
  loginAllowed,
  sameOrigin,
  startSession,
  validKey,
  type AppEnv,
} from "./auth";

export const app = new Hono<AppEnv>();

// Avoid caching creation responses, redirects, and errors.
app.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
app.use(
  "*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.text("Request too large", 413),
  }),
);

type LinkInput = { url?: unknown; path?: unknown; key?: unknown; paths?: unknown };
const parseBody = async (request: Request): Promise<LinkInput | null> => {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? body
      : null;
  } catch {
    return null;
  }
};

function validUrl(value: unknown): value is string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const result = (path: string) => ({ shortLink: `${BASE_URL}/${path}` });

app.get("/", (c) => c.text("It works!"));

app.get("/admin", async (c) => {
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com; connect-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  return c.html(await Bun.file(`${import.meta.dir}/web/admin.html`).text());
});
app.get("/admin/app.js", async (c) => {
  c.header("Content-Type", "text/javascript; charset=utf-8");
  return c.body(await Bun.file(`${import.meta.dir}/web/admin.js`).text());
});

app.post("/api/auth", async (c) => {
  if (c.req.header("origin") && !sameOrigin(c)) return c.text("Forbidden", 403);
  if (!loginAllowed(c)) {
    c.header("Retry-After", "600");
    return c.text("Too many login attempts", 429);
  }
  const body = await parseBody(c.req.raw);
  if (!body) return c.text("Invalid JSON object", 400);
  if (!validKey(body.key)) return c.text("Unauthorized", 401);
  startSession(c);
  return c.json({ authenticated: true });
});
app.get("/api/auth", authorize, (c) => c.json({ authenticated: true }));
app.delete("/api/auth", authorize, (c) => {
  endSession(c);
  return c.body(null, 204);
});

app.get("/api/links", authorize, (c) => {
  const page = Number(c.req.query("page") ?? 1);
  const limit = Number(c.req.query("limit") ?? 20);
  const search = (c.req.query("q") ?? "").trim();
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    search.length > 500 ||
    !Number.isSafeInteger((page - 1) * limit)
  ) {
    return c.text("Invalid pagination or search", 400);
  }
  const { items, total } = links.list(search, limit, (page - 1) * limit);
  return c.json({
    items: items.map((link) => ({
      path: link.short_link,
      url: link.original_url,
      ...result(link.short_link),
      tracked: Boolean(link.umami_link_id),
    })),
    page,
    limit,
    total,
  });
});

// Keep the original creation endpoint for existing API clients.
app.post("/", authorize, async (c) => {
  const body = await parseBody(c.req.raw);
  if (!body) return c.text("Invalid JSON object", 400);
  if (body.url === undefined || body.url === null || body.url === "")
    return c.text("Missing url", 400);
  if (!validUrl(body.url)) return c.text("Invalid url", 400);

  let path: string;
  if (body.path !== undefined) {
    if (
      typeof body.path !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(body.path)
    )
      return c.text("Invalid path", 400);
    if (["admin", "api"].includes(body.path))
      return c.text("Reserved path", 400);
    if (!links.create(body.path, body.url))
      return c.text("Path already exists", 409);
    path = body.path;
  } else {
    const existing = links.findByUrl(body.url);
    if (existing) return c.json(result(existing.short_link));
    path = links.createGenerated(body.url);
  }
  const umamiId = await registerLink(path, body.url);
  if (umamiId) {
    try {
      links.setUmamiId(path, umamiId, body.url);
    } catch (error) {
      // Analytics mapping failures must not invalidate the short link.
      console.error(`[Umami] Failed to save link ID for ${path}:`, error);
    }
  }
  return c.json(result(path));
});

app.post("/api/links/delete", authorize, async (c) => {
  const body = await parseBody(c.req.raw);
  if (!body) return c.text("Invalid JSON object", 400);
  const paths = body.paths;
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 100 ||
      !paths.every((path): path is string => typeof path === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(path))) {
    return c.text("Expected 1 to 100 valid paths", 400);
  }
  return c.json({ deleted: links.deleteMany(paths) });
});

app.delete("/api/links/:path", authorize, (c) => {
  // Remove the local redirect only; retain Umami records as historical stats.
  if (!links.delete(c.req.param("path"))) return c.text("Not found", 404);
  return c.body(null, 204);
});
app.delete("/:path", authorize, (c) => {
  if (!links.delete(c.req.param("path"))) return c.text("Not found", 404);
  return c.body(null, 204);
});
app.all("/api", (c) => c.text("Not found", 404));
app.all("/api/*", (c) => c.text("Not found", 404));

app.get("/:path", (c) => {
  const path = c.req.param("path");
  const link = links.findByPath(path);
  if (!link) return c.text("Not found", 404);
  let destination: URL;
  try {
    destination = new URL(link.original_url);
    if (!["http:", "https:"].includes(destination.protocol)) throw new Error("Unsupported destination protocol");
  } catch (error) {
    console.error(`[Redirect] Invalid stored destination for ${path}:`, error);
    return c.text("Invalid destination", 502);
  }
  if (c.req.method === "GET") trackClick(link.umami_link_id, path, c.req.raw, c.env?.remoteAddress);
  return c.redirect(destination.href, 302);
});

app.onError((error, c) => {
  console.error(error);
  return c.text("Internal server error", 500);
});

app.notFound((c) => c.text("Not found", 404));
