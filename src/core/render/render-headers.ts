const CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "prefetch-src 'none'",
].join("; ");

// 공개 렌더 응답 캐시 정책. 공유 캐시(CDN)·브라우저가 저장은 하되 매 요청 재검증을 강제한다
// (no-cache). 경로의 콘텐츠는 가변이라(관리자 수정/롤백/soft delete 시 즉시 바뀜) 양의
// max-age로 stale을 서빙하지 않는다. 강한 ETag와 결합해 변하지 않았으면 304로 본문 전송을 생략한다.
const CACHE_CONTROL = "public, no-cache";

export function renderHeaders(etag?: string): Headers {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": CACHE_CONTROL,
  });
  if (etag) headers.set("etag", etag);
  return headers;
}

/** 304 응답 헤더: 본문이 없으므로 검증자(ETag)와 캐시 정책만 싣는다. */
export function notModifiedHeaders(etag: string): Headers {
  return new Headers({ etag, "cache-control": CACHE_CONTROL });
}

/**
 * 현재 리비전의 서빙 표현을 식별하는 강한 ETag. content_sha256은 원본 바이트의 해시이므로
 * 그것만으로는 동일 바이트를 html로 그대로 서빙할 때와 markdown으로 렌더해 서빙할 때를
 * 구분하지 못한다(서빙 표현이 다름). content_type을 함께 포함해 둘을 분리한다.
 */
export function pageEtag(contentSha256: string, contentType: string): string {
  return `"${contentSha256}:${contentType}"`;
}

/**
 * If-None-Match 충족 여부. RFC 7232 §3.2의 약한 비교를 쓴다(GET 조건부 요청).
 * "*"는 표현이 존재하면 매치하며, 쉼표 구분 목록과 선택적 W/ 접두사를 허용한다.
 */
export function ifNoneMatchSatisfied(header: string | undefined | null, etag: string): boolean {
  if (!header) return false;
  const target = stripWeak(etag);
  return header.split(",").some((raw) => {
    const candidate = raw.trim();
    if (candidate === "*") return true;
    return stripWeak(candidate) === target;
  });
}

function stripWeak(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}
