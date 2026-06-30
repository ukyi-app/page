import { describe, expect, test } from "bun:test";
import {
  ifNoneMatchSatisfied,
  notModifiedHeaders,
  pageEtag,
  renderHeaders,
} from "../../../src/core/render/render-headers";

describe("renderHeaders", () => {
  test("uses a network-closed sandbox CSP", () => {
    const headers = renderHeaders();
    const csp = headers.get("content-security-policy") || "";

    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).not.toContain("allow-top-navigation");
  });

  test("adds a revalidate-only cache-control and no etag by default", () => {
    const headers = renderHeaders();
    expect(headers.get("cache-control")).toBe("public, no-cache");
    expect(headers.get("etag")).toBeNull();
  });

  test("sets the provided strong etag alongside the cache policy", () => {
    const headers = renderHeaders('"abc:html"');
    expect(headers.get("etag")).toBe('"abc:html"');
    expect(headers.get("cache-control")).toBe("public, no-cache");
  });
});

describe("pageEtag", () => {
  test("is a strong quoted tag combining the content sha and type", () => {
    // content_sha256 alone cannot distinguish identical bytes served as html vs markdown
    // (different served representations), so the type is part of the validator.
    expect(pageEtag("deadbeef", "markdown")).toBe('"deadbeef:markdown"');
    expect(pageEtag("deadbeef", "html")).not.toBe(pageEtag("deadbeef", "markdown"));
  });
});

describe("notModifiedHeaders", () => {
  test("carries only the validator and cache policy (no body headers)", () => {
    const headers = notModifiedHeaders('"abc:html"');
    expect(headers.get("etag")).toBe('"abc:html"');
    expect(headers.get("cache-control")).toBe("public, no-cache");
    expect(headers.get("content-security-policy")).toBeNull();
  });
});

describe("ifNoneMatchSatisfied", () => {
  const etag = '"abc:html"';

  test("false when the header is absent", () => {
    expect(ifNoneMatchSatisfied(undefined, etag)).toBe(false);
    expect(ifNoneMatchSatisfied(null, etag)).toBe(false);
  });

  test("true on an exact match", () => {
    expect(ifNoneMatchSatisfied('"abc:html"', etag)).toBe(true);
  });

  test("true on a weak-prefixed match (RFC 7232 weak comparison)", () => {
    expect(ifNoneMatchSatisfied('W/"abc:html"', etag)).toBe(true);
  });

  test("true when the tag appears in a comma-separated list", () => {
    expect(ifNoneMatchSatisfied('"other:html", "abc:html"', etag)).toBe(true);
  });

  test("true on the wildcard", () => {
    expect(ifNoneMatchSatisfied("*", etag)).toBe(true);
  });

  test("false on a different tag", () => {
    expect(ifNoneMatchSatisfied('"xyz:html"', etag)).toBe(false);
  });
});
