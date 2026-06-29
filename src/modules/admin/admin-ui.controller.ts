import type { Context } from "hono";
import { Controller, Get } from "../../core/http/decorators";

// 빌드된 관리 SPA(single-file). web/dist/index.html은 `vite build`(vite-plugin-singlefile) 산출물로
// JS·CSS·폰트가 한 파일에 인라인되어 있다. 런타임에 한 번 읽어 캐싱한다.
const ADMIN_HTML_URL = new URL("../../../web/dist/index.html", import.meta.url);

let cachedHtml: string | null | undefined;

async function loadAdminHtml(): Promise<string | null> {
  if (cachedHtml !== undefined) return cachedHtml;
  const file = Bun.file(ADMIN_HTML_URL);
  cachedHtml = (await file.exists()) ? await file.text() : null;
  return cachedHtml;
}

// 렌더된 사용자 페이지와 달리 관리 UI는 자체 스크립트 실행 + 동일 출처 /api 호출이 필요하다.
// 따라서 공개 렌더용 strict 샌드박스(connect-src 'none')가 아닌, same-origin 한정 CSP를 쓴다.
const ADMIN_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

function adminHeaders(): Headers {
  return new Headers({
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": ADMIN_CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  });
}

@Controller("/admin")
export class AdminUiController {
  @Get("")
  async index(_c: Context): Promise<Response> {
    const html = await loadAdminHtml();
    if (html == null) {
      return new Response("admin UI is not built. Run `bun run build:web` to produce web/dist/index.html.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response(html, { status: 200, headers: adminHeaders() });
  }
}
