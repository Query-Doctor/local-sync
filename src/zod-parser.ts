import { BadRequestException } from "@nestjs/common";
import { ZodError, ZodTypeAny } from "zod";

export function parseBody<T extends ZodTypeAny>(
  schema: T,
  body: string,
): T["_output"] {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err);
    }
    console.log("not error", err);
    throw err;
  }
}

export function extractHeader(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const value = headers[key];
  if (Array.isArray(value)) {
    throw new BadRequestException(`Found multiple values for header '${key}'`);
  }
  if (!value) {
    throw new BadRequestException(`Missing header '${key}'`);
  }
  return value;
}
