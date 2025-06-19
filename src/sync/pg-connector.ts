import postgres from "postgres";
import type {
  CursorOptions,
  DatabaseConnector,
  Dependency,
  DependencyAnalyzerOptions,
  Hash,
  TableRows,
} from "./dependency-tree.ts";
import { log } from "../log.ts";
import { trace } from "@opentelemetry/api";
import { shutdownController } from "../shutdown.ts";

const ctidSymbol = Symbol("ctid");
type Row = NonNullable<postgres.Row & Iterable<postgres.Row>> & {
  [ctidSymbol]: string;
};

type ColumnStats = {
  nullFraction: number;
  commonElems: unknown[] | null;
  commonElemFrequencies: number[] | null;
  distinctValues: number;
  histogramBounds: unknown[] | null;
  rangeBoundsHistogram: unknown[] | null;
};
export type ColumnMetadata = {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  stats: ColumnStats | null;
};
export type TableMetadata = {
  tableName: string;
  rowCountEstimate: number;
  pageCount: number;
  columns: ColumnMetadata[];
};

type PostgresTuple = { data: Row; table: TableName };
export type TableStats = {
  tupleEstimate: bigint;
  pageCount: number;
};

export type SerializeResult = {
  schema: TableMetadata[];
  serialized: string;
  sampledRecords: Record<TableName, number>;
};

export type RecentQuery = {
  username: string;
  query: string;
  meanTime: number;
  calls: string;
  rows: string;
  topLevel: boolean;
};

export type RecentQueriesError =
  | {
      kind: "error";
      type: "postgres_error";
      error: string;
    }
  | {
      kind: "error";
      type: "extension_not_installed";
      extensionName: string;
    };

export type RecentQueriesResult =
  | {
      kind: "ok";
      queries: RecentQuery[];
    }
  | RecentQueriesError;

export class PostgresConnector implements DatabaseConnector<PostgresTuple> {
  private static readonly QUERY_DOCTOR_USER = "query_doctor_db_link";
  private readonly tupleEstimates = new Map<TableName, number>();
  /**
   * The minimum size for a table to be considered for sampling.
   * Otherwise we use the `order by random()` instead.
   */
  private static readonly MIN_SIZE_FOR_TABLESAMPLE = 10_000;
  constructor(private readonly sql: postgres.Sql) {}

  async onStartAnalyze(_schema: string): Promise<void> {
    const results = await this.sql`
        SELECT relname AS table, n_live_tup AS count FROM pg_stat_user_tables
      `;
    for (const result of results) {
      this.tupleEstimates.set(result.table, result.count);
    }
    // it's important to refresh the stats
    try {
      await this.sql`vacuum analyze`;
    } catch (_err) {
      // but not the end of the world if we can't
    }
  }

  async dependencies(schema: string) {
    const out = await this.sql<Dependency[]>`
        SELECT
        pg_tables.tablename AS "sourceTable",
        fk."sourceColumn" AS "sourceColumn",
        fk."referencedTable" AS "referencedTable",
        fk."referencedColumn" AS "referencedColumn"
    FROM
        pg_tables
    -- using left join to make sure we get all tables, even if they have no dependencies
    LEFT JOIN LATERAL (
      SELECT
        pgc.relname::TEXT AS "sourceTable",
        ARRAY_AGG(pa.attname::TEXT ORDER BY conkey_unnest.ord) AS "sourceColumn",
        confrelid::regclass::TEXT AS "referencedTable",
        ARRAY_AGG(con_pk_att.attname::TEXT ORDER BY conkey_unnest.ord) AS "referencedColumn"
      FROM
        pg_constraint AS pc
      JOIN
        pg_class AS pgc
        ON pgc.oid = pc.conrelid
      JOIN
          pg_namespace AS pgn
          ON pgn.oid = pgc.relnamespace
      JOIN
          UNNEST(pc.conkey) WITH ORDINALITY AS conkey_unnest(attnum, ord)
          ON TRUE
      JOIN
          UNNEST(pc.confkey) WITH ORDINALITY AS confkey_unnest(attnum, ord)
          ON conkey_unnest.ord = confkey_unnest.ord -- Join by ordinality
      JOIN
          pg_attribute AS pa
          ON pa.attrelid = pc.conrelid AND pa.attnum = conkey_unnest.attnum
      JOIN
          pg_attribute AS con_pk_att
          ON con_pk_att.attrelid = pc.confrelid AND con_pk_att.attnum = confkey_unnest.attnum
      WHERE
          pc.contype = 'f' -- 'f' stands for foreign key
          AND pgn.nspname = ${schema}
          AND pgc.relname = pg_tables.tablename
      GROUP BY
          pgc.relname, pc.oid, confrelid
      ORDER BY
          pgc.relname
    ) AS fk ON TRUE
    WHERE
        pg_tables.schemaname = ${schema}
    ORDER BY
        pg_tables.tablename, fk."referencedTable", fk."sourceColumn";
    `;

    return out;
  }

  async get(table: string, values: Record<string, unknown>) {
    const columnsText = Object.keys(values)
      .map((key, i) => `${doubleQuote(key)} = $${i + 1}`)
      .join(" AND ");
    const sqlString = `select *, ctid from ${doubleQuote(
      table
    )} where ${columnsText} limit 1`;
    const params = Object.values(values);
    const span = trace.getActiveSpan();
    const start = Date.now();
    const data = await this.sql.unsafe(
      sqlString,
      params as postgres.ParameterOrJSON<never>[]
    );
    const end = Date.now();
    span?.addEvent("get", end, start);
    if (data.length === 0) {
      return undefined;
    }
    const newValue = data[0] as Row;
    newValue[ctidSymbol] = newValue.ctid;
    delete newValue.ctid;
    return {
      table,
      data: newValue,
    };
  }
  /**
   * Generate a stream of potentially new values to insert into the database
   *
   * Uses the good old `order by random()` for small tables.
   *
   * For larger tables, it uses the `bernoulli` tablesystem to get a random sample of the table.
   * @param table Table to source values from
   * @param options Options for the cursor
   * @returns
   */
  async *cursor(
    table: string,
    options: CursorOptions
  ): AsyncGenerator<PostgresTuple, void, unknown> {
    const tupleEstimate = this.tupleEstimates.get(table);
    if (tupleEstimate === undefined) {
      console.warn(
        `No tuple estimate for ${table}. Falling back to slow query. Is the db vacuum analyzed?`
      );
    }
    let cursor: AsyncIterable<
      NonNullable<postgres.Row & Iterable<postgres.Row>>[],
      void,
      unknown
    >;
    if (
      tupleEstimate === undefined ||
      tupleEstimate < PostgresConnector.MIN_SIZE_FOR_TABLESAMPLE
    ) {
      await this.sql`select setseed(${options.seed})`;
      cursor = this.sql
        // we want to make sure the rows we get are deterministic
        .unsafe(`select *, ctid from ${table} order by random()`)
        .cursor(1);
    } else {
      // this really needs to be tweaked lol
      cursor = this.sql
        .unsafe(
          `select *, ctid from ${table} tablesample bernoulli(${
            options.requiredRows / tupleEstimate + 10
          }) repeatable(1)`
        )
        .cursor(1);
    }
    for await (const [value] of cursor) {
      if (shutdownController.signal.aborted) {
        break;
      }
      if (value === undefined) {
        log.error(
          `Cursor for table ${table} returned an undefined value`,
          "pg-connector:cursor"
        );
        continue;
      }
      const ctid = value.ctid;
      const data = value as Row;
      data[ctidSymbol] = ctid;
      delete data.ctid;
      yield { data, table };
    }
  }
  /**
   * Serializes sampled data using postgres's `quote_literal` function
   * into batched INSERT statements that can be restored into IXR.
   */
  async serialize(
    schemaName: string,
    tables: TableRows<Row>,
    options: DependencyAnalyzerOptions
  ): Promise<SerializeResult> {
    const schema = await this.getSchema(schemaName);
    const mkKey = (table: string, column: string) =>
      `${table.toLowerCase()}:${column}`;
    const schemaMap = new Map<string, ColumnMetadata>();
    for (const table of schema) {
      for (const column of table.columns) {
        schemaMap.set(mkKey(table.tableName, column.columnName), column);
      }
    }
    const comments = [
      `-- START:Sampled data`,
      `-- Sampled by @query-doctor/sync on ${new Date().toISOString()} | options = ${JSON.stringify(
        options
      )}`,
      "--",
      "-- Note: Using session_replication_role to prevent foreign key constraints from being checked.",
      "-- If adding new rows manually, you might want to put new insert statements after the sampled data.",
    ];
    const directives = ["SET session_replication_role = 'replica';"];
    let out = `${comments.join("\n")}\n${directives.join("\n")}\n\n`;
    const sampledRecords: Record<TableName, number> = {};
    // In _theory_ the correct way to do this serialization is to first do
    // a topological sort on the dependency graph and then serialize the tables
    // in the order of the sort to prevent problems with foreign key constraints.
    //
    // We also have the option of using `SET CONSTRAINTS ALL DEFERRED;` to defer
    // the constraints until after the data is inserted BUT that requires a transaction
    // and using transactions in user schema restorations can prevent certain kinds of actions
    // (like vacuum) from being performed.
    //
    // Instead we restore tables using `set session_replication_role = 'replica';`
    // to prevent the constraints from being checked.
    for (const [table, rows] of Object.entries(tables)) {
      const tableSchema = schema.find((s) => s.tableName === table);
      const allCtids = rows.map((row) => row[ctidSymbol]);
      if (!tableSchema) {
        console.warn(`No schema found for ${table}. Skipping.`);
        continue;
      }
      const columns = tableSchema.columns.map((c) => c.columnName);
      const quotes = columns.map(
        (c) => `quote_literal(${doubleQuote(c)}) as ${doubleQuote(c)}`
      );
      const query = `select ${quotes.join(
        ",\n  "
      )} from (select * from ${doubleQuote(
        table
      )} where ctid = any($1::tid[])) as samples`;
      const serialized = await this.sql.unsafe(query, [allCtids]);

      const estimate = this.tupleEstimates.get(table) ?? "?";
      const comment = `-- ${table} | ${
        serialized.length
      } sampled out of ${estimate.toLocaleString()} (estimate)`;
      const insertStatement = `${comment}\nINSERT INTO ${schemaName}.${doubleQuote(
        table
      )} (${tableSchema.columns
        .map((c) => doubleQuote(c.columnName))
        .join(", ")}) VALUES\n`;
      if (serialized.length === 0) {
        console.warn(`No rows found for ${table}. Skipping.`);
        continue;
      }
      const serializedRows = [];
      for (const row of serialized) {
        serializedRows.push(
          `(${tableSchema.columns
            .map((col) => {
              const value = row[col.columnName];
              if (value === null) {
                return "NULL";
              }
              return value;
            })
            .join(", ")})`
        );
      }
      out += `${insertStatement}  ${serializedRows.join(",\n  ")};\n\n`;
      sampledRecords[table] = serialized.length;
    }
    log.info(
      `Serialized ${Object.keys(tables).length} tables`,
      "pg-connector:serialize"
    );
    out += `-- END:Sampled data\nSET session_replication_role = 'origin';\n\n`;
    return {
      schema,
      serialized: out,
      sampledRecords,
    };
  }

  hash(value: PostgresTuple): Hash {
    return `${value.table}:${value.data[ctidSymbol]}` as Hash;
  }

  public async getSchema(schemaName: string): Promise<TableMetadata[]> {
    const results = await this.sql<TableMetadata[]>`
      SELECT
          c.table_name as "tableName",
          cl.reltuples as "rowCountEstimate",
          cl.relpages as "pageCount",
          json_agg(
            json_build_object(
              'columnName', c.column_name,
              'dataType', c.data_type,
              'isNullable', (c.is_nullable = 'YES')::boolean,
              'stats', (
                select json_build_object(
                  'nullFraction', s.null_frac,
                  'commonElems', s.most_common_elems,
                  'commonElemFrequencies', s.most_common_elem_freqs,
                  'distinctValues', s.n_distinct,
                  'histogramBounds', s.histogram_bounds
                )
                  from pg_stats s
                where s.schemaname = ${schemaName}
                  and s.tablename = c.table_name
                  and s.attname = c.column_name
              )
            )
          ORDER BY c.ordinal_position) as columns
      FROM
          information_schema.columns c
      JOIN
          pg_class cl
          ON cl.relname = c.table_name
      JOIN
          pg_namespace n
          ON n.oid = cl.relnamespace
      WHERE
          c.table_schema = ${schemaName}
          and c.table_name not in ('pg_stat_statements', 'pg_stat_statements_info')
      GROUP BY
          c.table_name, cl.reltuples, cl.relpages;
    `;
    return results;
  }

  public async getDatabaseInfo() {
    const results = await this.sql<
      {
        serverVersion: string;
        serverVersionNum: string;
      }[]
    >`
      select version() as "serverVersion", current_setting('server_version_num') as "serverVersionNum";
    `;
    return {
      serverVersion: results[0]!.serverVersion,
      serverVersionNum: results[0]!.serverVersionNum,
    };
  }

  public async getRecentQueries(): Promise<RecentQueriesResult> {
    try {
      const results = await this.sql<RecentQuery[]>`
      SELECT
        pg_user.usename as "username",
        query,
        mean_exec_time as "meanTime",
        calls,
        rows,
        toplevel as "topLevel"
      FROM pg_stat_statements
      JOIN pg_user ON pg_user.usesysid = pg_stat_statements.userid
      WHERE userid != (select usesysid from pg_user where usename = ${PostgresConnector.QUERY_DOCTOR_USER})
        and query not like '%pg_stat_statements%'
      LIMIT 10;
    `; // we're excluding `pg_stat_statements` from the results since it's almost certainly unrelated
      return {
        kind: "ok",
        queries: results,
      };
    } catch (err) {
      console.error(err);
      if (err instanceof Error) {
        if (
          err.message.includes('relation "pg_stat_statements" does not exist')
        ) {
          return {
            kind: "error",
            type: "extension_not_installed",
            extensionName: "pg_stat_statements",
          };
        }
      }
      return {
        kind: "error",
        type: "postgres_error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async checkPrivilege(): Promise<{
    username: string;
    isSuperuser: boolean;
  }> {
    const [results] = await this.sql<
      { username: string; isSuperuser: boolean }[]
    >`
      SELECT usename as "username", usesuper as "isSuperuser" FROM pg_user WHERE usename = current_user;
    `;
    if (!results) {
      return { username: "unknown", isSuperuser: false };
    }
    return { username: results.username, isSuperuser: results.isSuperuser };
  }
}

const PROBABLY_NO_QUOTE_NEEDED = /^[a-z0-9_]+$/;
function doubleQuote(value: string) {
  if (PROBABLY_NO_QUOTE_NEEDED.test(value)) {
    return value;
  }
  return `"${value}"`;
}
type TableName = string;
