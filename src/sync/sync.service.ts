import { Injectable } from "@nestjs/common";
import pg from "pg";
import pgStructure, { Schema, Db } from "pg-structure";

@Injectable()
export class SyncService {
  async attemptConnection(
    connectionString: string,
  ): Promise<
    { ok: true; db: Db; pool: pg.Pool } | { ok: false; error: string }
  > {
    try {
      const db = await pgStructure({
        connectionString,
        ssl: { rejectUnauthorized: false },
      });

      const pool = new pg.Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
      });

      return { ok: true, db, pool };
    } catch (err) {
      const errorMessage = err.message || "Unknown error";
      const trimmedMessage = errorMessage.replace(
        "pg-structure cannot connect to the database: ",
        "",
      );
      return { ok: false, error: trimmedMessage };
    }
  }

  async generateEnumSQLs(db: Db): Promise<string> {
    const enumSQLs: string[] = [];

    for (const type of db.types.values()) {
      if (type.category !== "E") continue; // 'E' = enum

      const labels = type.values.map((v) => `'${v}'`).join(", ");
      enumSQLs.push(`DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${type.name}') THEN
            CREATE TYPE ${type.name} AS ENUM (${labels});
          END IF;
        END$$;`);
    }

    return enumSQLs.join("\n\n");
  }

  async generateCreateTablesAndIndexesSQL(db: Db): Promise<string> {
    const commands: string[] = [];
    const publicSchema = db.get("public") as Schema;
    const tables = publicSchema.tables;
    tables.forEach((table) => {
      if (!table) throw new Error(`Table "${table}" not found.`);

      const columnDefs: string[] = [];
      const sequences = new Set(); // track unique sequence names

      // Build column definitions
      for (const column of table.columns.values()) {
        let colDef = `"${column.name}" ${column.type.name}`;
        if (column.default) {
          colDef += ` DEFAULT ${column.default}`;
          // Detect sequences used via nextval('sequence_name'::regclass)
          if (typeof column.default !== "string") continue;
          const match = column.default.match(/nextval\('(.+?)'::regclass\)/);
          if (match) {
            sequences.add(match[1]); // sequence name
          }
        }
        if (column.notNull) colDef += " NOT NULL";

        columnDefs.push(colDef);
      }

      // Add primary key
      const primaryKey = table.primaryKey;
      if (primaryKey) {
        const pkCols = primaryKey.columns
          .map((col) => `"${col.name}"`)
          .join(", ");
        columnDefs.push(`PRIMARY KEY (${pkCols})`);
      }

      // CREATE TABLE SQL
      const createTableSQL = `CREATE TABLE "${table.name}" (\n  ${columnDefs.join(
        ",\n  ",
      )}\n);`;

      // Generate CREATE SEQUENCE
      const sequenceSQLs = Array.from(sequences).map(
        (seq) => `CREATE SEQUENCE IF NOT EXISTS ${seq};`,
      );

      // CREATE INDEX statements
      const indexSQLs = [];

      for (const index of table.indexes.values()) {
        if (index.isPrimaryKey) continue; // already added as PRIMARY KEY
        const cols = index.columns.map((c) => `"${c.name}"`).join(", ");
        const unique = index.isUnique ? "UNIQUE " : "";
        const method = index.method ? ` USING ${index.method}` : "";
        indexSQLs.push(
          `CREATE ${unique} INDEX IF NOT EXISTS "${index.name}" ON "${table.name}"${method} (${cols});`,
        );
      }

      commands.push(
        [...sequenceSQLs, createTableSQL, ...indexSQLs].join("\n\n"),
      );
    });
    return commands.join("\n\n");
  }

  async getSampleData(pool: pg.Pool): Promise<string> {
    let updateCommands = "\n\n";
    try {
      const result = await pool.query(
        "select relname from pg_class c join pg_namespace n on n.oid = relnamespace where relkind = 'r' and nspname = 'public'",
      );
      const rows = result.rows;

      for (const row of rows) {
        const sampleRecords = await pool.query(
          `select * from ${row.relname} limit 10`,
        );
        for (const record of sampleRecords.rows) {
          const columns = Object.keys(record);
          const values = Object.values(record).map((val) => {
            if (val === null) {
              return "NULL";
            } else if (val instanceof Date) {
              return `'${val.toISOString()}'`;
            } else if (typeof val === "string") {
              return `'${val.replace(/'/g, "''")}'`;
            } else {
              return val;
            }
          });

          updateCommands += `INSERT INTO ${
            row.relname
          } (${columns.join(", ")}) VALUES (${values.join(", ")});\n`;
        }
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
    return updateCommands;
  }

  async getStats(pool: pg.Pool): Promise<string> {
    let updateCommands = "\n\n";
    try {
      const result = await pool.query(
        "select relname, reltuples::bigint from pg_class c join pg_namespace n on n.oid = relnamespace where relkind = 'r' and nspname = 'public'",
      );
      const rows = result.rows;

      for (const row of rows) {
        updateCommands += `UPDATE pg_class SET reltuples = ${row.reltuples} WHERE relname = '${row.relname}';\n`;
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
    return updateCommands;
  }
}
