import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import sharp from "sharp";
import { getPrintDimensions, getPrintSizeLabel, getSlots } from "@/lib/photo-slots";
import { EXTRAS_FREE_CAP } from "@/lib/print-orders/config";
import { handlePaidOrder, type AlertInfo, type PaidOrderDeps, type PaidOrderResult, type PrintSnapshot, type ShopifyPaidOrder } from "@/lib/print-orders/paid-order";
import { lockFromStatuses, pickReusableSession, type PrintLock } from "@/lib/print-orders/freeze";
import { printingMessage, tierForTheme, validatePrintRequest } from "@/lib/print-orders/print-request";
import { verifyShopifyHmac } from "@/lib/print-orders/webhook-hmac";
import { buildOrder } from "@/lib/print-orders/build-order";
import { buildFromSnapshot, frozenOnly, requireReadySnapshot } from "@/lib/print-orders/build-from-snapshot";

const STD = "111";
const LUX = "222";
const EXTRA = "333";
const THEME = "little_artist"; // standard memory book

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

/** A session with every slot of the book filled at its exact size. */
function sessionRows(skip: string[] = []) {
  return getSlots(THEME)
    .filter((s) => !skip.includes(s.key))
    .map((s) => {
      const d = getPrintDimensions(s.size, s.orientation);
      return { slot_key: s.key, storage_path: `p/${d.width}x${d.height}`, print_size: getPrintSizeLabel(s.size, s.orientation), status: "cropped" };
    });
}
const fetchImage = async (p: string) => {
  if (p.startsWith("frozen/")) {
    const slot = getSlots(THEME).find((s) => s.key === p.split("/").pop())!;
    const d = getPrintDimensions(slot.size, slot.orientation);
    return img(d.width, d.height);
  }
  const [w, h] = p.replace("p/", "").split("x").map(Number);
  return img(w, h);
};

const orderJson = (over: Partial<ShopifyPaidOrder> = {}): ShopifyPaidOrder => ({
  id: 5550001,
  name: "#1001",
  line_items: [{ variant_id: Number(STD), quantity: 1 }],
  note_attributes: [
    { name: "session_token", value: "tok" },
    { name: "book_theme", value: THEME },
    { name: "photo_count", value: "999" }, // must be ignored: never an entitlement source
  ],
  shipping_address: { first_name: "Pat", last_name: "Smith", address1: "12 Main St", city: "Springfield", province_code: "IL", zip: "62701", country_code: "US" },
  customer: { first_name: "Pat", last_name: "Smith" },
  ...over,
});

function deps(over: { skip?: string[]; extras?: number; otherReady?: boolean; rows?: ReturnType<typeof sessionRows>; existing?: { status: string; snapshot?: PrintSnapshot } | null; liveRows?: { current: ReturnType<typeof sessionRows> } } = {}) {
  const recorded: Array<PaidOrderResult & { shopifyOrderId: string }> = [];
  const alerts: AlertInfo[] = [];
  const frozen: string[] = [];
  const d: PaidOrderDeps = {
    loadExisting: async () => over.existing ?? null,
    freeze: async (id, photoRows, extraRows) => {
      frozen.push(id);
      return { frozenAt: "2026-10-09T00:00:00Z", photoRows: photoRows.map((r) => ({ ...r, storage_path: `frozen/${id}/${r.slot_key}` })), extraRows };
    },
    alert: async (i) => { alerts.push(i); },
    variants: { standardVariantId: STD, luxuryVariantId: LUX, extraVariantIds: [EXTRA] },
    loadSession: async (token) => {
      if (token !== "tok") throw new Error("Session not found");
      return {
        session: { id: "sess-1", book_theme: THEME },
        photoRows: over.liveRows?.current ?? over.rows ?? sessionRows(over.skip),
        extraRows: Array.from({ length: over.extras ?? 0 }, (_, i) => ({
          extra_id: `extra_${i}`, print_size: "4x4", orientation: "portrait", storage_path: "p/1200x1200", quantity: 1,
        })),
        fetchImage,
      };
    },
    otherReadyOrderForSession: async () => over.otherReady ?? false,
    record: async (r) => { recorded.push(r); },
  };
  return { d, recorded, alerts, frozen };
}

test("a fully paid, fully filled memory book is ready (test-mode id)", async () => {
  const { d, recorded } = deps();
  const r = await handlePaidOrder(orderJson(), d);
  assert.equal(r.status, "ready", r.reasons.join(";"));
  assert.equal(r.externalId, "TEST-5550001");
  assert.equal(r.printCount, getSlots(THEME).length);
  assert.equal(recorded.length, 1);
});

test("an order with no print line item is ignored and not recorded", async () => {
  const { d, recorded } = deps();
  const r = await handlePaidOrder(orderJson({ line_items: [{ variant_id: 999, quantity: 1 }] }), d);
  assert.equal(r.status, "ignored");
  assert.equal(recorded.length, 0);
});

test("payment = finished: a partly filled book prints what is filled; only an empty order is held (and alerts)", async () => {
  const partial = deps({ skip: getSlots(THEME).slice(5).map((s) => s.key) }); // 5 slots filled
  const r = await handlePaidOrder(orderJson(), partial.d);
  assert.equal(r.status, "ready", r.reasons.join(";"));
  assert.equal(r.printCount, 5);
  assert.equal(partial.alerts.length, 0);

  const empty = deps({ rows: [] });
  const h = await handlePaidOrder(orderJson(), empty.d);
  assert.equal(h.status, "held");
  assert.match(h.reasons[0], /no photos were filled in when the order was paid/);
  assert.equal(empty.alerts.length, 1);
  assert.deepEqual([empty.alerts[0].status, empty.alerts[0].shopifyOrderName, empty.alerts[0].sessionToken], ["held", "#1001", "tok"]);
});

test("the photos are frozen at payment; a retry uses the snapshot, not live rows", async () => {
  const live = { current: sessionRows(getSlots(THEME).slice(3).map((s) => s.key)) }; // 3 filled at payment
  const first = deps({ liveRows: live, rows: [] });
  const r1 = await handlePaidOrder(orderJson(), first.d);
  assert.equal(r1.printCount, 3);
  assert.equal(first.frozen.length, 1);
  assert.equal(r1.snapshot!.photoRows.length, 3);
  assert.ok(r1.snapshot!.photoRows.every((r) => r.storage_path.startsWith("frozen/5550001/")));

  // The customer keeps editing afterwards (all slots now filled); a held order retried with its saved snapshot ignores that.
  live.current = sessionRows();
  const retry = deps({ liveRows: live, existing: { status: "refused", snapshot: r1.snapshot } });
  const r2 = await handlePaidOrder(orderJson(), retry.d);
  assert.equal(r2.printCount, 3);
  assert.equal(retry.frozen.length, 0, "must not re-freeze");

  // A HELD order always re-freezes on retry (its customer may still add photos).
  const held = deps({ liveRows: live, existing: { status: "held", snapshot: r1.snapshot } });
  const r4 = await handlePaidOrder(orderJson(), held.d);
  assert.equal(r4.printCount, getSlots(THEME).length);
  assert.equal(held.frozen.length, 1);

  // --refreeze forces a fresh snapshot of a refused order, but never of one that is already ready.
  const re = deps({ liveRows: live, existing: { status: "refused", snapshot: r1.snapshot } });
  const r3 = await handlePaidOrder(orderJson(), re.d, { refreeze: true });
  assert.equal(r3.printCount, getSlots(THEME).length);
  await assert.rejects(handlePaidOrder(orderJson(), deps({ existing: { status: "ready" } }).d, { refreeze: true }), /already ready/);
});

test("a webhook retry for an order that is already ready does nothing and sends no alert", async () => {
  const d = deps({ existing: { status: "ready", snapshot: { frozenAt: "x", photoRows: [], extraRows: [] } } });
  const r = await handlePaidOrder(orderJson(), d.d);
  assert.equal(r.status, "ready");
  assert.equal(d.recorded.length, 0);
  assert.equal(d.frozen.length, 0);
});

test("a repeated refusal alerts once, not on every retry", async () => {
  const a = deps({ extras: EXTRAS_FREE_CAP + 1 });
  assert.equal((await handlePaidOrder(orderJson(), a.d)).status, "refused");
  assert.equal(a.alerts.length, 1);
  assert.match(a.alerts[0].reasons[0], /extra prints/);
  const b = deps({ extras: EXTRAS_FREE_CAP + 1, existing: { status: "refused" } });
  await handlePaidOrder(orderJson(), b.d);
  assert.equal(b.alerts.length, 0);
});

test("an alert that fails to send never fails the order", async () => {
  const d = deps({ rows: [] });
  d.d.alert = async () => { throw new Error("resend down"); };
  assert.equal((await handlePaidOrder(orderJson(), d.d)).status, "held");
});

test("shared validation: the checkout button and the webhook use the same rules", () => {
  const ok = validatePrintRequest({ bookTheme: THEME, filledBookSlots: 12, extraPrints: 2 });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.printing, 12);
  assert.equal(ok.of, getSlots(THEME).length);
  assert.equal(printingMessage(ok), `You're printing 12 of ${getSlots(THEME).length} photos plus 2 extra prints`);
  assert.equal(printingMessage({ ...ok, extras: 1 }).endsWith("plus 1 extra print"), true);

  assert.match(validatePrintRequest({ bookTheme: THEME, filledBookSlots: 1, extraPrints: EXTRAS_FREE_CAP + 2 }).errors[0], /please choose 12 extras to print/);
  assert.match(validatePrintRequest({ bookTheme: "love_grows_desert_sand", filledBookSlots: 1, extraPrints: 0 }).errors[0], /cannot be printed through the Photo Lab yet/);
  assert.match(validatePrintRequest({ bookTheme: "", filledBookSlots: 1, extraPrints: 0 }).errors[0], /no book is selected/);
  assert.match(validatePrintRequest({ bookTheme: "nope", filledBookSlots: 1, extraPrints: 0 }).errors[0], /unknown book/);
  assert.equal(validatePrintRequest({ bookTheme: THEME, filledBookSlots: 0, extraPrints: 0 }).empty, true);
  assert.equal(validatePrintRequest({ bookTheme: THEME, filledBookSlots: 0, extraPrints: 1 }).empty, false);
  assert.equal(validatePrintRequest({ bookTheme: THEME, filledBookSlots: 1, extraPrints: EXTRAS_FREE_CAP + 1, paidExtras: 1 }).errors.length, 0);
  assert.equal(tierForTheme("honey_bee"), "luxury");
  assert.equal(tierForTheme("golden_blossom"), "standard"); // retiring books sell at the standard price
});

test("extras beyond the free cap are refused unless paid for; paid units raise the cap", async () => {
  const over = EXTRAS_FREE_CAP + 1;
  const a = await handlePaidOrder(orderJson(), deps({ extras: over }).d);
  assert.equal(a.status, "refused");
  assert.match(a.reasons[0], new RegExp(`${over} extra prints is over the limit of ${EXTRAS_FREE_CAP}`));

  const paid = orderJson({ line_items: [{ variant_id: Number(STD), quantity: 1 }, { variant_id: Number(EXTRA), quantity: 1 }] });
  assert.equal((await handlePaidOrder(paid, deps({ extras: over }).d)).status, "ready");
});

test("a photo in a slot that was not paid for refuses the order", async () => {
  const rows = [...sessionRows(), { slot_key: "not_a_slot", storage_path: "p/1200x1200", print_size: "4x4", status: "cropped" }];
  const r = await handlePaidOrder(orderJson(), deps({ rows }).d);
  assert.equal(r.status, "refused");
  assert.match(r.reasons[0], /did not pay for: not_a_slot/);
});

test("the photo_count attribute never changes what was paid for", async () => {
  const { d } = deps({ skip: getSlots(THEME).slice(2).map((s) => s.key) });
  const r = await handlePaidOrder(orderJson(), d); // photo_count says 999
  assert.equal(r.status, "ready");
  assert.equal(r.printCount, 2);
});

test("tier, theme, token and quantity problems refuse with a clear reason", async () => {
  const lux = await handlePaidOrder(orderJson({ line_items: [{ variant_id: Number(LUX), quantity: 1 }] }), deps().d);
  assert.match(lux.reasons[0], /paid for the luxury print product but little_artist is a standard book/);

  const two = await handlePaidOrder(orderJson({ line_items: [{ variant_id: Number(STD), quantity: 2 }] }), deps().d);
  assert.match(two.reasons[0], /quantity 1/);

  const noTok = await handlePaidOrder(orderJson({ note_attributes: [{ name: "book_theme", value: THEME }] }), deps().d);
  assert.match(noTok.reasons[0], /no session_token/);

  const wrongTheme = await handlePaidOrder(orderJson({ note_attributes: [{ name: "session_token", value: "tok" }, { name: "book_theme", value: "honey_bee" }] }), deps().d);
  assert.match(wrongTheme.reasons[0], /paid for the standard print product but honey_bee is a luxury book/);

  const journal = await handlePaidOrder(orderJson({ note_attributes: [{ name: "session_token", value: "tok" }, { name: "book_theme", value: "love_grows_desert_sand" }] }), deps().d);
  assert.match(journal.reasons[0], /cannot be printed through the Photo Lab yet/);

  const sessionMismatch = await handlePaidOrder(orderJson({ note_attributes: [{ name: "session_token", value: "tok" }, { name: "book_theme", value: "little_camper" }] }), deps().d);
  assert.match(sessionMismatch.reasons[0], /order says little_camper but the session is little_artist/);

  const missingSession = await handlePaidOrder(orderJson({ note_attributes: [{ name: "session_token", value: "nope" }, { name: "book_theme", value: THEME }] }), deps().d);
  assert.match(missingSession.reasons[0], /Session not found/);
});

test("a second paid order for a session that already has a ready print order is refused", async () => {
  const r = await handlePaidOrder(orderJson(), deps({ otherReady: true }).d);
  assert.equal(r.status, "refused");
  assert.match(r.reasons[0], /already has a ready print order/);
});

test("a missing shipping address refuses through the XML rules", async () => {
  const r = await handlePaidOrder(orderJson({ shipping_address: null }), deps().d);
  assert.equal(r.status, "refused");
  assert.match(r.reasons[0], /shipment address1 is required/);
});

test("Shopify HMAC: valid passes; tampered body, wrong secret, missing header fail", () => {
  const body = JSON.stringify({ id: 1 });
  const sig = createHmac("sha256", "s3cret").update(body).digest("base64");
  assert.equal(verifyShopifyHmac(body, sig, "s3cret"), true);
  assert.equal(verifyShopifyHmac(body + " ", sig, "s3cret"), false);
  assert.equal(verifyShopifyHmac(body, sig, "other"), false);
  assert.equal(verifyShopifyHmac(body, null, "s3cret"), false);
  assert.equal(verifyShopifyHmac(body, sig, ""), false);
  assert.equal(verifyShopifyHmac(body, "not-base64!!", "s3cret"), false);
});

test("a square source larger than a square slot is scaled down, never up", async () => {
  const base = {
    bookTheme: THEME, extraRows: [], externalId: "DS1",
    shipTo: { fname: "T", lname: "C", address1: "1 St", city: "SLC", state: "UT", zip: "84116", country: "US" },
    customer: { fname: "T", lname: "C" },
  };
  const big = await buildOrder({
    ...base, photoRows: [{ slot_key: "baby_bump", storage_path: "p/1200x1200", print_size: "4x4", status: "cropped" }],
    fetchImage,
  });
  const meta = await sharp(big.images[0].data).metadata();
  assert.deepEqual([meta.width, meta.height], [900, 900]); // baby_bump slot is 3x3
  assert.ok(big.warnings.some((w) => /downscaled from 1200x1200px to 900x900px/.test(w)));
  assert.ok(big.warnings.some((w) => /stored as 4x4 but the book slot prints 3x3/.test(w)));

  const small = await buildOrder({
    ...base, photoRows: [{ slot_key: "baby_photo", storage_path: "p/1000x1000", print_size: "4x4", status: "cropped" }],
    fetchImage,
  });
  const m2 = await sharp(small.images[0].data).metadata();
  assert.deepEqual([m2.width, m2.height], [1000, 1000]); // under size: flagged, not upscaled
  assert.ok(small.warnings.some((w) => /under the 1200x1200px/.test(w)));
});

test("session lock: ready/refused freeze, held stays editable, none is unlocked", () => {
  assert.equal(lockFromStatuses([]), null);
  assert.equal(lockFromStatuses(["held"]), "held");
  assert.equal(lockFromStatuses(["ready"]), "frozen");
  assert.equal(lockFromStatuses(["refused"]), "frozen");
  assert.equal(lockFromStatuses(["held", "ready"]), "frozen");
});

test("starting a book: a frozen session is never reused, so a new one is created; held and unlocked are reused", async () => {
  const locks: Record<string, PrintLock> = { newest: "frozen", middle: "held", oldest: null };
  const lockOf = async (id: string) => locks[id];
  const candidates = [{ id: "newest" }, { id: "middle" }, { id: "oldest" }]; // newest first
  assert.equal((await pickReusableSession(candidates, lockOf))?.id, "middle");
  assert.equal(await pickReusableSession([{ id: "newest" }], lockOf), null); // only a frozen one -> create new
  assert.equal(await pickReusableSession([], lockOf), null);
  assert.equal((await pickReusableSession([{ id: "oldest" }], lockOf))?.id, "oldest");
});

test("the saved snapshot carries what a later build needs; building it reads only frozen copies and gives the same order", async () => {
  const live = { current: sessionRows(getSlots(THEME).slice(4).map((s) => s.key)) }; // 4 filled at payment
  const first = deps({ liveRows: live, extras: 2 });
  const r = await handlePaidOrder(orderJson(), first.d);
  assert.equal(r.status, "ready", r.reasons.join(";"));
  const snap = r.snapshot!;
  assert.equal(snap.order?.bookTheme, THEME);
  assert.deepEqual(snap.order?.shipTo.city, "Springfield");
  assert.equal(snap.order?.paidExtras, 0);

  // The build gets a fetcher that serves frozen copies ONLY; live paths would throw.
  const served: string[] = [];
  const frozenFetch = frozenOnly("5550001", async (p) => {
    served.push(p);
    return fetchImage(p);
  });
  // Frozen test paths are "frozen/<id>/…", so give the guard the matching prefix by re-mapping.
  const mapped: PrintSnapshot = {
    ...snap,
    photoRows: snap.photoRows.map((x) => ({ ...x, storage_path: x.storage_path.replace("frozen/5550001/", "print-orders/5550001/") })),
    extraRows: snap.extraRows.map((x) => ({ ...x, storage_path: x.storage_path ? "print-orders/5550001/" + x.storage_path : x.storage_path })),
  };
  const fetchFrozen = async (p: string) => {
    if (p.includes("/p/")) return img(1200, 1200); // an extra
    const slot = getSlots(THEME).find((sl) => p.endsWith(sl.key))!;
    const d = getPrintDimensions(slot.size, slot.orientation);
    return img(d.width, d.height);
  };
  const guarded = frozenOnly("5550001", async (p) => { served.push(p); return fetchFrozen(p); });
  const built = await buildFromSnapshot("5550001", mapped, guarded);
  assert.equal(built.folderName, "TEST-5550001");
  assert.equal(built.printCount, 4 + 2);
  assert.ok(served.every((p) => p.startsWith("print-orders/5550001/")));
  assert.match(built.xml.data.toString(), /city="Springfield" state="IL" zip="62701" country="US"/);

  // A fetch of a live path is refused outright.
  await assert.rejects(frozenFetch("p/1200x1200"), /not a frozen copy of order 5550001/);
});

test("manual build: only a ready order, only from its own frozen copies", () => {
  const snap: PrintSnapshot = {
    frozenAt: "x",
    photoRows: [{ slot_key: "a", storage_path: "print-orders/77/a", print_size: "4x4", status: "cropped" }],
    extraRows: [],
  };
  assert.throws(() => requireReadySnapshot("77", null), /no print order recorded/);
  assert.throws(() => requireReadySnapshot("77", { status: "held", snapshot: snap }), /is "held", not ready/);
  assert.throws(() => requireReadySnapshot("77", { status: "refused", snapshot: snap }), /is "refused", not ready/);
  assert.throws(() => requireReadySnapshot("77", { status: "ready", snapshot: null }), /no saved snapshot/);
  const live: PrintSnapshot = { ...snap, photoRows: [{ ...snap.photoRows[0], storage_path: "abc-session/a.jpg" }] };
  assert.throws(() => requireReadySnapshot("77", { status: "ready", snapshot: live }), /outside print-orders\/77\/.*refusing to read live files/);
  assert.equal(requireReadySnapshot("77", { status: "ready", snapshot: snap }), snap);
});

test("a snapshot from before order details were saved cannot be built", async () => {
  await assert.rejects(
    buildFromSnapshot("1", { frozenAt: "x", photoRows: [], extraRows: [] }, async () => Buffer.alloc(0)),
    /no order details/
  );
});
