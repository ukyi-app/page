import type { PageRepository } from "./pages.repository";

export const PAGES_REPOSITORY = Symbol("PAGES_REPOSITORY");

export type PageRepositoryContract = Pick<
  PageRepository,
  | "getCurrentPage"
  | "getCurrentSource"
  | "getCurrentMetadata"
  | "listPages"
  | "listRevisions"
  | "savePage"
  | "rollbackPage"
  | "softDeletePage"
  | "restorePage"
  | "purgeExpired"
>;
