#!/usr/bin/env node

import "@total-typescript/ts-reset";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  // Get command line arguments
  const args = process.argv.slice(2);

  // Check for help flag
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Query Doctor Local Sync - NestJS Application

Usage: npx query-doctor-local-sync [options]

Options:
  --port, -p <port>    Specify the port to run the application (default: 7777)
  --help, -h           Show this help message

This tool starts a NestJS application that is used by querydoctor.com's Index Ray.
    `);
    process.exit(0);
  }

  // Parse port from command line arguments
  let port = 7777;
  const portIndex = args.findIndex((arg) => arg === "--port" || arg === "-p");
  if (portIndex >= 0 && args.length > portIndex + 1) {
    const portArg = parseInt(args[portIndex + 1], 10);
    if (!isNaN(portArg)) {
      port = portArg;
      // Set PORT environment variable for the Configuration service
      process.env.PORT = port.toString();
    }
  }

  try {
    // Create a full NestJS application
    const app = await NestFactory.create(AppModule, {
      bufferLogs: true,
      rawBody: true,
    });
    const logger = new Logger("Bootstrap");

    app.enableCors();

    logger.log(
      `Starting Query Doctor Local Sync application for querydoctor.com's Index Ray...`,
    );
    logger.log(`Listening on port ${port}`);

    await app.listen(port);
  } catch (error) {
    console.error("An error occurred:", error);
    process.exit(1);
  }
}

bootstrap();
