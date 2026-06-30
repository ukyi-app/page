// 관리 작업 감사 로그 — 공개 콘텐츠를 바꾸는 mutation(생성/삭제/복원/롤백)의 흔적을 구조적 JSON으로
// stdout에 남긴다(homelab 로그 수집기 VictoriaLogs에서 쿼리). 토큰/비밀/HTML 본문은 절대 로깅하지 않는다.
export type AuditEvent = "page.save" | "page.softDelete" | "page.restore" | "page.rollback";

export function audit(event: AuditEvent, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", audit: event, at: new Date().toISOString(), ...fields }));
}

/** 신뢰 경계 뒤(Cloudflare/Traefik) 클라이언트 IP. 없으면 undefined. */
export function clientIp(headers: Headers): string | undefined {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    undefined
  );
}
