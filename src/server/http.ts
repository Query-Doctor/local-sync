import { SpanStatusCode, trace } from "@opentelemetry/api";
import { PostgresSyncer } from "../sync/syncer.ts";
import { log } from "../log.ts";
import * as limiter from "./rate-limit.ts";
import { LiveQueryRequest, SyncRequest } from "./sync.dto.ts";
import { ZodError } from "zod/v4";
import { shutdownController } from "../shutdown.ts";
import { env } from "../env.ts";
import { SyncResult } from "../sync/syncer.ts";

const syncer = new PostgresSyncer();

async function onSync(req: Request) {
  const startTime = Date.now();
  const url = new URL(req.url);

  if (!req.body) {
    return new Response("Missing body", { status: 400 });
  }
  let body: SyncRequest;
  const bodyString = await req.text();
  try {
    body = SyncRequest.parse(JSON.parse(bodyString));
  } catch (e: unknown) {
    if (e instanceof ZodError) {
      return Response.json(
        {
          kind: "error",
          type: "invalid_body",
          error: e.issues.map((issue) => issue.message).join("\n"),
        },
        { status: 400 }
      );
    }
    return Response.json(
      {
        kind: "error",
        type: "unknown_error",
        error: String(e),
      },
      { status: 400 }
    );
  }
  const { seed, schema, requiredRows, maxRows } = body;
  const span = trace.getActiveSpan();
  if (requiredRows > maxRows) {
    log.warn(
      `Notice: \`requiredRows\` (${requiredRows}) is greater than \`maxRows\` (${maxRows})`,
      "http:sync"
    );
  }
  if (maxRows < requiredRows + 2) {
    log.warn(
      `Notice: \`maxRows\` (${maxRows}) is too low. This might cause problems with foreign keys`,
      "http:sync"
    );
  }
  span?.setAttribute("requiredRows", requiredRows);
  span?.setAttribute("db.host", url.hostname);
  let dbUrl: URL;
  // try {
  //   dbUrl = new URL(body.db);
  // } catch (e: unknown) {
  //   span?.setStatus({ code: SpanStatusCode.ERROR, message: "invalid_db_url" });
  //   if (e instanceof Error) {
  //     return Response.json(
  //       { kind: "error", type: "invalid_db_url", error: e.message },
  //       { status: 400 }
  //     );
  //   }
  //   return new Response("Invalid db url", { status: 400 });
  // }
  let result: SyncResult;
  try {
    result = await syncer.syncWithUrl(body.db, schema, {
      requiredRows,
      maxRows,
      seed,
    });
  } catch (error) {
    // We don't throw errors randomly so this should only happen if there's a bug
    if (error instanceof Error && !env.HOSTED) {
      return Response.json(
        { kind: "error", type: "unexpected_error", error: error.message },
        { status: 500 }
      );
    }
    return Response.json(
      {
        kind: "error",
        type: "unexpected_error",
        error: "Internal Server Error",
      },
      { status: 500 }
    );
  }
  if (result.kind !== "ok") {
    span?.setStatus({ code: SpanStatusCode.ERROR, message: result.type });
    if (result.type === "unexpected_error") {
      log.error(result.error.message, "http:sync");
      if (!env.HOSTED) {
        // No problem leaking the error message to the user if they're selfhosting
        return Response.json(
          {
            kind: "error",
            type: "unexpected_error",
            error: result.error.message,
          },
          { status: 500 }
        );
      }
      return Response.json(
        {
          kind: "error",
          type: "unexpected_error",
          error: "Internal Server Error",
        },
        { status: 500 }
      );
    } else if (result.type === "max_table_iterations_reached") {
      return Response.json(
        {
          kind: "error",
          type: "max_table_iterations_reached",
          error: "Max table iterations reached. This is a bug with the syncer",
        },
        {
          status: 500,
        }
      );
    } else if (result.type === "postgres_connection_error") {
      console.log(result);
      log.error(result.error.message, "http:sync");
      return Response.json(
        {
          kind: "error",
          type: "postgres_connection_error",
          error: result.error.message,
        },
        { status: 500 }
      );
    } else if (result.type === "postgres_error") {
      log.error(result.error.message, "http:sync");
      return Response.json(
        {
          kind: "error",
          type: "postgres_error",
          error: result.error.message,
        },
        { status: 500 }
      );
    }
    return new Response("Internal Server Error", { status: 500 });
  }
  span?.setStatus({ code: SpanStatusCode.OK });
  log.info(`Sent sync response in ${Date.now() - startTime}ms`, "http:sync");
  return Response.json(result, { status: 200 });
}

async function onSyncLiveQuery(req: Request) {
  let body: LiveQueryRequest;
  try {
    body = LiveQueryRequest.parse(await req.json());
  } catch (e: unknown) {
    if (e instanceof ZodError) {
      return Response.json(
        {
          kind: "error",
          type: "invalid_body",
          error: e.issues.map((issue) => issue.message).join("\n"),
        },
        { status: 400 }
      );
    }
    throw e;
  }
  const queries = await syncer.liveQuery(body.db);
  if (queries.kind !== "ok") {
    return Response.json(queries, { status: 500 });
  }
  return Response.json(queries, { status: 200 });
}

export function createServer(hostname: string, port: number) {
  return Deno.serve(
    { hostname, port, signal: shutdownController.signal },
    async (req, info) => {
      const url = new URL(req.url);
      log.http(req);

      if (req.method === "OPTIONS") {
        return new Response("OK", {
          status: 200,
          headers: corsHeaders,
        });
      }
      if (url.pathname === "/") {
        return Response.redirect(
          "https://github.com/Query-Doctor/local-sync",
          307
        );
      }
      const limit = limiter.sync.check(url.pathname, info.remoteAddr.hostname);
      if (limit.limited) {
        return limiter.appendHeaders(
          new Response("Rate limit exceeded", { status: 429 }),
          limit
        );
      }
      function handleResponse(res: Response) {
        for (const [key, value] of Object.entries(corsHeaders)) {
          res.headers.set(key, value);
        }
        limiter.appendHeaders(res, limit);
        return res;
      }
      if (url.pathname === "/postgres/all") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        const res = await onSync(req);
        return handleResponse(res);
      } else if (url.pathname === "/postgres/live") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        const res = await onSyncLiveQuery(req);
        return handleResponse(res);
      }
      return new Response("Not found", { status: 404 });
    }
  );
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // cache the preflight requests for 1 day
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers":
    "Content-Type, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
};
