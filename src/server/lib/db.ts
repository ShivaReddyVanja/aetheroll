import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export interface QueryOptions {
  skipBilling?: boolean;
  collector?: any;
}

export interface DatabaseInterface {
  all<T = any>(sql: string, params?: any[], options?: QueryOptions): Promise<T[]>;
  get<T = any>(sql: string, params?: any[], options?: QueryOptions): Promise<T | null>;
  run(sql: string, params?: any[], options?: QueryOptions): Promise<{ changes: number; lastInsertRowid?: number | bigint }>;
  exec(sql: string, options?: QueryOptions): Promise<void>;
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

    // Automatically run all migrations in migrations directory
    const migrationsDir = path.resolve(process.cwd(), "migrations");
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        const migrationSql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
        localDbInstance.exec(migrationSql);
      }
    }
  }
  return localDbInstance;
}

/**
 * Converts any GramJS BigInteger, Long, BigInt, or primitive to a JS number safely
 */
export function toSafeNumber(val: any, fallback: number = 0): number {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "number") return Number.isFinite(val) ? val : fallback;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "object") {
    if (typeof val.toJSNumber === "function") {
      const num = val.toJSNumber();
      if (Number.isFinite(num)) return num;
    }
    if (typeof val.toNumber === "function") {
      const num = val.toNumber();
      if (Number.isFinite(num)) return num;
    }
    if (typeof val.toString === "function") {
      const parsed = Number(val.toString());
      return Number.isFinite(parsed) ? parsed : fallback;
    }
  }
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Converts any object/value to a safe string
 */
export function toSafeString(val: any, fallback: string = ""): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "string") return val;
  if (typeof val === "object" && typeof val.toString === "function") {
    return val.toString();
  }
  return String(val);
}

/**
 * Sanitizes parameters bound to Cloudflare D1 so objects are converted to primitives
 */
export function sanitizeD1Param(val: any): any {
  if (val === null || val === undefined) return null;
  if (typeof val === "number" || typeof val === "string" || typeof val === "boolean") return val;
  if (typeof val === "bigint") return Number(val);
  if (val instanceof ArrayBuffer || ArrayBuffer.isView(val)) return val;
  if (typeof val === "object") {
    if (typeof val.toJSNumber === "function") return val.toJSNumber();
    if (typeof val.toNumber === "function") return val.toNumber();
    if (typeof val.toString === "function") {
      const str = val.toString();
      const num = Number(str);
      return Number.isFinite(num) && !isNaN(num) && String(num) === str ? num : str;
    }
  }
  return String(val);
}

/**
 * Returns a database wrapper compatible with both Cloudflare D1 and Local SQLite
 */
export function getDb(cloudflareD1?: any): DatabaseInterface {
  // If running inside Cloudflare Worker with D1 binding
  if (cloudflareD1 && typeof cloudflareD1.prepare === "function") {
    return {
      async all<T = any>(sql: string, params: any[] = [], options?: QueryOptions): Promise<T[]> {
        const cleanParams = params.map(sanitizeD1Param);
        const stmt = cloudflareD1.prepare(sql).bind(...cleanParams);
        const res = await stmt.all();
        const results = (res.results ?? []) as T[];
        if (options?.collector && !options?.skipBilling) {
          const readRows = res.meta?.rows_read ?? results.length;
          const writeRows = res.meta?.rows_written ?? 0;
          options.collector.addD1Query(readRows, writeRows);
        }
        return results;
      },
      async get<T = any>(sql: string, params: any[] = [], options?: QueryOptions): Promise<T | null> {
        const cleanParams = params.map(sanitizeD1Param);
        const stmt = cloudflareD1.prepare(sql).bind(...cleanParams);
        const res = await stmt.first();
        const result = (res ?? null) as T | null;
        if (options?.collector && !options?.skipBilling) {
          options.collector.addD1Query(1, 0);
        }
        return result;
      },
      async run(sql: string, params: any[] = [], options?: QueryOptions): Promise<{ changes: number }> {
        const cleanParams = params.map(sanitizeD1Param);
        const stmt = cloudflareD1.prepare(sql).bind(...cleanParams);
        const res = await stmt.run();
        const changes = res.meta?.changes ?? 0;
        if (options?.collector && !options?.skipBilling) {
          const readRows = res.meta?.rows_read ?? 0;
          const writeRows = res.meta?.rows_written ?? changes;
          options.collector.addD1Query(readRows, writeRows);
        }
        return { changes };
      },
      async exec(sql: string, options?: QueryOptions): Promise<void> {
        await cloudflareD1.exec(sql);
        if (options?.collector && !options?.skipBilling) {
          options.collector.addD1Query(0, 0);
        }
      },
    };
  }

  // Fallback to local SQLite (better-sqlite3) for local Next.js dev server
  const db = getLocalDatabase();
  return {
    async all<T = any>(sql: string, params: any[] = [], options?: QueryOptions): Promise<T[]> {
      const stmt = db.prepare(sql);
      const res = stmt.all(...params) as T[];
      if (options?.collector && !options?.skipBilling) {
        options.collector.addD1Query(res.length, 0);
      }
      return res;
    },
    async get<T = any>(sql: string, params: any[] = [], options?: QueryOptions): Promise<T | null> {
      const stmt = db.prepare(sql);
      const res = stmt.get(...params);
      if (options?.collector && !options?.skipBilling) {
        options.collector.addD1Query(res ? 1 : 0, 0);
      }
      return (res ?? null) as T | null;
    },
    async run(sql: string, params: any[] = [], options?: QueryOptions): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
      const stmt = db.prepare(sql);
      const res = stmt.run(...params);
      if (options?.collector && !options?.skipBilling) {
        options.collector.addD1Query(0, res.changes);
      }
      return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
    },
    async exec(sql: string, options?: QueryOptions): Promise<void> {
      db.exec(sql);
      if (options?.collector && !options?.skipBilling) {
        options.collector.addD1Query(0, 0);
      }
    },
  };
}
