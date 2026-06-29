import { Module } from "../../core/di/module";
import { AdminUiController } from "./admin-ui.controller";

// 관리 SPA를 /admin에서 서빙한다. 가드 없음(로그인 셸은 공개; 실제 동작은 토큰 필요).
@Module({
  controllers: [AdminUiController],
})
export class AdminModule {}
