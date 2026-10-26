export const PORT = Number(Bun.env.PORT ?? 8787);
export const BASE_URL = (
  Bun.env.BASE_URL ?? `http://localhost:${PORT}`
).replace(/\/+$/, "");
export const API_KEY = Bun.env.API_KEY ?? "your-key";
export const DATABASE_PATH =
  Bun.env.DATABASE_PATH ?? `${import.meta.dir}/data/shortlinks.db`;
export const UMAMI_URL = Bun.env.UMAMI_URL?.replace(/\/+$/, "");
export const UMAMI_API_KEY = Bun.env.UMAMI_API_KEY;
const timeout = Number(Bun.env.UMAMI_TIMEOUT_MS ?? 2000);
export const UMAMI_TIMEOUT_MS = Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 60000) : 2000;
// Enable only behind a proxy that replaces incoming client-IP headers.
export const TRUST_PROXY = Bun.env.TRUST_PROXY === "true";
