import { describe, expect, test } from "bun:test";
import { BadRequestError, RequestTooLargeError } from "../../../src/core/http/http-errors";

describe("http-errors", () => {
  test("BadRequestError carries a stable code", () => {
    const err = new BadRequestError("invalid_path");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("invalid_path");
  });
  test("RequestTooLargeError is an Error", () => {
    expect(new RequestTooLargeError()).toBeInstanceOf(Error);
  });
});
