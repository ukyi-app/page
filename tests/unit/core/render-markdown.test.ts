import { describe, expect, test } from "bun:test";
import { renderMarkdownDocument } from "../../../src/core/render/markdown";

describe("renderMarkdownDocument", () => {
  test("wraps rendered markdown in a styled HTML document", () => {
    const doc = renderMarkdownDocument("# 제목\n\n본문 **굵게**.");

    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("<style>");
    expect(doc).toContain(".markdown-body");
    expect(doc).toContain('<main class="markdown-body">');
    expect(doc.trimEnd().endsWith("</html>")).toBe(true);
  });

  test("converts common markdown constructs to HTML", () => {
    const doc = renderMarkdownDocument(
      "# Title\n\nSome **bold** and a [link](https://x.test).\n\n```js\nconst a = 1;\n```\n\n- one\n- two\n",
    );

    expect(doc).toContain("<h1>Title</h1>");
    expect(doc).toContain("<strong>bold</strong>");
    expect(doc).toContain('<a href="https://x.test">link</a>');
    expect(doc).toContain('<code class="language-js">');
    expect(doc).toContain("<ul>");
    expect(doc).toContain("<li>one</li>");
  });

  test("renders a GitHub-flavored table", () => {
    const doc = renderMarkdownDocument("| a | b |\n|---|---|\n| 1 | 2 |\n");

    expect(doc).toContain("<table>");
    expect(doc).toContain("<th>a</th>");
    expect(doc).toContain("<td>1</td>");
  });
});
