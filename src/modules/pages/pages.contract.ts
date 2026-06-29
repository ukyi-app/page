import type { PageRepository } from "./pages.repository";

export const PAGES_REPOSITORY = Symbol("PAGES_REPOSITORY");

export type PageRepositoryContract = Pick<
  PageRepository,
  "getCurrentPage" | "getCurrentMetadata" | "listRevisions" | "savePage" | "rollbackPage"
>;
