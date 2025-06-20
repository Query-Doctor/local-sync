import { createServer } from "./src/server/http.ts";
import { log } from "./src/log.ts";
import { shutdown } from "./src/shutdown.ts";
import { env } from "./src/env.ts";

// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  const os = Deno.build.os;
  const arch = Deno.build.arch;
  log.info(
    `Starting server (${os}-${arch}) on ${env.HOST}:${env.PORT}`,
    "main"
  );
  createServer(env.HOST, env.PORT);

  Deno.addSignalListener("SIGTERM", shutdown);
  Deno.addSignalListener("SIGINT", shutdown);
}
