import "express";
import type { Session } from "express-session";

declare module "express" {
  interface CustomSession extends Session {
    /**
     * Don't use this field for accessing the user's id.
     * Use {@link AuthGuard.session} to get the user's session instead.
     */
    userId?: string;
  }

  interface Request {
    session: CustomSession;
  }
}
