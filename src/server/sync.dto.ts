import { z } from "zod/v4";

export const SyncRequest = z.object({
  // We shouldn't be doing separate validations on both the front end and here? Should probably consolidate
  db: z
    .string()
    .refine(
      (val) => val.startsWith("postgres://") || val.startsWith("postgresql://"),
      {
        message: "Must start with 'postgres://' or 'postgresql://'",
      }
    ),
  seed: z.coerce.number().min(0).max(1).default(0),
  schema: z.coerce.string().default("public"),
  requiredRows: z.coerce.number().positive().default(2),
  maxRows: z.coerce.number().positive().default(8),
});

export type SyncRequest = z.infer<typeof SyncRequest>;
