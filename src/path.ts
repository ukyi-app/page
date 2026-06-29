const PAGE_PATH_RE = /^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/;
const RESERVED_EXACT = new Set(["/api", "/health", "/metrics", "/favicon.ico", "/robots.txt"]);

export function canonicalizePagePath(input: unknown): string {
  if (typeof input !== "string") throw new Error("path must be a string");
  if (!PAGE_PATH_RE.test(input)) throw new Error("path must use /lowercase-segments with letters, digits, _ or -");
  if (isReservedPath(input)) throw new Error("path is reserved");
  return input;
}

export function isReservedPath(path: string): boolean {
  return RESERVED_EXACT.has(path) || path.startsWith("/api/");
}
