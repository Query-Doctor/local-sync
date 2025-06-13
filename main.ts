import postgres from "npm:postgres";
import { createServer } from "./src/server/http.ts";
import { PostgresConnector } from "./src/sync/pg-connector.ts";
import { PostgresSchemaLink } from "./src/sync/schema.ts";
import { log } from "./src/log.ts";

const DEFAULT_PORT = 2345;
// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  const os = Deno.build.os;
  const arch = Deno.build.arch;
  const port = Deno.env.get("PORT") || DEFAULT_PORT;
  log.info(`Starting server (${os}-${arch}) on port ${port}`, "main");
  createServer(Number(port));
  // const requiredRows = 3;
  // const sync = new PostgresSyncer();
  // const result = await sync.syncWithUrl(
  //   "postgres://query_doctor_db_link:query_doctor_db_link@localhost:5432/hatira_dev",
  //   "public",
  //   { requiredRows: 2, seed: 0 }
  // );
  // // console.log(result.);
  // if (result.kind === "ok") {
  //   console.log(result.schema);
  // }
}
Deno.addSignalListener("SIGTERM", () => {
  Deno.exit(0);
});

Deno.addSignalListener("SIGINT", () => {
  Deno.exit(0);
});
