export type PageMetadata = {
  path: string;
  revisionId: number;
  contentSha256: string;
  updatedAt: string;
};

export type PageListItem = PageMetadata & {
  disabledAt: string | null;
  purgeAfter: string | null;
};

export type PageSource = PageMetadata & {
  html: string;
};

export type ApiErrorBody = {
  error: string;
  current?: PageMetadata;
};
