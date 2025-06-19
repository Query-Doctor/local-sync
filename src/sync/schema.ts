import postgres from "postgres";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { log } from "../log.ts";
import { shutdownController } from "../shutdown.ts";

export type TableStats = {
  name: string;
};

export class PostgresSchemaLink {
  private readonly PG_DUMP_VERSION = "17.2";
  private readonly pgDumpBinaryPath: string;
  constructor(
    public readonly sql: postgres.Sql,
    public readonly url: string,
    public readonly schema: string
  ) {
    this.pgDumpBinaryPath = this.findPgDumpBinary();
    // sql.listen("ddl_events", (f) => {
    //   const data = JSON.parse(f);
    //   // {"tag" : "ALTER TABLE", "command" : "ALTER TABLE", "object_type" : "table", "schema" : "public", "identity" : "public.books", "in_extension" : false}
    //   log.info(`(${data.identity}) Schema change detected`, "schema:sync");
    //   this.syncSchema();
    // });
  }

  static fromUrl(url: string, schema: string = "public"): PostgresSchemaLink {
    const sql = postgres(url);
    return new PostgresSchemaLink(sql, url, schema);
  }

  findPgDumpBinary(): string {
    const forcePath = Deno.env.get("PG_DUMP_BINARY");
    if (forcePath) {
      log.info(
        `Using pg_dump binary from env(PG_DUMP_BINARY): ${forcePath}`,
        "schema:setup"
      );
      return forcePath;
    }
    const os = Deno.build.os;
    const arch = Deno.build.arch;
    const shippedPath = `./bin/pg_dump-${this.PG_DUMP_VERSION}/pg_dump.${os}-${arch}`;
    if (!Deno.statSync(shippedPath).isFile) {
      throw new Error(`pg_dump binary not found at ${shippedPath}`);
    }
    log.info(`Using built-in "pg_dump" binary: ${shippedPath}`, "schema:setup");
    return shippedPath;
  }

  async syncSchema(schemaName: string): Promise<string> {
    log.debug("Syncing schema", "schema:sync");
    // const [dumping, omits] = await this.omitBigBois();
    const args = [
      // the owner doesn't exist
      "--no-owner",
      // not needed most likely
      "--no-comments",
      // privileges don't exist
      "--no-privileges",
      // providers like supabase have a ton of stuff we don't need in other schemas
      "--schema",
      schemaName,
      "--schema-only",
      this.url,
    ];
    log.debug(
      `Dumping schema with pg_dump using args: ${args.join(" ")}`,
      "schema:sync"
    );
    const command = new Deno.Command(this.pgDumpBinaryPath, {
      args,
      stdout: "piped",
      stderr: "piped",
      signal: shutdownController.signal,
    });
    const outputPromise = command.output();
    const output = await outputPromise;
    return this.handleSchemaOutput(output);
  }

  private handleSchemaOutput(output: Deno.CommandOutput) {
    const span = trace.getActiveSpan();
    const decoder = new TextDecoder();
    span?.setAttribute("outputBytes", output.stdout.byteLength);
    if (output.code !== 0) {
      const stderr = decoder.decode(output.stderr);
      span?.setStatus({ code: SpanStatusCode.ERROR, message: stderr });
      log.error(`Error: ${stderr}`, "schema:sync");
      throw new Error(stderr);
    }
    log.info(`Dumped schema. bytes=${output.stdout.byteLength}`, "schema:sync");
    const stdout = decoder.decode(output.stdout);
    return this.sanitizeSchema(stdout);
  }

  private sanitizeSchema(schema: string): string {
    // strip CREATE SCHEMA statements and a little bit of extra whitespace.
    // we should also remove the comments describing the schema above but meh
    return schema.replace(/^CREATE SCHEMA\s+.*\n\n?/m, "");
  }

  // async omitBigBois(): Promise<[TableCount[], TableCount[]]> {
  //   const result: TableCount[] = await this.sql`SELECT
  //         relname as "tableName",
  //         n_live_tup as count
  //     FROM pg_stat_user_tables
  //     WHERE schemaname = 'public'
  //     ORDER BY n_live_tup DESC;`;
  //   return partition(
  //     result.map((row) => ({
  //       tableName: row.tableName,
  //       count: Number(row.count),
  //     })),
  //     (row) => row.count < 25
  //   );
  // }
}
