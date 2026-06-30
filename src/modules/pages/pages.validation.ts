import { canonicalizePagePath } from "../../core/path/page-path";
import { BadRequestError } from "../../core/http/http-errors";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

export type ContentType = "html" | "markdown";

/** 저장 콘텐츠의 타입. 생략 시 'html'(기존 클라이언트 호환). 그 외 값은 거부. */
export function parseContentType(value: unknown): ContentType {
  if (value == null) return "html";
  if (value === "html" || value === "markdown") return value;
  throw new BadRequestError("invalid_content_type");
}

export function parsePath(value: unknown): string {
  try {
    return canonicalizePagePath(value);
  } catch {
    throw new BadRequestError("invalid_path");
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestError("invalid_body");
  return value as Record<string, unknown>;
}

export function parseExpectedContentSha256(value: unknown, required = false): string | undefined {
  if (value == null && !required) return undefined;
  if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
    throw new BadRequestError("invalid_expected_content_sha256");
  }
  return value.toLowerCase();
}

export function parseRequiredExpectedContentSha256(value: unknown): string {
  return parseExpectedContentSha256(value, true) as string;
}

export function parsePositiveRevisionId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new BadRequestError("invalid_revision_id");
  }
  return value as number;
}
