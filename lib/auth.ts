// Lightweight auth shared by the edge middleware and the Node login route.
// Sessions are stateless signed JWTs in an httpOnly cookie (no DB needed).
// Users are admin-provisioned via the APP_USERS env var (base64 of a JSON
// array of { u: username, h: bcrypt-hash }). Base64 keeps the "$" in bcrypt
// hashes safe from local .env variable-expansion.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "resihome_session";
const MAX_AGE = 60 * 60 * 8; // 8 hours

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET || "dev-only-insecure-secret-change-me";
  return new TextEncoder().encode(s);
}

export async function signSession(username: string): Promise<string> {
  return await new SignJWT({ sub: username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());
}

/** Returns the username if the token is valid, else null. Edge-safe (jose). */
export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export interface AppUser { u: string; h: string }

/** Parse the admin-provisioned user list from APP_USERS (base64 JSON or raw JSON). */
export function getUsers(): AppUser[] {
  const raw = process.env.APP_USERS;
  if (!raw) return [];
  const tryParse = (s: string): AppUser[] | null => {
    try { const a = JSON.parse(s); return Array.isArray(a) ? (a as AppUser[]) : null; } catch { return null; }
  };
  // Prefer base64 (recommended), fall back to raw JSON.
  let decoded: string | null = null;
  try { decoded = Buffer.from(raw, "base64").toString("utf8"); } catch { decoded = null; }
  return (decoded && tryParse(decoded)) || tryParse(raw) || [];
}

export const SESSION_MAX_AGE = MAX_AGE;
