export class RequestTooLargeError extends Error {}

export class BadRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
