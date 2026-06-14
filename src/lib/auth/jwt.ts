import { SignJWT, jwtVerify } from "jose";

/** Claims de nuestra sesión propia (cookie). NO se pasa a PostgREST. */
export interface SessionClaims {
  restaurant_id: string;
  slug: string;
  user_id: string;
  user_name: string;
  user_role: "admin" | "empleado";
  shift_id: string;
  shift_session_id: string;
}

const MAX_AGE_SECONDS = 60 * 60 * 16; // 16 h

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET ?? process.env.SUPABASE_JWT_SECRET;
  if (!s) throw new Error("Falta SESSION_SECRET / SUPABASE_JWT_SECRET");
  return new TextEncoder().encode(s);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionClaims;
  } catch {
    return null;
  }
}

export { MAX_AGE_SECONDS };
