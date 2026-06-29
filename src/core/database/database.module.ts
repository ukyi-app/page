import type { Pool } from "pg";
import { ConfigService } from "../config/config.service";
import { Module } from "../di/module";
import { createPool } from "./db";
import { PG_POOL } from "./database.tokens";

@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (config: ConfigService): Pool =>
        createPool(config.databaseUrl, {
          connectionTimeoutMs: config.dbConnectionTimeoutMs,
          statementTimeoutMs: config.dbStatementTimeoutMs,
        }),
      inject: [ConfigService],
    },
  ],
})
export class DatabaseModule {}
