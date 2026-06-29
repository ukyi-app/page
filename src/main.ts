import "reflect-metadata";
import { AppModule } from "./app.module";
import { buildApp } from "./core/app-factory";
import { PagesService } from "./modules/pages/pages.service";

// 합성 루트 진입점. 런타임 인프라(Pool·repository)는 모듈 provider가 소유하므로
// 여기서 PageRepository/createPool/migrate를 직접 다루지 않는다.
export const createApp = () => buildApp(AppModule);

const { app, config, container } = await createApp();

// soft delete된 페이지의 완전 삭제 스윕. core 팩토리는 feature를 모르므로 엔트리에서 배선한다.
const pages = container.resolve(PagesService);
async function purgeSweep(): Promise<void> {
  try {
    const removed = await pages.purgeExpired(new Date().toISOString());
    if (removed > 0) console.log(`purged ${removed} expired page(s)`);
  } catch (error) {
    console.error("purge sweep failed", error instanceof Error ? error.message : String(error));
  }
}
void purgeSweep();
const purgeTimer = setInterval(purgeSweep, config.purgeSweepIntervalMs);
purgeTimer.unref?.();

Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`page listening on :${config.port}`);
