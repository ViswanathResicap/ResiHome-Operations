import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUsers, signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";

// Verify username/password against the admin-provisioned user list and issue
// a signed session cookie. Runs on Node (bcrypt needs it).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const username = String((body as Record<string, unknown>).username ?? "").trim();
  const password = String((body as Record<string, unknown>).password ?? "");
  if (!username || !password) {
    return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });
  }

  const users = getUsers();
  const user = users.find((u) => u.u.toLowerCase() === username.toLowerCase());
  // Always run a compare to reduce username-enumeration timing differences.
  const hash = user?.h || "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidin";
  const ok = (await bcrypt.compare(password, hash)) && !!user;
  if (!ok) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const token = await signSession(user!.u);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
