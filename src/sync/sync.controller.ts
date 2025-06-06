import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { SyncService } from "./sync.service";

@Controller("sync")
export class SyncController {
  constructor(readonly syncService: SyncService) {}

  @Post()
  async generateStructure(@Body() body: { connectionString: string }) {
    const connection = await this.syncService.attemptConnection(
      body.connectionString,
    );

    if (!connection.ok) {
      return new BadRequestException(connection.error);
    }

    let commands = "";
    try {
      commands += await this.syncService.generateEnumSQLs(
        body.connectionString,
      );
      commands += await this.syncService.generateCreateTablesAndIndexesSQL(
        body.connectionString,
      );
      commands += await this.syncService.getSampleData(body.connectionString);
      commands += await this.syncService.getStats(body.connectionString);
    } catch (error) {
      console.error(error);
    }

    return { success: true, data: { commands: commands } };
  }
}
