import { z } from "zod";

const envSchema = z.object({
  HOSTED: z.coerce.boolean().default(false),
  PORT: z.coerce.number().min(1024).max(65535).default(3000),
});

export const env = envSchema.parse(Deno.env.toObject());
