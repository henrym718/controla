import "server-only";
import { cookies } from "next/headers";
import {
  signSession,
  verifySession,
  signSuper,
  verifySuper,
  MAX_AGE_SECONDS,
  type SessionClaims,
} from "./jwt";

export const SESSION_COOKIE = "controla_session";
export const SUPER_COOKIE = "controla_super";

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

// ---- Sesión del super-admin (dueño de la plataforma) ----
export async function getSuper(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(SUPER_COOKIE)?.value;
  if (!token) return false;
  return verifySuper(token);
}

export async function setSuper(): Promise<void> {
  const token = await signSuper();
  const store = await cookies();
  store.set(SUPER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSuper(): Promise<void> {
  const store = await cookies();
  store.delete(SUPER_COOKIE);
}
