import type { DependencyContainer } from "tsyringe";
import { PageRenderController } from "./page-render.controller";
import { PagesAdminController } from "./pages.admin.controller";

export const PagesModule = {
  // 컨트롤러는 합성 루트에서 resolve. 등록할 추가 프로바이더가 없으면 no-op.
  register(_container: DependencyContainer): void {},
  controllers: [PagesAdminController, PageRenderController],
};
