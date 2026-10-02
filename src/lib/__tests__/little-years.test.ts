import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTRA_PRINT_SIZES,
  PHOTO_SLOTS,
  SLOTS_BY_PRODUCT,
  getPrintDimensions,
  getPrintSizeLabel,
  isSquarePrintSize,
  parsePrintLabel,
  type ProductType,
} from "@/lib/photo-slots";
import {
  PROMPTS_BY_PRODUCT,
  countFilledPrompts,
  getPromptsForSlot,
  getStandaloneAfterSection,
  repeatItemsWithContent,
  repeatNoteKey,
} from "@/lib/book-prompts";
import { LITTLE_YEARS_GIRL_PROMPTS, LITTLE_YEARS_PROMPTS } from "@/lib/little-years-prompts";

const LY = SLOTS_BY_PRODUCT.little_years;

test("Little Years has 146 square slots: 140 at 4x4, 6 at 5x5", () => {
  assert.equal(LY.length, 146);
  const count = (size: string) => LY.filter((s) => s.size === size).length;
  assert.equal(count("4x4"), 140);
  assert.equal(count("5x5"), 6);
  assert.deepEqual(
    LY.map((s) => s.sortOrder),
    LY.map((_, i) => i + 1),
    "slots are in book order"
  );
});

test("intro first, then the same 29-slot template for each age", () => {
  assert.equal(LY[0].key, "ly_story");
  assert.equal(LY[0].group, undefined);
  const ages = ["Age One", "Age Two", "Age Three", "Age Four", "Age Five"];
  for (const [i, age] of ages.entries()) {
    const slots = LY.filter((s) => s.group === age);
    assert.equal(slots.length, 29, age);
    const shape = slots.map((s) => `${s.key.replace(/^ly_a\d_/, "")}:${s.size}`);
    const first = LY.filter((s) => s.group === "Age One").map(
      (s) => `${s.key.replace(/^ly_a\d_/, "")}:${s.size}`
    );
    assert.deepEqual(shape, first, `${age} matches Age One`);
    assert.ok(slots.every((s) => s.key.startsWith(`ly_a${i + 1}_`)));
  }
  assert.equal(LY.filter((s) => s.customLabel).length, 30, "6 holiday slots per age");
});

test("5x5 prints at 1500x1500 and is never an extra print", () => {
  assert.deepEqual(getPrintDimensions("5x5"), { width: 1500, height: 1500 });
  assert.equal(getPrintSizeLabel("5x5"), "5x5");
  assert.ok(isSquarePrintSize("5x5"));
  assert.deepEqual(parsePrintLabel("5x5"), { size: "5x5" });
  assert.ok(!(EXTRA_PRINT_SIZES as readonly string[]).includes("5x5"));
});

test("the memory book still has its 49 slots", () => {
  assert.equal(PHOTO_SLOTS.length, 49);
  assert.equal(SLOTS_BY_PRODUCT.memory_book, PHOTO_SLOTS);
});

test("slot keys and section keys never repeat across products", () => {
  const products = Object.keys(SLOTS_BY_PRODUCT) as ProductType[];
  const keyOwner = new Map<string, ProductType>();
  const sectionOwner = new Map<string, ProductType>();
  for (const p of products) {
    for (const s of SLOTS_BY_PRODUCT[p]) {
      assert.ok(!keyOwner.has(s.key) || keyOwner.get(s.key) === p, `key ${s.key}`);
      keyOwner.set(s.key, p);
      assert.ok(!sectionOwner.has(s.section) || sectionOwner.get(s.section) === p, `section ${s.section}`);
      sectionOwner.set(s.section, p);
    }
  }
  // Prompt slot keys are unique too, and attached prompts point at a real slot.
  const promptKeys = new Set<string>();
  for (const p of products) {
    const slotKeys = new Set(SLOTS_BY_PRODUCT[p].map((s) => s.key));
    const sections = new Set(SLOTS_BY_PRODUCT[p].map((s) => s.section));
    for (const sp of PROMPTS_BY_PRODUCT[p]) {
      assert.ok(!promptKeys.has(sp.slotKey), `prompt key ${sp.slotKey}`);
      promptKeys.add(sp.slotKey);
      if (sp.standalone) assert.ok(sections.has(sp.afterSection ?? ""), `${sp.slotKey} afterSection`);
      else assert.ok(slotKeys.has(sp.slotKey), `${sp.slotKey} is a ${p} slot`);
      // (The memory book has a prompt-only "time_capsule" section with no photo slot.)
      if (p === "little_years") assert.ok(sections.has(sp.section), `${sp.slotKey} section`);
    }
  }
});

test("each age has birthday prompts, favorite things, an interview and quotes", () => {
  for (let a = 1; a <= 5; a++) {
    assert.equal(getPromptsForSlot(`ly_a${a}_birthday_1`)?.prompts.length, 4);
    const afterGrown = getStandaloneAfterSection(`ly_a${a}_grown`).map((s) => s.standaloneLabel);
    assert.deepEqual(afterGrown, ["Favorite Things", "An Interview With You"]);
    const quotes = getStandaloneAfterSection(`ly_a${a}_snapshots`);
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].repeat, 20);
  }
  assert.equal(getPromptsForSlot("ly_story")?.prompts[0].label, "This is the story of");
});

test("repeatable quotes count the items that have text", () => {
  const sp = getPromptsForSlot("ly_a1_quotes")!;
  const notes = {
    ly_a1_quotes: {
      [repeatNoteKey("quote", 1)]: "Moon is broken",
      [repeatNoteKey("date", 3)]: "June 2027",
      [repeatNoteKey("quote", 2)]: "   ",
    },
  };
  assert.deepEqual(repeatItemsWithContent(sp, notes.ly_a1_quotes), [1, 3]);
  assert.deepEqual(countFilledPrompts("ly_a1_quotes", notes), { filled: 2, total: 2 });
  assert.deepEqual(countFilledPrompts("ly_a1_quotes", {}), { filled: 0, total: 0 });
});

test("the Girl book says Game where the Boy book says Thing to wear", () => {
  const find = (list: typeof LITTLE_YEARS_PROMPTS, key: string) =>
    list.find((sp) => sp.slotKey === key)!.prompts.map((p) => p.label);
  const boy = find(LITTLE_YEARS_PROMPTS, "ly_a3_favorites");
  const girl = find(LITTLE_YEARS_GIRL_PROMPTS, "ly_a3_favorites");
  assert.equal(boy[2], "Thing to wear");
  assert.equal(girl[2], "Game");
  assert.deepEqual(boy.filter((_, i) => i !== 2), girl.filter((_, i) => i !== 2));
  assert.deepEqual(
    find(LITTLE_YEARS_PROMPTS, "ly_a3_interview"),
    find(LITTLE_YEARS_GIRL_PROMPTS, "ly_a3_interview")
  );
  // The Girl theme id picks the Girl wording; no theme falls back to the Boy book.
  assert.equal(getPromptsForSlot("ly_a3_favorites", "little_years_girl")!.prompts[2].label, "Game");
  assert.equal(getPromptsForSlot("ly_a3_favorites")!.prompts[2].label, "Thing to wear");
});
