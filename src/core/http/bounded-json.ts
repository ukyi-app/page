import { BadRequestError, RequestTooLargeError } from "./http-errors";

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new RequestTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) throw new BadRequestError("missing_body");

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new RequestTooLargeError();
    chunks.push(value);
  }

  const raw = new TextDecoder().decode(concat(chunks, total));
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError("invalid_json");
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
