import { NextResponse } from "next/server";

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function serverError(err: unknown) {
  console.error(err);
  return fail("Something went wrong on the server. Nothing was written.", 500);
}
