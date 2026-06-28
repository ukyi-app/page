import { createHash } from "node:crypto";

const chunks: Uint8Array[] = [];
for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
const token = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
if (!token) {
  console.error("usage: printf '%s' \"$ADMIN_TOKEN\" | bun run token:hash");
  process.exit(2);
}

console.log(createHash("sha256").update(token).digest("hex"));
