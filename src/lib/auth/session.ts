import "server-only";
import { cookies } from "next/headers";
import {
  signSession,
  verifySession,
  MAX_AGE_SECONDS,
  type SessionClaims,
} from "./jwt";

export const SESSION_COOKIE = "controla_session";

export async function getSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Solo en Server Actions o Route Handlers (no en Server Components). */
export async function setSession(claims: SessionClaims): Promise<void> {
  const token = await signSession(claims);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Solo en Server Actions o Route Handlers. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
