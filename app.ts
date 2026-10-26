import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { registerLink, trackClick } from "./analytics";
import { API_KEY, BASE_URL } from "./config";
import { links } from "./database";

export const app = new Hono<{ Bindings: { remoteAddress?: string } }>();

// Avoid caching creation responses, redirects, and errors.
app.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

const authorize = createMiddleware(async (c, next) => {
  if (c.req.header("authorization") !== `Bearer ${API_KEY}`) {
    return c.text("Unauthorized", 401);
  }
  await next();
});

type LinkInput = { url?: unknown };
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
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const result = (path: string) => ({ shortLink: `${BASE_URL}/${path}` });

app.get("/", (c) => c.text("It works!"));

app.post("/", authorize, async (c) => {
  const body = await parseBody(c.req.raw);
  if (!body) return c.text("Invalid JSON object", 400);
  if (body.url === undefined || body.url === null || body.url === "")
    return c.text("Missing url", 400);
  if (!validUrl(body.url)) return c.text("Invalid url", 400);

  const existing = links.findByUrl(body.url);
  if (existing) return c.json(result(existing.short_link));

  const path = links.createGenerated(body.url);
  const umamiId = await registerLink(path, body.url);
  if (umamiId) {
    try {
      links.setUmamiId(path, umamiId);
    } catch (error) {
      // Analytics mapping failures must not invalidate the short link.
      console.error(`[Umami] Failed to save link ID for ${path}:`, error);
    }
  }
  return c.json(result(path));
});

app.get("/:path", (c) => {
  const path = c.req.param("path");
  const link = links.findByPath(path);
  if (!link) return c.text("Not found", 404);
  trackClick(link.umami_link_id, path, c.req.raw, c.env?.remoteAddress);
  return c.redirect(link.original_url, 302);
});

app.onError((error, c) => {
  console.error(error);
  return c.text("Internal server error", 500);
});

app.notFound((c) => c.text("Not found", 404));
