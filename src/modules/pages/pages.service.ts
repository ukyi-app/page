import { Inject, Service } from "../../core/di/decorators";
import { ConfigService } from "../../core/config/config.service";
import { PAGES_REPOSITORY, type PageRepositoryContract } from "./pages.contract";
import type {
  PageMetadata, RenderedPage, RollbackPageInput, SavePageInput,
} from "./pages.repository";

@Service()
export class PagesService {
  constructor(
    @Inject(PAGES_REPOSITORY) private readonly pages: PageRepositoryContract,
    private readonly config: ConfigService,
  ) {}

  getCurrentPage(path: string): Promise<RenderedPage | null> {
    return this.withReadDeadline("getCurrentPage", this.pages.getCurrentPage(path));
  }
  getCurrentMetadata(path: string): Promise<PageMetadata | null> {
    return this.withReadDeadline("getCurrentMetadata", this.pages.getCurrentMetadata(path));
  }
  listRevisions(path: string): Promise<PageMetadata[]> {
    return this.withReadDeadline("listRevisions", this.pages.listRevisions(path));
  }
  savePage(input: SavePageInput): Promise<PageMetadata> {
    return this.pages.savePage(input);
  }
  rollbackPage(input: RollbackPageInput): Promise<PageMetadata> {
    return this.pages.rollbackPage(input);
  }

  private async withReadDeadline<T>(operation: string, work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${operation} timed out`)), this.config.dbOperationTimeoutMs);
      });
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
