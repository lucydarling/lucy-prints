import { test } from "node:test";
import assert from "node:assert/strict";
import { getBookWord, BOOK_THEMES } from "../photo-slots";

function themeFor(product: string): string {
  const t = (BOOK_THEMES as readonly { id: string; product: string }[]).find((x) => x.product === product);
  assert.ok(t, `no theme for ${product}`);
  return t.id;
}

test("each book names itself", () => {
  assert.equal(getBookWord(themeFor("memory_book")), "memory book");
  assert.equal(getBookWord(themeFor("pregnancy_journal")), "pregnancy journal");
  assert.equal(getBookWord(themeFor("little_years")), "Little Years book");
});

test("unknown, empty and missing themes fall back to memory book", () => {
  assert.equal(getBookWord("not-a-theme"), "memory book");
  assert.equal(getBookWord(""), "memory book");
  assert.equal(getBookWord(null), "memory book");
  assert.equal(getBookWord(undefined), "memory book");
});
