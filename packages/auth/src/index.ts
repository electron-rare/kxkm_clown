import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { ROLE_PERMISSIONS, type AuthSession, type Permission, type UserRole, isUserRole } from "@kxkm/core";

/* ------------------------------------------------------------------ */
/*  Existing types & functions                                         */
/* ------------------------------------------------------------------ */

export interface SessionCreateInput {
  username: string;
  role: UserRole;
  ttlMs?: number;
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function assertPermission(role: UserRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`permission_denied:${role}:${permission}`);
  }
}

export function createSessionRecord(input: SessionCreateInput, id: string, now = new Date()): AuthSession {
  const ttlMs = input.ttlMs ?? 1000 * 60 * 60;
  return {
    id,
    username: input.username,
    role: input.role,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  A) Password hashing (scrypt, salt:hash format)                     */
/* ------------------------------------------------------------------ */

const SCRYPT_KEYLEN = 64;

function scryptAsync(password: string, salt: string, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, storedHex] = hash.split(":");
  if (!salt || !storedHex) return false;
  const storedKey = Buffer.from(storedHex, "hex");
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  // Pad to equal length to prevent timing leak on corrupted stored hashes
  const maxLen = Math.max(storedKey.length, derived.length);
  const a = Buffer.alloc(maxLen);
  const b = Buffer.alloc(maxLen);
  storedKey.copy(a);
  derived.copy(b);
  return storedKey.length === derived.length && timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/*  B) Session token generation                                        */
/* ------------------------------------------------------------------ */

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/* ------------------------------------------------------------------ */
/*  C) Middleware helpers (framework-agnostic)                          */
/* ------------------------------------------------------------------ */

export interface AuthContext {
  sessionId: string;
  userId: string;
  role: UserRole;
}

const COOKIE_NAME = "kxkm_v2_session";

export function extractSessionId(req: {
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}): string | null {
  // 1. Check parsed cookies object
  if (req.cookies && typeof req.cookies[COOKIE_NAME] === "string" && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }

  // 2. Check raw Cookie header (for servers without cookie-parser)
  const rawCookie = req.headers?.cookie;
  if (rawCookie) {
    const entries = rawCookie.split(";").map((part) => part.trim());
    for (const entry of entries) {
      if (entry.startsWith(`${COOKIE_NAME}=`)) {
        const value = entry.slice(COOKIE_NAME.length + 1);
        if (value) return value;
      }
    }
  }

  // 3. Fallback to x-session-id header
  const headerValue = req.headers?.["x-session-id"];
  if (typeof headerValue === "string" && headerValue) {
    return headerValue;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  D) Login input validation                                          */
/* ------------------------------------------------------------------ */

export interface LoginInput {
  username: string;
  password?: string;
  role?: UserRole;
}

const USERNAME_RE = /^[a-zA-Z0-9_]{1,40}$/;

export function validateLoginInput(input: unknown): LoginInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("invalid_login_payload");
  }

  const obj = input as Record<string, unknown>;
  const username = typeof obj.username === "string" ? obj.username.trim() : "";

  if (!USERNAME_RE.test(username)) {
    throw new Error("invalid_username");
  }

  const result: LoginInput = { username };

  if (typeof obj.password === "string" && obj.password.length > 0) {
    result.password = obj.password;
  }

  if (typeof obj.role === "string" && obj.role.length > 0) {
    if (!isUserRole(obj.role)) {
      throw new Error("invalid_role");
    }
    result.role = obj.role as UserRole;
  }

  return result;
}
