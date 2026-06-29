export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function error(code: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: code, ...extra }, status);
}
