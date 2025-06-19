import { createServer } from "./src/server/http.ts";
import { log } from "./src/log.ts";
import { shutdown } from "./src/shutdown.ts";

const DEFAULT_PORT = 2345;

// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  const os = Deno.build.os;
  const arch = Deno.build.arch;
  const port = Deno.env.get("PORT") || DEFAULT_PORT;
  log.info(`Starting server (${os}-${arch}) on port ${port}`, "main");
  createServer(Number(port));

  Deno.addSignalListener("SIGTERM", shutdown);
  Deno.addSignalListener("SIGINT", shutdown);
}
