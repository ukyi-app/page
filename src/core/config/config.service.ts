import { Inject, Service } from "../di/decorators";
import { APP_CONFIG } from "./config.tokens";
import type { AppConfig } from "./config";

@Service()
export class ConfigService {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}
  get port(): number { return this.cfg.port; }
  get databaseUrl(): string { return this.cfg.databaseUrl; }
  get migrateDatabaseUrl(): string { return this.cfg.migrateDatabaseUrl; }
  get adminTokenSha256(): string { return this.cfg.adminTokenSha256; }
  get htmlMaxBytes(): number { return this.cfg.htmlMaxBytes; }
  get jsonMaxBytes(): number { return this.cfg.jsonMaxBytes; }
  get dbConnectionTimeoutMs(): number { return this.cfg.dbConnectionTimeoutMs; }
  get dbStatementTimeoutMs(): number { return this.cfg.dbStatementTimeoutMs; }
  get dbOperationTimeoutMs(): number { return this.cfg.dbOperationTimeoutMs; }
}
