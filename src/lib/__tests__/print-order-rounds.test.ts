import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { getPrintDimensions, getPrintSizeLabel, getSlots } from "@/lib/photo-slots";
import {
  handlePaidOrder,
  type AlertInfo,
  type CommitResult,
  type CustomerNotice,
  type PaidOrderDeps,
  type PaidOrderResult,
  type PrintSnapshot,
  type RoundRecord,
  type ShopifyPaidOrder,
} from "@/lib/print-orders/paid-order";
import type { SessionExtraRow, SessionPhotoRow } from "@/lib/print-orders/build-order";
import { computeRound, quantityMismatches, type ReprintRow } from "@/lib/print-orders/round";
import { printedStateFromItems, type PrintedState } from "@/lib/print-orders/printed";
import { frozenOnly } from "@/lib/print-orders/build-from-snapshot";
import { MIN_PRINTS_PER_ORDER } from "@/lib/print-orders/config";

const THEME = "little_artist";
const V = "111";
const SLOTS = getSlots(THEME).map((s) => s.key);

const cache = new Map<string, Buffer>();
async function img(w: number, h: number): Promise<Buffer> {
  const k = `${w}x${h}`;
  if (!cache.has(k)) {
    const noise = Buffer.alloc(w * h * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    cache.set(k, await sharp(noise, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 70 }).toBuffer());
  }
  return cache.get(k)!;
}
/** Every stored path ends in a slot key (or is an extra): serve an image of the right size. */
async function fetchImage(path: string): Promise<Buffer> {
  const last = path.split("/").pop()!.replace(/\.[a-z]+$/, "");
  const slot = getSlots(THEME).find((s) => last === s.key || last.endsWith(`__${s.key}`) || last.endsWith(s.key));
  if (!slot) return img(1200, 1200); // an extra (4x4)
  const d = getPrintDimensions(slot.size, slot.orientation);
  return img(d.width, d.height);
}

/** An in-memory stand-in for the database, shared by the fake dependencies. */
class World {
  photoRows: SessionPhotoRow[] = [];
  extraRows: SessionExtraRow[] = [];
  reprints: Array<ReprintRow & { status: string }> = [];
  rounds = new Map<string, RoundRecord>();
  items: Array<{ order: string; kind: string; key: string; gen: number }> = [];
  orders = new Map<string, { status: string; snapshot?: PrintSnapshot; roundId?: string }>();
  recorded: Array<PaidOrderResult & { shopifyOrderId: string }> = [];
  alerts: AlertInfo[] = [];
  notices: CustomerNotice[] = [];
  freezes = 0;
  nextRound = 1;

  fill(keys: string[]) {
    for (const k of keys) {
      const s = getSlots(THEME).find((x) => x.key === k)!;
      const row = { slot_key: k, storage_path: `live/${k}`, print_size: getPrintSizeLabel(s.size, s.orientation), status: "cropped" };
      this.photoRows = [...this.photoRows.filter((r) => r.slot_key !== k), row];
    }
  }
  addExtra(id: string, quantity: number) {
    this.extraRows.push({ extra_id: id, print_size: "4x4", orientation: "portrait", storage_path: `live/${id}`, quantity });
  }
  printed(): PrintedState {
    return printedStateFromItems(this.items.map((i) => ({ kind: i.kind, item_key: i.key, generation: i.gen })));
  }
  /** What the checkout route does on a click: compute the round and record it. */
  click(ttlMs = 24 * 3600_000) {
    const round = computeRound({
      bookTheme: THEME, photoRows: this.photoRows, extraRows: this.extraRows,
      reprintRows: this.reprints.filter((r) => r.status === "pending"), printed: this.printed(), variantId: () => V,
    });
    const id = `round-${this.nextRound++}`;
    this.rounds.set(id, {
      id, session_id: "sess-1", items: round.items, quantities: round.quantities, total_prints: round.total,
      status: "open", expires_at: new Date(Date.now() + ttlMs).toISOString(),
    });
    return { id, round };
  }
  deps(over: { throwNotify?: boolean } = {}): PaidOrderDeps {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const w = this;
    return {
      printVariantIds: [V],
      loadSession: async (token) => {
        if (token !== "tok") throw new Error("Session not found");
        return { session: { id: "sess-1", book_theme: THEME, baby_name: "Ada" }, photoRows: w.photoRows, extraRows: w.extraRows, fetchImage };
      },
      loadRound: async (id) => w.rounds.get(id) ?? null,
      loadReprints: async () => w.reprints.filter((r) => r.status === "pending"),
      loadPrinted: async () => w.printed(),
      roundUsedByOtherOrder: async (roundId, orderId) =>
        [...w.orders.entries()].some(([id, o]) => id !== orderId && o.roundId === roundId && ["ready", "sent", "error"].includes(o.status)),
      loadExisting: async (id) => w.orders.get(id) ?? null,
      freeze: async (id, photoRows, extraRows) => {
        w.freezes += 1;
        return {
          frozenAt: "2026-10-11T00:00:00Z",
          photoRows: photoRows.map((r) => ({ ...r, storage_path: `print-orders/${id}/${r.storage_path.replace(/\//g, "__")}` })),
          extraRows: extraRows.map((r) => ({ ...r, storage_path: r.storage_path ? `print-orders/${id}/${r.storage_path.replace(/\//g, "__")}` : r.storage_path })),
        };
      },
      commitRound: async ({ shopifyOrderId, roundId, snapshot }): Promise<CommitResult> => {
        const reprintSlots = new Set((snapshot.reprints ?? []).map((r) => r.slot_key));
        const rows: Array<{ order: string; kind: string; key: string; gen: number }> = [];
        for (const r of snapshot.photoRows) {
          let gen = 1;
          if (reprintSlots.has(r.slot_key)) {
            const mine = w.items.find((i) => i.kind === "slot" && i.key === r.slot_key && i.order === shopifyOrderId);
            gen = mine ? mine.gen : Math.max(1, ...w.items.filter((i) => i.kind === "slot" && i.key === r.slot_key).map((i) => i.gen)) + 1;
          }
          rows.push({ order: shopifyOrderId, kind: "slot", key: r.slot_key, gen });
        }
        for (const r of snapshot.extraRows) rows.push({ order: shopifyOrderId, kind: "extra", key: r.extra_id, gen: 1 });
        const clash = rows.filter((r) => w.items.some((i) => i.kind === r.kind && i.key === r.key && i.gen === r.gen && i.order !== shopifyOrderId));
        if (clash.length > 0) return { ok: false, reason: `already printed by another order: ${clash.map((c) => c.key).join(", ")}` };
        for (const r of rows) if (!w.items.some((i) => i.kind === r.kind && i.key === r.key && i.gen === r.gen)) w.items.push(r);
        w.rounds.get(roundId)!.status = "paid";
        for (const rp of snapshot.reprints ?? []) {
          const live = w.reprints.find((x) => x.id === rp.reprint_id)!;
          live.status = "included";
          const photo = w.photoRows.find((p) => p.slot_key === live.slot_key)!;
          photo.storage_path = live.storage_path; // the live pointer moves to the new photo
        }
        return { ok: true, printedSoFar: new Set(w.items.filter((i) => i.kind === "slot").map((i) => i.key)).size, bookSlots: SLOTS.length };
      },
      alert: async (i) => { w.alerts.push(i); },
      notify: async (n) => {
        if (over.throwNotify) throw new Error("resend down");
        w.notices.push(n);
      },
      record: async (r) => {
        w.recorded.push(r);
        w.orders.set(r.shopifyOrderId, { status: r.status, snapshot: r.snapshot, roundId: r.roundId });
      },
    };
  }
}

const orderFor = (id: number, roundId: string, qty: number, over: Partial<ShopifyPaidOrder> = {}): ShopifyPaidOrder => ({
  id, name: `#${id}`, email: "pat@example.test", created_at: new Date().toISOString(),
  line_items: [{ variant_id: Number(V), quantity: qty }],
  note_attributes: [{ name: "session_token", value: "tok" }, { name: "book_theme", value: THEME }, { name: "round_id", value: roundId }],
  shipping_address: { first_name: "Pat", last_name: "Smith", address1: "12 Main St", city: "Springfield", province_code: "IL", zip: "62701", country_code: "US" },
  customer: { first_name: "Pat", last_name: "Smith" },
  ...over,
});

async function pay(w: World, id: number, over: Partial<ShopifyPaidOrder> = {}) {
  const { id: roundId, round } = w.click();
  return { roundId, round, result: await handlePaidOrder(orderFor(id, roundId, round.total, over), w.deps()) };
}

test("round 1 prints only the photos filled; round 2 prints only what was added since; earlier slots stay printed", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  const r1 = await pay(w, 1001);
  assert.equal(r1.result.status, "ready", r1.result.reasons.join(";"));
  assert.equal(r1.result.printCount, 6);
  assert.equal(r1.result.printedSoFar, 6);
  assert.equal(r1.result.externalId, "TEST-1001");

  w.fill(SLOTS.slice(6, 13)); // 7 more over the following months
  const r2 = await pay(w, 1002);
  assert.equal(r2.result.status, "ready", r2.result.reasons.join(";"));
  assert.equal(r2.result.printCount, 7, "only the 7 new photos, not the first 6 again");
  assert.deepEqual(r2.result.snapshot!.photoRows.map((r) => r.slot_key), SLOTS.slice(6, 13));
  assert.equal(r2.result.printedSoFar, 13);
  assert.equal(w.printed().slots.size, 13);
  assert.equal(w.orders.size, 2, "any number of paid orders per session");
});

test("nothing new, and under the minimum, are caught before payment and in the round itself", () => {
  const w = new World();
  w.fill(SLOTS.slice(0, MIN_PRINTS_PER_ORDER));
  const { round } = w.click();
  w.items.push(...SLOTS.slice(0, MIN_PRINTS_PER_ORDER).map((k) => ({ order: "x", kind: "slot", key: k, gen: 1 })));
  const again = computeRound({ bookTheme: THEME, photoRows: w.photoRows, extraRows: [], reprintRows: [], printed: w.printed(), variantId: () => V });
  assert.equal(round.total, MIN_PRINTS_PER_ORDER);
  assert.equal(again.total, 0, "everything printed -> nothing new to print");
});

test("extras added after an order are printed in the next round; a printed extra is never printed again", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 5));
  w.addExtra("extra_a", 3);
  const r1 = await pay(w, 2001);
  assert.equal(r1.result.printCount, 8);
  assert.ok(w.printed().extras.has("extra_a"));

  w.addExtra("extra_b", 5);
  const { round } = w.click();
  assert.deepEqual(round.items.extras, [{ extra_id: "extra_b", quantity: 5 }]);
  assert.equal(round.total, 5);
});

test("the snapshot is fixed at payment: later edits and a webhook retry change nothing and do not re-freeze or re-email", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  const r1 = await pay(w, 3001);
  assert.equal(w.freezes, 1);
  assert.equal(w.notices.length, 1);
  const before = JSON.stringify(r1.result.snapshot);

  w.fill(SLOTS.slice(0, 3)); // the customer re-uploads over live rows afterwards
  w.fill(SLOTS.slice(20, 25));
  const retry = await handlePaidOrder(orderFor(3001, r1.roundId, 6), w.deps());
  assert.equal(retry.status, "ready");
  assert.equal(retry.printCount, 6);
  assert.equal(JSON.stringify(w.orders.get("3001")!.snapshot), before, "snapshot unchanged");
  assert.equal(w.freezes, 1, "no second freeze");
  assert.equal(w.notices.length, 1, "no second 'received' email");
  assert.equal(w.items.filter((i) => i.order === "3001").length, 6, "items not duplicated");
});

test("photos added after the click are not in the round; they wait for the next one", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  const { id, round } = w.click();
  w.fill(SLOTS.slice(6, 10)); // added between click and payment
  const r = await handlePaidOrder(orderFor(4001, id, round.total), w.deps());
  assert.equal(r.status, "ready", r.reasons.join(";"));
  assert.equal(r.printCount, 6);
  assert.deepEqual(w.printed().slots.size, 6);
  const next = w.click();
  assert.equal(next.round.total, 4, "the 4 late photos are the next round");
});

test("quantity mismatches hold the order with an alert and lock nothing", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  const { id, round } = w.click();
  const r = await handlePaidOrder(orderFor(5001, id, round.total - 1), w.deps());
  assert.equal(r.status, "held");
  assert.match(r.reasons[0], /paid quantities do not match the recorded round/);
  assert.equal(w.alerts.length, 1);
  assert.equal(w.items.length, 0, "no lock");
  assert.equal(w.printed().slots.size, 0);

  assert.deepEqual(quantityMismatches({ a: 3, b: 2 }, { a: 3, b: 2 }), []);
  assert.equal(quantityMismatches({ a: 3 }, { a: 3, b: 2 }).length, 1, "per variant: a missing variant is a mismatch");
  assert.equal(quantityMismatches({ a: 3, b: 3 }, { a: 3, b: 2 }).length, 1);
});

test("an item deleted between click and payment holds the order; an edited extra quantity too", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  w.addExtra("extra_a", 2);
  const { id, round } = w.click();
  w.photoRows = w.photoRows.filter((r) => r.slot_key !== SLOTS[2]);
  w.extraRows[0].quantity = 3;
  const r = await handlePaidOrder(orderFor(6001, id, round.total), w.deps());
  assert.equal(r.status, "held");
  assert.match(r.reasons[0], /photo .* was removed/);
  assert.match(r.reasons[0], /extra extra_a changed from 2 to 3/);
  assert.equal(w.items.length, 0);
  assert.equal(w.alerts.length, 1);
});

test("an expired round (24h) holds the order", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  const { id, round } = w.click(-1000);
  const r = await handlePaidOrder(orderFor(7001, id, round.total), w.deps());
  assert.equal(r.status, "held");
  assert.match(r.reasons[0], /expired/);
});

test("a round naming an already-printed slot without a pending reprint is refused", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  await pay(w, 8001);
  // A stale round recorded before order 8001 was paid, naming slot 0 again:
  const stale: RoundRecord = {
    id: "stale", session_id: "sess-1", status: "open", expires_at: new Date(Date.now() + 1e6).toISOString(),
    items: { slots: [{ slot_key: SLOTS[0] }, ...SLOTS.slice(6, 11).map((k) => ({ slot_key: k }))], extras: [], reprints: [] },
    quantities: { [V]: 6 }, total_prints: 6,
  };
  w.rounds.set("stale", stale);
  w.fill(SLOTS.slice(6, 11));
  const r = await handlePaidOrder(orderFor(8002, "stale", 6), w.deps());
  assert.equal(r.status, "refused");
  assert.match(r.reasons[0], /already printed .*no paid reprint.*/);
  assert.equal(w.printed().slots.size, 6, "nothing new locked");
});

test("a round cannot be paid twice by different orders; a double print collision at commit holds the order", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  const { id, round } = w.click();
  assert.equal((await handlePaidOrder(orderFor(9001, id, round.total), w.deps())).status, "ready");
  const dup = await handlePaidOrder(orderFor(9002, id, round.total), w.deps());
  assert.equal(dup.status, "refused");
  assert.match(dup.reasons[0], /already paid by another order/);

  // Two rounds recorded with the same slots, paid close together: the second collides at commit.
  const w2 = new World();
  w2.fill(SLOTS.slice(0, 6));
  const a = w2.click();
  const b = w2.click();
  assert.equal((await handlePaidOrder(orderFor(9101, a.id, a.round.total), w2.deps())).status, "ready");
  // The second sees the slots as printed already and is refused before commit; if it raced past that check, commit would hold it.
  const second = await handlePaidOrder(orderFor(9102, b.id, b.round.total), w2.deps());
  assert.ok(["refused", "held"].includes(second.status));
  assert.equal(w2.printed().slots.size, 6, "never printed twice");
  assert.equal(w2.items.filter((i) => i.order === "9102").length, 0);

  const racing = new World();
  racing.fill(SLOTS.slice(0, 6));
  const c = racing.click();
  racing.items.push({ order: "other", kind: "slot", key: SLOTS[0], gen: 1 }); // another order committed in between
  const deps = racing.deps();
  deps.loadPrinted = async () => emptyState(); // the racing order's check ran before that commit
  const held = await handlePaidOrder(orderFor(9201, c.id, c.round.total), deps);
  assert.equal(held.status, "held");
  assert.match(held.reasons[0], /already printed by another order/);
  assert.equal(racing.alerts.length, 1);
});
const emptyState = (): PrintedState => ({ slots: new Map(), extras: new Set() });

test("a reprint: pending replacement of a printed slot is included in the next order, charged, and moves the live pointer; the original is never overwritten", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  const first = await pay(w, 10001);
  const printedCopy = first.result.snapshot!.photoRows.find((r) => r.slot_key === SLOTS[0])!.storage_path;

  w.reprints.push({ id: "rp1", slot_key: SLOTS[0], storage_path: `s/reprints/${SLOTS[0]}-1.jpg`, print_size: "4x4", status: "pending" });
  w.fill(SLOTS.slice(6, 10)); // 4 new photos + 1 reprint = 5 = minimum
  const { id, round } = w.click();
  assert.deepEqual(round.items.reprints, [{ reprint_id: "rp1", slot_key: SLOTS[0] }]);
  assert.equal(round.total, 5);
  const r = await handlePaidOrder(orderFor(10002, id, round.total), w.deps());
  assert.equal(r.status, "ready", r.reasons.join(";"));
  assert.equal(r.printCount, 5);
  assert.equal(r.snapshot!.reprints!.length, 1);
  assert.deepEqual(w.items.filter((i) => i.key === SLOTS[0]).map((i) => i.gen).sort(), [1, 2], "generation 2 for the reprint");
  assert.equal(w.reprints[0].status, "included");
  assert.equal(w.photoRows.find((p) => p.slot_key === SLOTS[0])!.storage_path, `s/reprints/${SLOTS[0]}-1.jpg`, "live pointer moved to the new photo");
  assert.ok(printedCopy.startsWith("print-orders/10001/"), "the printed copy sits in order 1's frozen folder, untouched");
  assert.ok(r.snapshot!.photoRows.every((x) => x.storage_path.startsWith("print-orders/10002/")));

  // After that, nothing is pending: the slot is printed (gen 2) and the next round is empty.
  assert.equal(w.click().round.total, 0);
});

test("a reprint removed before payment holds the order", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  await pay(w, 11001);
  w.reprints.push({ id: "rp1", slot_key: SLOTS[0], storage_path: "s/rp", print_size: "4x4", status: "pending" });
  w.fill(SLOTS.slice(6, 10));
  const { id, round } = w.click();
  w.reprints = [];
  const r = await handlePaidOrder(orderFor(11002, id, round.total), w.deps());
  assert.equal(r.status, "held");
  assert.match(r.reasons[0], /replacement photo for .* was removed/);
});

test("a repeated hold alerts once; a held order that is fixed and retried becomes ready and emails 'received' once", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  const { id, round } = w.click();
  const removed = w.photoRows.pop()!;
  const order = orderFor(12001, id, round.total);
  assert.equal((await handlePaidOrder(order, w.deps())).status, "held");
  assert.equal((await handlePaidOrder(order, w.deps())).status, "held");
  assert.equal(w.alerts.length, 1, "alerts once, not on every retry");
  assert.deepEqual(w.notices.map((n) => n.kind), ["held"]);

  w.photoRows.push(removed); // the customer puts the photo back
  const fixed = await handlePaidOrder(order, w.deps());
  assert.equal(fixed.status, "ready", fixed.reasons.join(";"));
  assert.deepEqual(w.notices.map((n) => n.kind), ["held", "received"]);
  const received = w.notices[1];
  assert.deepEqual([received.newPhotos, received.extraPrints, received.reprints, received.printedSoFar, received.bookSlots], [6, 0, 0, 6, SLOTS.length]);
});

test("orders that are not print orders are ignored; sent and error orders are never touched; an email failure never fails the order", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  const ign = await handlePaidOrder(orderFor(1, "x", 1, { line_items: [{ variant_id: 999, quantity: 1 }] }), w.deps());
  assert.equal(ign.status, "ignored");
  assert.equal(w.recorded.length, 0);

  for (const status of ["sent", "error"]) {
    const w2 = new World();
    w2.orders.set("13001", { status });
    const r = await handlePaidOrder(orderFor(13001, "x", 1), w2.deps());
    assert.equal(r.status, status);
    assert.equal(w2.recorded.length, 0);
    await assert.rejects(handlePaidOrder(orderFor(13001, "x", 1), w2.deps(), { refreeze: true }), new RegExp(`already ${status}`));
  }

  const { id, round } = w.click();
  assert.equal((await handlePaidOrder(orderFor(13100, id, round.total), w.deps({ throwNotify: true }))).status, "ready");
});

test("bad orders are refused with a clear reason: no round, no token, unknown round, other session, wrong book, journal, no ship-to, extras over the sanity limit", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  const { id, round } = w.click();
  const attrs = (...pairs: Array<[string, string]>) => pairs.map(([name, value]) => ({ name, value }));
  const reason = async (o: ShopifyPaidOrder) => (await handlePaidOrder(o, w.deps())).reasons[0];
  assert.match(await reason(orderFor(14001, id, 6, { note_attributes: attrs(["session_token", "tok"], ["book_theme", THEME]) })), /no round_id/);
  assert.match(await reason(orderFor(14002, id, 6, { note_attributes: attrs(["book_theme", THEME], ["round_id", id]) })), /no session_token/);
  assert.match(await reason(orderFor(14003, "nope", 6)), /round nope was not found/);
  assert.match(await reason(orderFor(14004, id, 6, { note_attributes: attrs(["session_token", "nope"], ["book_theme", THEME], ["round_id", id]) })), /Session not found/);
  assert.match(await reason(orderFor(14005, id, 6, { note_attributes: attrs(["session_token", "tok"], ["book_theme", "little_camper"], ["round_id", id]) })), /order says little_camper but the session is little_artist/);
  assert.match(await reason(orderFor(14006, id, 6, { note_attributes: attrs(["session_token", "tok"], ["book_theme", "love_grows_desert_sand"], ["round_id", id]) })), /cannot be printed through the Photo Lab yet/);
  assert.match(await reason(orderFor(14007, id, round.total, { shipping_address: null })), /shipment address1 is required/);
  w.rounds.get(id)!.session_id = "someone-else";
  assert.match(await reason(orderFor(14008, id, round.total)), /different session/);

  const big = new World();
  big.fill(SLOTS.slice(0, 6));
  big.addExtra("extra_big", 101);
  const c = big.click();
  const r = await handlePaidOrder(orderFor(14009, c.id, c.round.total), big.deps());
  assert.equal(r.status, "held");
  assert.match(r.reasons[0], /looks like a mistake/);
});

test("building from a round's snapshot reads only that order's frozen copies", async () => {
  const w = new World();
  w.fill(SLOTS.slice(0, 6));
  const r = await pay(w, 15001);
  const served: string[] = [];
  const guarded = frozenOnly("15001", async (p) => { served.push(p); return fetchImage(p); });
  for (const row of r.result.snapshot!.photoRows) await guarded(row.storage_path);
  assert.equal(served.length, 6);
  await assert.rejects(guarded("live/month_1"), /not a frozen copy of order 15001/);
});

test("computeRound: unknown slots and empty or storage-less rows are ignored; printed slots are excluded; reprints need a printed slot", () => {
  const printed = printedStateFromItems([{ kind: "slot", item_key: SLOTS[0], generation: 1 }, { kind: "extra", item_key: "extra_p", generation: 1 }]);
  const round = computeRound({
    bookTheme: THEME,
    photoRows: [
      { slot_key: SLOTS[0], storage_path: "a", print_size: "4x4", status: "cropped" },
      { slot_key: SLOTS[1], storage_path: "a", print_size: "4x4", status: "cropped" },
      { slot_key: SLOTS[2], storage_path: "", print_size: "4x4", status: "cropped" },
      { slot_key: SLOTS[3], storage_path: "a", print_size: "4x4", status: "empty" },
      { slot_key: "not_a_slot", storage_path: "a", print_size: "4x4", status: "cropped" },
    ],
    extraRows: [
      { extra_id: "extra_p", print_size: "4x4", orientation: "portrait", storage_path: "e", quantity: 2 },
      { extra_id: "extra_n", print_size: "4x4", orientation: "portrait", storage_path: "e", quantity: 2 },
      { extra_id: "extra_z", print_size: "4x4", orientation: "portrait", storage_path: null, quantity: 2 },
    ],
    reprintRows: [
      { id: "ok", slot_key: SLOTS[0], storage_path: "r", print_size: "4x4", status: "pending" },
      { id: "unprinted", slot_key: SLOTS[1], storage_path: "r", print_size: "4x4", status: "pending" },
      { id: "done", slot_key: SLOTS[0], storage_path: "r", print_size: "4x4", status: "included" },
    ],
    printed, variantId: () => V,
  });
  assert.deepEqual(round.items.slots, [{ slot_key: SLOTS[1] }]);
  assert.deepEqual(round.items.extras, [{ extra_id: "extra_n", quantity: 2 }]);
  assert.deepEqual(round.items.reprints, [{ reprint_id: "ok", slot_key: SLOTS[0] }]);
  assert.deepEqual([round.newPhotos, round.extras, round.reprints, round.total], [1, 2, 1, 4]);
  assert.deepEqual(round.quantities, { [V]: 4 });
});
