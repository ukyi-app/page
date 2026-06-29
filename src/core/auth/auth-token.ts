import { createHash, timingSafeEqual } from "node:crypto";

export async function verifyBearerToken(request: Request, expectedSha256Hex: string): Promise<boolean> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length);
  if (!token) return false;

  const actual = createHash("sha256").update(token).digest();
  const expected = Buffer.from(expectedSha256Hex, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
