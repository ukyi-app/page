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
  // 일부 테스트는 AppConfig 리터럴에 purge 키를 두지 않으므로 안전한 기본값으로 폴백한다.
  get purgeGraceMs(): number { return this.cfg.purgeGraceMs ?? 7 * 24 * 60 * 60 * 1_000; }
  get purgeSweepIntervalMs(): number { return this.cfg.purgeSweepIntervalMs ?? 60 * 60 * 1_000; }
}
