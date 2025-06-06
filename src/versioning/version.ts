import { z } from "zod";

// TODO: This should be parsed semver string
export const Version = z.string().brand("Version");

export type Version = z.infer<typeof Version>;
