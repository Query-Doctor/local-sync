import { Injectable, NestMiddleware, Logger } from "@nestjs/common";
import { NextFunction, Response } from "express";

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private logger = new Logger(`HTTP`);
  use(req: Request, res: Response, next: NextFunction) {
    this.logger.log(`${req.method} ${req.url} ${res.statusCode}`);
    next();
  }
}
