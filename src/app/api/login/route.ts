import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSession, passwordMatches } from "@/lib/auth";
import { fail } from "@/lib/http";

export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !(await passwordMatches(password))) return fail("Wrong password", 401);
  const session = await createSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return res;
}
