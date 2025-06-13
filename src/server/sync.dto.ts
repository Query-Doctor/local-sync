import { z } from "npm:zod/v4";

export const SyncRequest = z.object({
  db: z.string().startsWith("postgres://"),
  seed: z.coerce.number().min(0).max(1).default(0),
  schema: z.coerce.string().default("public"),
  requiredRows: z.coerce.number().positive().default(2),
  maxRows: z.coerce.number().positive().default(8),
});

export type SyncRequest = z.infer<typeof SyncRequest>;
