import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import {
  isProductUnlocked,
  isThemeAllowed,
  previewCookieName,
  previewCookieValue,
  previewKeyMatches,
  unlockedProducts,
  type CookieJar,
} from "@/lib/preview-gate";

const PJ_KEY = "journal-key-0123456789";
const LY_KEY = "little-years-key-0123456789";

const jar = (cookies: Record<string, string>): CookieJar => ({
  get: (name) => (name in cookies ? { value: cookies[name] } : undefined),
});

beforeEach(() => {
  process.env.PHOTO_LAB_PJ_PREVIEW_KEY = PJ_KEY;
  process.env.LITTLE_YEARS_PREVIEW_KEY = LY_KEY;
  delete process.env.PHOTO_LAB_PJ_PUBLIC;
  delete process.env.LITTLE_YEARS_ENABLED;
});

test("the journal's cookie name and value are unchanged, so existing previews keep working", () => {
  assert.equal(previewCookieName("pregnancy_journal"), "ld_pj_preview");
  const old = createHash("sha256").update(`ld-pj-preview:cookie:${PJ_KEY}`).digest("hex");
  assert.equal(previewCookieValue("pregnancy_journal"), old);
});

test("each book's key unlocks only that book", () => {
  assert.ok(previewKeyMatches("little_years", LY_KEY));
  assert.ok(!previewKeyMatches("little_years", PJ_KEY));
  assert.ok(!previewKeyMatches("pregnancy_journal", LY_KEY));
  assert.ok(!previewKeyMatches("memory_book", LY_KEY), "the memory book has no gate");

  const ly = jar({ ld_ly_preview: previewCookieValue("little_years")! });
  assert.deepEqual(unlockedProducts(ly), { memory_book: true, pregnancy_journal: false, little_years: true });
  const pj = jar({ ld_pj_preview: previewCookieValue("pregnancy_journal")! });
  assert.deepEqual(unlockedProducts(pj), { memory_book: true, pregnancy_journal: true, little_years: false });
  // The journal's cookie value under the Little Years cookie name does nothing.
  assert.ok(!isProductUnlocked("little_years", jar({ ld_ly_preview: previewCookieValue("pregnancy_journal")! })));
});

test("locked by default; LITTLE_YEARS_ENABLED=true opens it to everyone", () => {
  assert.ok(!isProductUnlocked("little_years", jar({})));
  assert.ok(!isProductUnlocked("little_years", null));
  process.env.LITTLE_YEARS_ENABLED = "true";
  assert.ok(isProductUnlocked("little_years", jar({})));
  assert.ok(!isProductUnlocked("pregnancy_journal", jar({})), "the journal stays hidden");
});

test("a missing or short key never unlocks anything", () => {
  process.env.LITTLE_YEARS_PREVIEW_KEY = "short";
  assert.equal(previewCookieValue("little_years"), null);
  assert.ok(!previewKeyMatches("little_years", "short"));
  delete process.env.LITTLE_YEARS_PREVIEW_KEY;
  assert.ok(!isProductUnlocked("little_years", jar({ ld_ly_preview: "anything" })));
});

test("memory book themes are always allowed; journal themes only when unlocked", () => {
  assert.ok(isThemeAllowed("little_artist", jar({})));
  assert.ok(!isThemeAllowed("love_grows_desert_sand", jar({})));
  assert.ok(
    isThemeAllowed("love_grows_desert_sand", jar({ ld_pj_preview: previewCookieValue("pregnancy_journal")! }))
  );
});
