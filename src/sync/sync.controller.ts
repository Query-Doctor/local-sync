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

    const { db, pool } = connection;

    let commands = "";
    try {
      commands += await this.syncService.generateEnumSQLs(db);
      commands += await this.syncService.generateCreateTablesAndIndexesSQL(db);
      commands += await this.syncService.getSampleData(pool);
      commands += await this.syncService.getStats(pool);
    } catch (error) {
      console.error(error);
    } finally {
      if (pool) await pool.end();
    }

    return { success: true, data: { commands: commands } };
  }
}
