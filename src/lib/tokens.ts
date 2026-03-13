import { randomBytes } from "crypto";

/**
 * Generate a 24-character URL-safe token for magic links.
 * 18 bytes = 144 bits of entropy — brute-force infeasible.
 */
export function generateSessionToken(): string {
  return randomBytes(18).toString("base64url");
}
