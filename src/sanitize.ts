import crypto from "node:crypto";

export function sanitizePostgresUrl(db: string): string {
  // sanitization is only needed for the hosted instance
  if (Deno.env.get("HOSTED") !== "true") {
    return db;
  }
  const hash = crypto.createHash("sha256").update(db).digest("hex");
  return `omitted__${hash.slice(0, 8)}`;
}
