import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DATABASE_PATH } from "./config";

type Link = { short_link: string; original_url: string; umami_link_id: string | null };

if (DATABASE_PATH !== ":memory:") {
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
}
const db = new Database(DATABASE_PATH, { create: true });
db.run(
  "CREATE TABLE IF NOT EXISTS links (short_link TEXT PRIMARY KEY, original_url TEXT NOT NULL)",
);
// Preserve existing databases without registering or rewriting old links.
const columns = db.query<{ name: string }, []>("PRAGMA table_info(links)").all();
if (!columns.some((column) => column.name === "umami_link_id")) {
  db.run("ALTER TABLE links ADD COLUMN umami_link_id TEXT");
}
db.run(
  "CREATE INDEX IF NOT EXISTS links_original_url_idx ON links (original_url)",
);

const byPath = db.query<Link, [string]>(
  "SELECT * FROM links WHERE short_link = ?",
);
const byUrl = db.query<Link, [string]>(
  "SELECT * FROM links WHERE original_url = ? LIMIT 1",
);
const insert = db.query(
  "INSERT INTO links (short_link, original_url) VALUES (?, ?) ON CONFLICT(short_link) DO NOTHING",
);
const setUmamiId = db.query("UPDATE links SET umami_link_id = ? WHERE short_link = ? AND original_url = ? AND umami_link_id IS NULL");
const remove = db.query("DELETE FROM links WHERE short_link = ?");
const removeMany = db.transaction((paths: string[]) => {
  let deleted = 0;
  for (const path of new Set(paths)) deleted += remove.run(path).changes;
  return deleted;
});
const list = db.query<Link, [string, string, number, number]>(
  "SELECT * FROM links WHERE instr(lower(short_link), lower(?)) > 0 OR instr(lower(original_url), lower(?)) > 0 ORDER BY rowid DESC LIMIT ? OFFSET ?",
);
const count = db.query<{ total: number }, [string, string]>(
  "SELECT count(*) AS total FROM links WHERE instr(lower(short_link), lower(?)) > 0 OR instr(lower(original_url), lower(?)) > 0",
);

export const links = {
  findByPath: (path: string) => byPath.get(path),
  findByUrl: (url: string) => byUrl.get(url),
  create: (path: string, url: string) => insert.run(path, url).changes > 0,
  setUmamiId: (path: string, id: string, url: string) => setUmamiId.run(id, path, url),
  delete: (path: string) => remove.run(path).changes > 0,
  deleteMany: (paths: string[]) => removeMany(paths),
  list: (search: string, limit: number, offset: number) => ({
    items: list.all(search, search, limit, offset),
    total: count.get(search, search)!.total,
  }),
  createGenerated(url: string): string {
    const existing = byUrl.get(url);
    if (existing) return existing.short_link;

    const hash = createHash("sha1").update(url, "utf8").digest("hex");
    for (let length = 8; length <= hash.length; length++) {
      const path = hash.slice(0, length);
      if (this.create(path, url)) return path;
      // Another process may have inserted this same URL first.
      if (byPath.get(path)?.original_url === url) return path;
    }
    throw new Error("Unable to allocate a unique SHA-1 short code");
  },
};
