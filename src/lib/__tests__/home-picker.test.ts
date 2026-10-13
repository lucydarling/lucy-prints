import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInitialProduct, visibleProducts } from "../home-picker";

test("no preselect opens on the memory book", () => {
  assert.equal(resolveInitialProduct(null, ["pregnancy_journal", "little_years"]), "memory_book");
});

test("an unlocked product id opens that book", () => {
  assert.equal(resolveInitialProduct("pregnancy_journal", ["pregnancy_journal"]), "pregnancy_journal");
  assert.equal(resolveInitialProduct("little_years", ["little_years"]), "little_years");
  assert.equal(resolveInitialProduct("memory_book", ["pregnancy_journal"]), "memory_book");
});

test("a theme id opens the book it belongs to", () => {
  assert.equal(
    resolveInitialProduct("love_grows_moss_green", ["pregnancy_journal"]),
    "pregnancy_journal"
  );
  assert.equal(resolveInitialProduct("little_years_girl", ["little_years"]), "little_years");
  assert.equal(resolveInitialProduct("little_artist", ["pregnancy_journal"]), "memory_book");
});

test("a product that isn't unlocked falls back to the memory book", () => {
  assert.equal(resolveInitialProduct("pregnancy_journal", []), "memory_book");
  assert.equal(resolveInitialProduct("love_grows_desert_sand", ["little_years"]), "memory_book");
  assert.equal(resolveInitialProduct("little_years", ["pregnancy_journal"]), "memory_book");
});

test("unknown values fall back to the memory book", () => {
  assert.equal(resolveInitialProduct("nonsense", ["pregnancy_journal"]), "memory_book");
});

test("tiles are in life-stage order and skip locked books", () => {
  assert.deepEqual(visibleProducts(["little_years", "pregnancy_journal"]), [
    "pregnancy_journal",
    "memory_book",
    "little_years",
  ]);
  assert.deepEqual(visibleProducts(["little_years"]), ["memory_book", "little_years"]);
  assert.deepEqual(visibleProducts([]), ["memory_book"]);
});
