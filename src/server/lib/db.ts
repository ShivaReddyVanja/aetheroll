import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export interface DatabaseInterface {
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  get<T = any>(sql: string, params?: any[]): Promise<T | null>;
  run(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowid?: number | bigint }>;
  exec(sql: string): Promise<void>;
}

// Global SQLite instance for local Node/Next.js dev
let localDbInstance: Database.Database | null = null;

function getLocalDatabase(): Database.Database {
  if (!localDbInstance) {
    const dbDir = path.resolve(process.cwd(), ".data");
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, "local.sqlite");
    localDbInstance = new Database(dbPath);
    localDbInstance.pragma("journal_mode = WAL");
    localDbInstance.pragma("foreign_keys = ON");

    // Automatically run initial migration if empty
    const migrationPath = path.resolve(process.cwd(), "migrations/0001_initial_schema.sql");
    if (fs.existsSync(migrationPath)) {
      const migrationSql = fs.readFileSync(migrationPath, "utf-8");
      localDbInstance.exec(migrationSql);
    }
  }
  return localDbInstance;
}

/**
 * Returns a database wrapper compatible with both Cloudflare D1 and Local SQLite
 */
export function getDb(cloudflareD1?: any): DatabaseInterface {
  // If running inside Cloudflare Worker with D1 binding
  if (cloudflareD1 && typeof cloudflareD1.prepare === "function") {
    return {
      async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
        const stmt = cloudflareD1.prepare(sql).bind(...params);
        const { results } = await stmt.all();
        return results as T[];
      },
      async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
        const stmt = cloudflareD1.prepare(sql).bind(...params);
        const result = await stmt.first();
        return (result ?? null) as T | null;
      },
      async run(sql: string, params: any[] = []): Promise<{ changes: number }> {
        const stmt = cloudflareD1.prepare(sql).bind(...params);
        const res = await stmt.run();
        return { changes: res.meta?.changes ?? 0 };
      },
      async exec(sql: string): Promise<void> {
        await cloudflareD1.exec(sql);
      },
    };
  }

  // Fallback to local SQLite (better-sqlite3) for local Next.js dev server
  const db = getLocalDatabase();
  return {
    async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      const stmt = db.prepare(sql);
      return stmt.all(...params) as T[];
    },
    async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
      const stmt = db.prepare(sql);
      const res = stmt.get(...params);
      return (res ?? null) as T | null;
    },
    async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
      const stmt = db.prepare(sql);
      const res = stmt.run(...params);
      return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
    },
    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },
  };
}
