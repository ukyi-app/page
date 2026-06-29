const PAGE_PATH_RE = /^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/;
const RESERVED_EXACT = new Set(["/api", "/admin", "/health", "/metrics", "/favicon.ico", "/robots.txt"]);

export function canonicalizePagePath(input: unknown): string {
  if (typeof input !== "string") throw new Error("path must be a string");
  if (!PAGE_PATH_RE.test(input)) throw new Error("path must use /lowercase-segments with letters, digits, _ or -");
  if (isReservedPath(input)) throw new Error("path is reserved");
  return input;
}

export function isReservedPath(path: string): boolean {
  // /api/*는 API, /admin·/admin/*는 관리 UI가 점유하므로 페이지 경로로 쓸 수 없다.
  return RESERVED_EXACT.has(path) || path.startsWith("/api/") || path.startsWith("/admin/");
}
