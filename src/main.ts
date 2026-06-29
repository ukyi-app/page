import "reflect-metadata";
import { AppModule } from "./app.module";
import { buildApp } from "./core/app-factory";

// 합성 루트 진입점. 런타임 인프라(Pool·repository)는 모듈 provider가 소유하므로
// 여기서 PageRepository/createPool/migrate를 직접 다루지 않는다.
export const createApp = () => buildApp(AppModule);

const { app, config } = await createApp();

Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`page listening on :${config.port}`);
