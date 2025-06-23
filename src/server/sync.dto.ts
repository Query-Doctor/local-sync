import { z } from "zod/v4";
import { Connectable } from "../sync/connectable.ts";

export const SyncRequest = z.object({
  db: z.string().transform(Connectable.transform),
  seed: z.coerce.number().min(0).max(1).default(0),
  schema: z.coerce.string().default("public"),
  requiredRows: z.coerce.number().positive().default(2),
  maxRows: z.coerce.number().positive().default(8),
});

export type SyncRequest = z.infer<typeof SyncRequest>;
