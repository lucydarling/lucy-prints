import { NextRequest, NextResponse } from "next/server";
import type { ProductType } from "@/lib/photo-slots";
import {
  GATED_PRODUCTS,
  PREVIEW_MAX_AGE,
  previewCookieName,
  previewCookieValue,
  previewKeyMatches,
} from "@/lib/preview-gate";

/**
 * GET /preview?key=<PHOTO_LAB_PJ_PREVIEW_KEY>
 *   Unlocks the hidden pregnancy journal in this browser (httpOnly cookie, 90
 *   days) and opens the home page on it.
 * GET /preview?book=little_years&key=<LITTLE_YEARS_PREVIEW_KEY>
 *   Same for The Little Years.
 * A wrong or missing key just lands on the normal home page — no hint that a
 * gate exists.
 * GET /preview?off=1 locks this browser again (every hidden book).
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const home = new URL("/", url);

  if (url.searchParams.has("off")) {
    const res = NextResponse.redirect(home);
    for (const product of GATED_PRODUCTS) res.cookies.delete(previewCookieName(product)!);
    return res;
  }

  const requested = url.searchParams.get("book") ?? "pregnancy_journal";
  const product = GATED_PRODUCTS.find((p) => p === requested) as ProductType | undefined;
  const name = product && previewCookieName(product);
  const value = product && previewCookieValue(product);
  if (!product || !name || !value || !previewKeyMatches(product, url.searchParams.get("key"))) {
    return NextResponse.redirect(home);
  }

  const res = NextResponse.redirect(new URL(`/?book=${product}`, url));
  res.cookies.set(name, value, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: PREVIEW_MAX_AGE,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
