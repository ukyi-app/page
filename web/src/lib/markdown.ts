import { marked } from "marked";

// 미리보기가 공개 렌더(src/core/render/markdown.ts)와 같은 결과를 내도록
// marked 옵션과 아래 MARKDOWN_CSS는 서버 쪽과 동일하게 유지한다.
marked.setOptions({ gfm: true, breaks: false });

const MARKDOWN_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #ffffff;
    color: #1f2328;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", "Apple SD Gothic Neo",
      "Malgun Gothic", Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.65;
    -webkit-text-size-adjust: 100%;
  }
  .markdown-body {
    max-width: 760px;
    margin: 0 auto;
    padding: 48px 24px 96px;
    word-wrap: break-word;
  }
  .markdown-body > :first-child { margin-top: 0; }
  .markdown-body > :last-child { margin-bottom: 0; }
  .markdown-body h1, .markdown-body h2, .markdown-body h3,
  .markdown-body h4, .markdown-body h5, .markdown-body h6 {
    margin: 1.8em 0 0.6em;
    font-weight: 600;
    line-height: 1.3;
  }
  .markdown-body h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid #d8dee4; }
  .markdown-body h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid #d8dee4; }
  .markdown-body h3 { font-size: 1.25em; }
  .markdown-body h4 { font-size: 1em; }
  .markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote,
  .markdown-body table, .markdown-body pre { margin: 0 0 1em; }
  .markdown-body a { color: #0969da; text-decoration: none; }
  .markdown-body a:hover { text-decoration: underline; }
  .markdown-body ul, .markdown-body ol { padding-left: 1.6em; }
  .markdown-body li + li { margin-top: 0.25em; }
  .markdown-body blockquote {
    padding: 0 1em;
    color: #59636e;
    border-left: 0.25em solid #d0d7de;
  }
  .markdown-body img { max-width: 100%; height: auto; }
  .markdown-body hr { height: 1px; margin: 2em 0; background: #d8dee4; border: 0; }
  .markdown-body code {
    padding: 0.2em 0.4em;
    margin: 0;
    font-size: 0.875em;
    background: rgba(129, 139, 152, 0.16);
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  .markdown-body pre {
    padding: 16px;
    overflow: auto;
    background: #f6f8fa;
    border-radius: 8px;
    line-height: 1.45;
  }
  .markdown-body pre code { padding: 0; background: transparent; font-size: 0.85em; }
  .markdown-body table { border-collapse: collapse; display: block; overflow: auto; width: max-content; max-width: 100%; }
  .markdown-body th, .markdown-body td { padding: 6px 13px; border: 1px solid #d0d7de; }
  .markdown-body tr:nth-child(2n) { background: #f6f8fa; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #e6edf3; }
    .markdown-body h1, .markdown-body h2 { border-bottom-color: #30363d; }
    .markdown-body a { color: #4493f8; }
    .markdown-body blockquote { color: #9198a1; border-left-color: #3d444d; }
    .markdown-body hr { background: #30363d; }
    .markdown-body code { background: rgba(101, 108, 118, 0.2); }
    .markdown-body pre { background: #151b23; }
    .markdown-body th, .markdown-body td { border-color: #3d444d; }
    .markdown-body tr:nth-child(2n) { background: #151b23; }
  }
`;

/** 마크다운 원본을 스타일이 인라인된 완결형 HTML 문서로 렌더한다(편집기 미리보기용). */
export function renderMarkdownDocument(source: string): string {
  const body = marked.parse(source, { async: false });
  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>${MARKDOWN_CSS}</style>`,
    "</head>",
    `<body><main class="markdown-body">${body}</main></body>`,
    "</html>",
  ].join("");
}
