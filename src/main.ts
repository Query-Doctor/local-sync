import "@total-typescript/ts-reset";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { Configuration } from "./config/config.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const logger = new Logger("Bootstrap");

  const config: Configuration = app.get(Configuration);

  app.enableCors();

  const port = config.getOrThrow("PORT");

  logger.log(`Listening on port ${port}`);
  await app.listen(port);
}
bootstrap();
