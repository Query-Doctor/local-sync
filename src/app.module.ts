import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { Configuration } from "./config/config.service";
import { validate } from "./config/validator";
import { SyncModule } from "./sync/sync.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    SyncModule,
    ConfigModule.forRoot({ validate }),
  ],
  controllers: [],
  providers: [Configuration],
})
export class AppModule {}
