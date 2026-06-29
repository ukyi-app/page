import { ConfigService } from "./core/config/config.service";
import { DatabaseModule } from "./core/database/database.module";
import { Module } from "./core/di/module";
import { HealthModule } from "./modules/health/health.module";
import { PagesModule } from "./modules/pages/pages.module";

// 루트 모듈. 합성/부트스트랩은 core/app-factory의 buildApp(테스트) 및 main.ts의 createApp(프로덕션)이 담당.
@Module({
  imports: [DatabaseModule, PagesModule, HealthModule],
  providers: [ConfigService],
})
export class AppModule {}
