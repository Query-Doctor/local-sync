import { z } from "zod";
import { mapValues } from "@std/collections";

const envSchema = z.object({
  PG_DUMP_BINARY: z.string().optional(),
  HOSTED: z.coerce.boolean().default(false),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().min(1024).max(65535).default(2345),
});

// we want to avoid asking for ALL env permissions if possible
export const env = envSchema.parse(
  mapValues(envSchema._def.shape(), (_, key) => Deno.env.get(key))
);
