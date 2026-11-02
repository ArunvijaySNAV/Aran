import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof makeDb>;

export function makeDb(url: string) {
  const client = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
  return Object.assign(drizzle(client, { schema }), { $client: client });
}

let cached: Db | undefined;
/** Process-wide connection (server code). Direct Postgres connection to Supabase, not the REST API. */
export function getDb(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cached = makeDb(url);
  }
  return cached;
}
export { schema };
