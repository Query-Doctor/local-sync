import postgres from "postgres";
import {
  DependencyAnalyzer,
  type DependencyAnalyzerOptions,
  DependencyResolutionNotice,
  FindAllDependenciesError,
} from "./dependency-tree.ts";
import {
  PostgresConnector,
  RecentQuery,
  type TableMetadata,
} from "./pg-connector.ts";
import { PostgresSchemaLink } from "./schema.ts";
import { withSpan } from "../otel.ts";
import { SpanStatusCode } from "@opentelemetry/api";

type SyncOptions = DependencyAnalyzerOptions;

type PostgresConnectionError = {
  kind: "error";
  type: "postgres_connection_error";
  error: Error;
};

type PostgresError = {
  kind: "error";
  type: "postgres_error";
  error: Error;
};

type PostgresSuperuserError = {
  kind: "connected_as_superuser";
  username: string;
};

export type SyncNotice = DependencyResolutionNotice | PostgresSuperuserError;

type RecentQueries =
  | {
      kind: "ok";
      results: RecentQuery[];
    }
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

export type SyncResult =
  | {
      kind: "ok";
      versionNum: string;
      version: string;
      setup: string;
      sampledRecords: Record<string, number>;
      notices: SyncNotice[];
      queries: RecentQueries;
      metadata: TableMetadata[];
    }
  | PostgresConnectionError
  | PostgresError
  | FindAllDependenciesError;

export class PostgresSyncer {
  private readonly connections = new Map<string, postgres.Sql>();
  constructor() {}

  async syncWithUrl(
    url: URL,
    schemaName: string,
    options: SyncOptions
  ): Promise<SyncResult> {
    // we don't want to allow localhost access for hosted sync instances
    // to prevent users from connecting to our hosted db
    // (even though all our dbs should should be password protected)
    const isLocalhost =
      url.hostname === "localhost" ||
      // ipv4 localhost
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
      // ipv6 localhost
      url.hostname === "[::1]";
    if (isLocalhost && Deno.env.get("DISALLOW_LOCAL_SYNC") === "true") {
      return {
        kind: "error",
        type: "postgres_connection_error",
        error: new Error(
          "Syncing to localhost is not allowed. Run the sync server locally to access your local database"
        ),
      };
    }
    const urlString = url.toString();
    let sql = this.connections.get(urlString);
    if (!sql) {
      sql = postgres(urlString);
      this.connections.set(urlString, sql);
    }
    try {
      await this.checkConnection(sql);
    } catch (err) {
      // dual stack networking (ipv4/ipv6) really screws us here because
      // it throws an AggregateError which is annoying to catch
      const error =
        err instanceof AggregateError
          ? (err.errors[0] as Error)
          : err instanceof Error
          ? err
          : new Error("Unknown error");
      return {
        kind: "error",
        type: "postgres_connection_error",
        error,
      };
    }
    const connector = new PostgresConnector(sql);
    const link = new PostgresSchemaLink(urlString, schemaName);
    const analyzer = new DependencyAnalyzer(connector, options);
    const [databaseInfo, recentQueries, schema, dependencies, privilege] =
      await Promise.all([
        withSpan("getDatabaseInfo", () => {
          return connector.getDatabaseInfo();
        })(),
        withSpan("getRecentQueries", () => {
          return connector.getRecentQueries();
        })(),
        withSpan("syncSchema", () => {
          return link.syncSchema(schemaName);
        })(),
        withSpan("resolveDependencies", async (span) => {
          span.setAttribute("schemaName", schemaName);
          const deps = await analyzer.findAllDependencies(schemaName);
          console.log(deps);
          if (deps.kind !== "ok") {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message:
                deps.type === "unexpected_error"
                  ? deps.error.message
                  : deps.type,
            });
          }
          return deps;
        })(),
        withSpan("checkPrivilege", () => {
          return connector.checkPrivilege();
        })(),
      ]);

    if (dependencies.kind !== "ok") {
      return dependencies;
    }

    const notices: SyncNotice[] = [...dependencies.notices];

    if (privilege.isSuperuser) {
      notices.push({
        kind: "connected_as_superuser",
        username: privilege.username,
      });
    }

    const result = await withSpan("serialize", (span) => {
      span.setAttribute("schemaName", schemaName);
      return connector.serialize(schemaName, dependencies.items, options);
    })();
    const wrapped = schema + result.serialized;

    let queries: RecentQueries;
    if (recentQueries.kind === "ok") {
      queries = {
        kind: "ok",
        results: recentQueries.queries,
      };
    } else {
      queries = recentQueries;
    }
    return {
      kind: "ok",
      versionNum: databaseInfo.serverVersionNum,
      version: databaseInfo.serverVersion,
      sampledRecords: result.sampledRecords,
      notices,
      queries,
      setup: wrapped,
      metadata: result.schema,
    };
  }

  private async checkConnection(sql: postgres.Sql) {
    await sql`select 1`;
  }
}
