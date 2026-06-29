import { ApiError } from "./api";

const MESSAGES: Record<string, string> = {
  conflict: "다른 곳에서 이미 변경되었습니다. 최신 내용을 다시 불러오세요.",
  not_found: "대상을 찾을 수 없습니다.",
  invalid_path: "경로 형식이 올바르지 않습니다.",
  invalid_body: "요청 본문이 올바르지 않습니다.",
  missing_body: "요청 본문이 비어 있습니다.",
  payload_too_large: "HTML이 너무 큽니다 (최대 1 MiB).",
  unauthorized: "인증이 필요합니다.",
  service_unavailable: "서버가 일시적으로 응답하지 않습니다.",
  network_error: "서버에 연결할 수 없습니다.",
};

export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    return MESSAGES[err.code] ?? `오류 (${err.code})`;
  }
  return "알 수 없는 오류가 발생했습니다.";
}
