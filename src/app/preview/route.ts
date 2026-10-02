import { NextRequest, NextResponse } from "next/server";
import {
  PJ_PREVIEW_COOKIE,
  PJ_PREVIEW_MAX_AGE,
  previewCookieValue,
  previewKeyMatches,
} from "@/lib/preview-gate";

/**
 * GET /preview?key=<PHOTO_LAB_PJ_PREVIEW_KEY>
 * Unlocks the hidden pregnancy journal in this browser (httpOnly cookie, 90
 * days) and opens the home page on the journal. A wrong or missing key just
 * lands on the normal home page — no hint that a gate exists.
 * GET /preview?off=1 locks this browser again.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const home = new URL("/", url);

  if (url.searchParams.has("off")) {
    const res = NextResponse.redirect(home);
    res.cookies.delete(PJ_PREVIEW_COOKIE);
    return res;
  }

  const value = previewCookieValue();
  if (!value || !previewKeyMatches(url.searchParams.get("key"))) {
    return NextResponse.redirect(home);
  }

  const res = NextResponse.redirect(new URL("/?book=pregnancy_journal", url));
  res.cookies.set(PJ_PREVIEW_COOKIE, value, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: PJ_PREVIEW_MAX_AGE,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
