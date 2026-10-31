import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  BASE_URL,
  TRUST_PROXY,
  UMAMI_API_KEY,
  UMAMI_TIMEOUT_MS,
  UMAMI_URL,
} from "./config";

const enabled = Boolean(UMAMI_URL && UMAMI_API_KEY);
const pending = new Set<Promise<void>>();
const maxPending = 100;

async function send(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${UMAMI_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "shortlink/1.0",
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UMAMI_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }
  return response;
}

export async function registerLink(
  path: string,
  url: string,
): Promise<string | null> {
  if (!enabled) return null;
  try {
    const id = randomUUID();
    const response = await send(
      "/api/links",
      {
        id,
        name: path,
        // Native Umami slugs require at least 8 characters. A unique suffix
        // also lets deleted aliases be recreated without reusing old stats.
        slug: `${path}-${id.replaceAll("-", "")}`,
        url,
      },
      { Authorization: `Bearer ${UMAMI_API_KEY}` },
    );
    const body = (await response.json()) as { id?: unknown };
    if (
      typeof body.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.id,
      )
    ) {
      throw new Error("Invalid link registration response");
    }
    return body.id;
  } catch (error) {
    console.error(`[Umami] Registration failed for ${path}:`, error);
    return null;
  }
}

export function getClientIp(
  request: Request,
  remoteAddress?: string,
): string | undefined {
  if (TRUST_PROXY) {
    for (const name of ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]) {
      const value = request.headers.get(name)?.split(",")[0]?.trim();
      if (value && isIP(value)) return value;
    }
  }
  return remoteAddress && isIP(remoteAddress) ? remoteAddress : undefined;
}

function getReferrer(request: Request): string | undefined {
  try {
    const url = new URL(request.headers.get("referer") || "");
    // Avoid uploading referrer query strings, fragments, or credentials.
    return ["http:", "https:"].includes(url.protocol) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

async function reportClick(
  id: string,
  path: string,
  request: Request,
  remoteAddress?: string,
) {
  try {
    const userAgent = request.headers.get("user-agent") || "shortlink/1.0";
    const response = await send(
      "/api/send",
      {
        type: "event",
        payload: {
          link: id,
          hostname: new URL(BASE_URL).hostname,
          url: `${BASE_URL}/${path}`,
          userAgent,
          ip: getClientIp(request, remoteAddress),
          referrer: getReferrer(request),
          language:
            request.headers
              .get("accept-language")
              ?.split(",")[0]
              ?.split(";")[0]
              ?.trim() || undefined,
        },
      },
      { "User-Agent": userAgent },
    );
    await response.body?.cancel();
  } catch (error) {
    console.error(`[Umami] Click reporting failed for ${path}:`, error);
  }
}

export function trackClick(
  id: string | null,
  path: string,
  request: Request,
  remoteAddress?: string,
): void {
  // Public redirects must not create unbounded outbound work during a burst.
  if (!enabled || !id || pending.size >= maxPending) return;
  const task = reportClick(id, path, request, remoteAddress);
  pending.add(task);
  void task.finally(() => pending.delete(task));
}

// Useful for tests and best-effort graceful shutdown; redirects never await this.
export async function flushAnalytics(): Promise<void> {
  await Promise.all([...pending]);
}
