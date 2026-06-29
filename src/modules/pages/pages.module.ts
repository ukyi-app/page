import { Module } from "../../core/di/module";
import { AuthGuard } from "../../core/auth/auth.guard";
import { PageRenderController } from "./page-render.controller";
import { PagesAdminController } from "./pages.admin.controller";
import { PagesService } from "./pages.service";

@Module({
  controllers: [PagesAdminController, PageRenderController],
  providers: [PagesService, AuthGuard],
})
export class PagesModule {}
