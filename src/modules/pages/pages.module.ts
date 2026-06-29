import { Module } from "../../core/di/module";
import { AuthGuard } from "../../core/auth/auth.guard";
import { PageRenderController } from "./page-render.controller";
import { PagesAdminController } from "./pages.admin.controller";
import { PAGES_REPOSITORY } from "./pages.contract";
import { PageRepository } from "./pages.repository";
import { PagesService } from "./pages.service";

@Module({
  controllers: [PagesAdminController, PageRenderController],
  providers: [{ provide: PAGES_REPOSITORY, useClass: PageRepository }, PagesService, AuthGuard],
})
export class PagesModule {}
