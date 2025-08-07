import crypto from "node:crypto";
import { RawRecentQuery, RecentQuery } from "./sync/pg-connector.ts";

interface CacheEntry {
  firstSeen: number;
  lastSeen: number;
}

export class QueryCache {
  list: Record<string, CacheEntry> = {};
  private readonly createdAt: number;

  constructor() {
    this.createdAt = Date.now();
  }

  isCached(key: string): boolean {
    const entry = this.list[key];
    if (!entry) {
      return false;
    }
    return true;
  }

  isNew(key: string): boolean {
    const entry = this.list[key];
    if (!entry) {
      return true;
    }
    return entry.firstSeen >= this.createdAt;
  }

  store(db: string, query: string) {
    const key = hash(db, query);
    const now = Date.now();
    if (this.list[key]) {
      this.list[key].lastSeen = now;
    } else {
      this.list[key] = { firstSeen: now, lastSeen: now };
    }
    return key;
  }

  getFirstSeen(key: string): number {
    return this.list[key]?.firstSeen || Date.now();
  }

  sync(db: string, queries: RawRecentQuery[]): RecentQuery[] {
    return queries.map(query => {
      const key = this.store(db, query.query);
      return {
        ...query,
        firstSeen: this.getFirstSeen(key)
      };
    });
  }
}

export const queryCache = new QueryCache();

function hash(db: string, query: string): string {
  return crypto.createHash("sha256").update(JSON.stringify([db, query])).digest("hex")
}
