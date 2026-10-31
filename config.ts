export const PORT = Number(Bun.env.PORT ?? 8787);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

function publicOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("BASE_URL must be an absolute HTTP(S) origin"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

export const BASE_URL = publicOrigin(Bun.env.BASE_URL ?? `http://localhost:${PORT}`);
export const API_KEY = Bun.env.API_KEY ?? "";
if (!API_KEY.trim() || API_KEY === "your-key") {
  throw new Error("Set API_KEY to a private key; empty values and the example key are not allowed");
}
export const DATABASE_PATH =
  Bun.env.DATABASE_PATH ?? `${import.meta.dir}/data/shortlinks.db`;
export const UMAMI_URL = Bun.env.UMAMI_URL?.replace(/\/+$/, "");
export const UMAMI_API_KEY = Bun.env.UMAMI_API_KEY;
const timeout = Number(Bun.env.UMAMI_TIMEOUT_MS ?? 2000);
export const UMAMI_TIMEOUT_MS = Number.isSafeInteger(timeout) && timeout > 0 ? Math.min(timeout, 60000) : 2000;
// Enable only behind a proxy that replaces incoming client-IP headers.
export const TRUST_PROXY = Bun.env.TRUST_PROXY === "true";
