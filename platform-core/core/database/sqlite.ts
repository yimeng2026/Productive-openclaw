/**
 * SQLite Database Stub
 * Provides getDb() for in-memory database operations.
 * In production, replace with actual SQLite (better-sqlite3) or PostgreSQL.
 */

export interface SQLiteDB {
  exec(sql: string): Promise<void>;
  all<T = any>(sql: string, ...params: any[]): Promise<T[]>;
  get<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  run(sql: string, ...params: any[]): Promise<{ lastID?: number; changes?: number }>;
  close(): Promise<void>;
}

// Simple in-memory store for stub mode
const tables: Map<string, any[]> = new Map();

class InMemoryDB implements SQLiteDB {
  async exec(sql: string): Promise<void> {
    // Parse CREATE TABLE to initialize in-memory table
    const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
    if (createMatch) {
      const tableName = createMatch[1];
      if (!tables.has(tableName)) {
        tables.set(tableName, []);
      }
    }
    // Parse CREATE INDEX
    const indexMatch = sql.match(/CREATE INDEX IF NOT EXISTS \w+ ON (\w+)/i);
    if (indexMatch) {
      const tableName = indexMatch[1];
      if (!tables.has(tableName)) {
        tables.set(tableName, []);
      }
    }
  }

  async all<T = any>(sql: string, ...params: any[]): Promise<T[]> {
    const tableName = this.extractTableName(sql);
    if (!tableName) return [];
    const rows = tables.get(tableName) || [];

    // Simple WHERE filtering for stub
    if (sql.includes('WHERE') && params.length > 0) {
      const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      if (whereMatch) {
        const col = whereMatch[1];
        return rows.filter((r: any) => r[col] === params[0]) as T[];
      }
    }

    // ORDER BY created_at DESC
    if (sql.includes('ORDER BY') && sql.includes('DESC')) {
      return [...rows].sort((a: any, b: any) => {
        const aVal = a.created_at || a.createdAt || 0;
        const bVal = b.created_at || b.createdAt || 0;
        return String(bVal).localeCompare(String(aVal));
      }) as T[];
    }

    return rows as T[];
  }

  async get<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
    const results = await this.all<T>(sql, ...params);
    return results[0];
  }

  async run(sql: string, ...params: any[]): Promise<{ lastID?: number; changes?: number }> {
    const tableName = this.extractTableName(sql);
    if (!tableName) return { changes: 0 };

    const rows = tables.get(tableName) || [];

    if (sql.trim().toUpperCase().startsWith('INSERT') || sql.trim().toUpperCase().startsWith('REPLACE')) {
      const row: any = {};
      // Extract column names from INSERT
      const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/);
      if (colMatch) {
        const cols = colMatch[1].split(',').map(c => c.trim());
        cols.forEach((col, i) => {
          row[col] = params[i];
        });
      }
      // Also handle ON CONFLICT UPDATE case - extract from INSERT values
      if (Object.keys(row).length === 0) {
        const valuesMatch = sql.match(/VALUES\s*\(([^)]+)\)/);
        if (valuesMatch) {
          const placeholders = valuesMatch[1].split(',').length;
          for (let i = 0; i < Math.min(placeholders, params.length); i++) {
            row[`col${i}`] = params[i];
          }
        }
      }
      // If params contain an object, use it directly
      if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null) {
        Object.assign(row, params[0]);
      }
      rows.push(row);
      return { lastID: rows.length, changes: 1 };
    }

    if (sql.trim().toUpperCase().startsWith('UPDATE')) {
      // Simple stub: mark all as updated
      const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      if (whereMatch) {
        const col = whereMatch[1];
        const count = rows.filter((r: any) => r[col] === params[params.length - 1]).length;
        return { changes: count };
      }
      return { changes: rows.length };
    }

    if (sql.trim().toUpperCase().startsWith('DELETE')) {
      const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      if (whereMatch) {
        const col = whereMatch[1];
        const beforeLen = rows.length;
        const filtered = rows.filter((r: any) => r[col] !== params[0]);
        tables.set(tableName, filtered);
        return { changes: beforeLen - filtered.length };
      }
      tables.set(tableName, []);
      return { changes: rows.length };
    }

    return { changes: 0 };
  }

  async close(): Promise<void> {
    // No-op for in-memory stub
  }

  private extractTableName(sql: string): string | null {
    const patterns = [
      /FROM\s+(\w+)/i,
      /INTO\s+(\w+)/i,
      /UPDATE\s+(\w+)/i,
      /TABLE\s+(\w+)/i,
    ];
    for (const p of patterns) {
      const m = sql.match(p);
      if (m) return m[1];
    }
    return null;
  }
}

let dbInstance: SQLiteDB | null = null;

export async function getDb(): Promise<SQLiteDB> {
  if (!dbInstance) {
    dbInstance = new InMemoryDB();
  }
  return dbInstance;
}

export function resetDb(): void {
  tables.clear();
  dbInstance = null;
}
