import { z } from "zod";

export const Config = z.object({
  PORT: z.coerce.number().default(7777),
});

export type Config = z.infer<typeof Config>;

export function validate(env: Record<string, unknown>): Config {
  return Config.parse(env);
}
