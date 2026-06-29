// 백엔드 canonicalizePagePath / isReservedPath와 동일한 규칙(클라이언트 사전 검증용).
const PAGE_PATH_RE = /^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/;
const RESERVED_EXACT = new Set(["/api", "/admin", "/health", "/metrics", "/favicon.ico", "/robots.txt"]);

export function isReservedPath(path: string): boolean {
  return RESERVED_EXACT.has(path) || path.startsWith("/api/") || path.startsWith("/admin/");
}

/** 유효하면 null, 아니면 사람이 읽을 한국어 사유를 반환. */
export function validatePagePath(path: string): string | null {
  if (!path) return "경로를 입력하세요.";
  if (!path.startsWith("/")) return "경로는 /로 시작해야 합니다.";
  if (!PAGE_PATH_RE.test(path)) return "소문자·숫자·_·- 세그먼트만 허용됩니다 (예: /demo, /docs/intro).";
  if (isReservedPath(path)) return "예약된 경로입니다 (/api, /admin, /health 등).";
  return null;
}
