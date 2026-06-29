import { Inject, Service } from "../../core/di/decorators";
import { ConfigService } from "../../core/config/config.service";
import { PAGES_REPOSITORY, type PageRepositoryContract } from "./pages.contract";
import type {
  PageListItem, PageMetadata, RenderedPage, RollbackPageInput, SavePageInput, SoftDeletePageInput,
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
  getCurrentSource(path: string): Promise<RenderedPage | null> {
    return this.withReadDeadline("getCurrentSource", this.pages.getCurrentSource(path));
  }
  getCurrentMetadata(path: string): Promise<PageMetadata | null> {
    return this.withReadDeadline("getCurrentMetadata", this.pages.getCurrentMetadata(path));
  }
  listPages(): Promise<PageListItem[]> {
    return this.withReadDeadline("listPages", this.pages.listPages());
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
  softDeletePage(input: SoftDeletePageInput): Promise<PageListItem> {
    return this.pages.softDeletePage(input);
  }
  restorePage(path: string): Promise<PageListItem> {
    return this.pages.restorePage(path);
  }
  /** purge 스윕(백그라운드). 읽기 데드라인 없이 직접 실행. 삭제 건수 반환. */
  purgeExpired(now: string): Promise<number> {
    return this.pages.purgeExpired(now);
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
