import { NextRequest, NextResponse } from "next/server";
import {
  PRINT_PREVIEW_COOKIE,
  PRINT_PREVIEW_MAX_AGE,
  printPreviewCookieValue,
  printPreviewKeyMatches,
} from "@/lib/print-orders/print-gate";

/**
 * /review?print_preview=<PRINT_PREVIEW_SECRET> unlocks print ordering in this
 * browser (httpOnly cookie) and lands on a clean /review. A wrong or missing
 * secret just lands on the clean page — no hint that a gate exists. It only
 * runs for /review (see the matcher); a request without the parameter passes
 * through untouched.
 */
export function proxy(req: NextRequest) {
  const url = req.nextUrl;
  if (!url.searchParams.has("print_preview")) return NextResponse.next();

  const clean = url.clone();
  clean.searchParams.delete("print_preview");
  const res = NextResponse.redirect(clean);
  res.headers.set("Cache-Control", "no-store");
  const value = printPreviewCookieValue();
  if (value && printPreviewKeyMatches(url.searchParams.get("print_preview"))) {
    res.cookies.set(PRINT_PREVIEW_COOKIE, value, {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: PRINT_PREVIEW_MAX_AGE,
    });
  }
  return res;
}

export const config = { matcher: ["/review"] };
