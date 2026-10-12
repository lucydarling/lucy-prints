/**
 * TESTING ONLY. End-to-end rehearsal of print-in-rounds against ONE internal test
 * session (an @lucydarling.com test book), through the real webhook logic
 * (handlePaidOrder with the real Supabase dependencies) and synthetic Shopify
 * order bodies. Nothing is paid, nothing goes to Photo Finale/Persnickety;
 * delivery (separate step) goes to the Dropbox demo/ hotfolder only.
 *
 *   npm run print-order:rounds-e2e -- run <session token>
 *   npm run print-order:rounds-e2e -- cleanup <session token>   (removes ONLY rows/files this test created)
 *
 * Order ids are 99000001+, so they can never collide with a real Shopify order.
 */
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getPrintDimensions, getPrintSizeLabel, getSlots } from "@/lib/photo-slots";
import { handlePaidOrder, type ShopifyPaidOrder } from "@/lib/print-orders/paid-order";
import { realPaidOrderDeps } from "@/lib/print-orders/paid-order-deps";
import { computeRound, type ReprintRow } from "@/lib/print-orders/round";
import { getPrintedState, printedSlotCount } from "@/lib/print-orders/printed";
import { validatePrintRequest } from "@/lib/print-orders/print-request";
import { variantIdForKey } from "@/lib/print-orders/config";

const THEME = "little_artist";
const SLOTS = getSlots(THEME);
const ORDER_BASE = 99000000;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

async function noise(w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 60 }).toBuffer();
}
async function put(path: string, w: number, h: number) {
  const { error } = await supabaseAdmin.storage.from("photos").upload(path, await noise(w, h), { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

async function main() {
  const [mode, token] = process.argv.slice(2);
  if (!["run", "cleanup"].includes(mode) || !token) throw new Error("usage: rounds-e2e run|cleanup <session token>");
  const { data: session } = await supabaseAdmin.from("sessions").select("id, email, book_theme").eq("token", token).maybeSingle();
  if (!session) throw new Error("session not found");
  if (!/@lucydarling\.com$/i.test(session.email) || session.book_theme !== THEME) throw new Error("refusing: not an internal @lucydarling.com little_artist test session");
  const sid = session.id as string;
  if (mode === "cleanup") return cleanup(sid);

  const variant = variantIdForKey("print");
  const deps = realPaidOrderDeps();

  async function fill(keys: string[]) {
    for (const k of keys) {
      const s = SLOTS.find((x) => x.key === k)!;
      const d = getPrintDimensions(s.size, s.orientation);
      const path = `${sid}/${k}.jpg`;
      await put(path, d.width, d.height);
      const { error } = await supabaseAdmin.from("session_photos").upsert(
        { session_id: sid, slot_key: k, storage_path: path, print_size: getPrintSizeLabel(s.size, s.orientation), status: "cropped" },
        { onConflict: "session_id,slot_key" }
      );
      if (error) throw new Error(error.message);
    }
  }
  async function addExtra(id: string, quantity: number) {
    const path = `${sid}/extras/${id}.jpg`;
    await put(path, 1200, 1200);
    const { error } = await supabaseAdmin.from("session_extras").upsert(
      { session_id: sid, extra_id: id, print_size: "4x4", orientation: "portrait", storage_path: path, quantity },
      { onConflict: "session_id,extra_id" }
    );
    if (error) throw new Error(error.message);
  }
  async function currentRound() {
    const [{ data: photos }, { data: extras }, { data: reprints }, printed] = await Promise.all([
      supabaseAdmin.from("session_photos").select("slot_key, storage_path, print_size, status").eq("session_id", sid),
      supabaseAdmin.from("session_extras").select("extra_id, print_size, orientation, storage_path, quantity").eq("session_id", sid),
      supabaseAdmin.from("print_reprints").select("id, slot_key, storage_path, print_size, status").eq("session_id", sid).eq("status", "pending"),
      getPrintedState(sid),
    ]);
    const round = computeRound({ bookTheme: THEME, photoRows: photos ?? [], extraRows: extras ?? [], reprintRows: (reprints ?? []) as ReprintRow[], printed });
    const check = validatePrintRequest({ bookTheme: THEME, newPhotos: round.newPhotos, extraPrints: round.extras, reprints: round.reprints, printedSoFar: printedSlotCount(printed) });
    return { round, check };
  }
  /** What the checkout click does: record the round. */
  async function click() {
    const { round, check } = await currentRound();
    if (check.errors.length) return { check, round, id: null as string | null };
    const { data, error } = await supabaseAdmin
      .from("print_rounds")
      .insert({ session_id: sid, items: round.items, quantities: round.quantities, total_prints: round.total })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { check, round, id: data.id as string };
  }
  const order = (n: number, roundId: string, qty: number): ShopifyPaidOrder => ({
    id: ORDER_BASE + n, name: `#E2E-${n}`, email: "rounds-e2e@example.test", created_at: new Date().toISOString(),
    line_items: [{ variant_id: Number(variant), quantity: qty }],
    note_attributes: [{ name: "session_token", value: token }, { name: "book_theme", value: THEME }, { name: "round_id", value: roundId }],
    shipping_address: { first_name: "Round", last_name: "Tester", address1: "1 Test Way", city: "Salt Lake City", province_code: "UT", zip: "84116", country_code: "US" },
    customer: { first_name: "Round", last_name: "Tester" },
  });
  const itemRows = async () => (await supabaseAdmin.from("print_order_items").select("kind, item_key, generation, print_order_id").eq("session_id", sid)).data ?? [];

  // ---- Round 1: 6 book photos + one extra (3 prints) ----
  await fill(SLOTS.slice(0, 6).map((s) => s.key));
  await addExtra("extra_e2e_a", 3);
  const c1 = await click();
  ok(c1.id && c1.round.total === 9, `round 1 recorded: ${c1.round.total} prints (6 photos + 3 extra)`);
  const r1 = await handlePaidOrder(order(1, c1.id!, c1.round.total), deps);
  ok(r1.status === "ready" && r1.printCount === 9, `order 1 ready with 9 prints (${r1.status} ${r1.reasons.join(";")})`);
  ok((await itemRows()).length === 7, "order 1 wrote 7 items (6 slots + 1 extra)");

  // ---- Nothing new ----
  const nothing = await currentRound();
  ok(nothing.check.empty && nothing.check.errors.some((e) => /nothing new to print/.test(e)), "nothing new: blocked with 'nothing new to print', no round recorded");

  // ---- Under the minimum ----
  await fill(SLOTS.slice(6, 8).map((s) => s.key));
  const under = await currentRound();
  ok(under.round.total === 2 && under.check.errors.some((e) => /at least \d+ prints/.test(e)), "2 new photos: blocked under the minimum, no round recorded");

  // ---- Round 2: 6 new photos (2 waiting + 4 more) ----
  await fill(SLOTS.slice(8, 12).map((s) => s.key));
  const c2 = await click();
  ok(c2.id && c2.round.total === 6, `round 2 recorded: ${c2.round.total} new prints, none of round 1`);
  const r2 = await handlePaidOrder(order(2, c2.id!, c2.round.total), deps);
  ok(r2.status === "ready" && r2.printCount === 6, `order 2 ready with 6 prints (${r2.status} ${r2.reasons.join(";")})`);
  ok(r2.printedSoFar === 12, `progress after order 2: ${r2.printedSoFar} of ${r2.bookSlots}`);

  // ---- Reprint of slot 0 + 4 new photos ----
  const rpPath = `${sid}/reprints/${SLOTS[0].key}-e2e.jpg`;
  const d0 = getPrintDimensions(SLOTS[0].size, SLOTS[0].orientation);
  await put(rpPath, d0.width, d0.height);
  const { error: rpErr } = await supabaseAdmin.from("print_reprints").insert({ session_id: sid, slot_key: SLOTS[0].key, storage_path: rpPath, print_size: getPrintSizeLabel(SLOTS[0].size, SLOTS[0].orientation) });
  if (rpErr) throw new Error(rpErr.message);
  await fill(SLOTS.slice(12, 16).map((s) => s.key));
  const c3 = await click();
  ok(c3.id && c3.round.reprints === 1 && c3.round.total === 5, `round 3 recorded: ${c3.round.newPhotos} new + ${c3.round.reprints} reprint`);
  const r3 = await handlePaidOrder(order(3, c3.id!, c3.round.total), deps);
  ok(r3.status === "ready" && r3.printCount === 5, `order 3 ready with 5 prints (${r3.status} ${r3.reasons.join(";")})`);
  const items = await itemRows();
  ok(items.filter((i) => i.item_key === SLOTS[0].key).map((i) => i.generation).sort().join() === "1,2", "slot 0 has generation 1 and 2 items");
  const live = (await supabaseAdmin.from("session_photos").select("storage_path").eq("session_id", sid).eq("slot_key", SLOTS[0].key).single()).data;
  ok(live?.storage_path === rpPath, "live pointer for slot 0 moved to the reprint photo");
  ok((await supabaseAdmin.storage.from("photos").download(`${sid}/${SLOTS[0].key}.jpg`)).error === null, "the original slot file still exists (never overwritten)");
  const rp = (await supabaseAdmin.from("print_reprints").select("status").eq("session_id", sid)).data;
  ok(rp?.[0]?.status === "included", "reprint marked included");

  // ---- Quantity mismatch (paid one fewer) holds, locks nothing ----
  await fill(SLOTS.slice(16, 21).map((s) => s.key));
  const c4 = await click();
  const before = (await itemRows()).length;
  const r4 = await handlePaidOrder(order(4, c4.id!, c4.round.total - 1), deps);
  ok(r4.status === "held" && /do not match/.test(r4.reasons[0] ?? ""), `order 4 (paid one short) held: ${r4.reasons[0]}`);
  ok((await itemRows()).length === before, "held order locked nothing");
  // Retry idempotency: replaying order 1's webhook changes nothing.
  const again = await handlePaidOrder(order(1, c1.id!, c1.round.total), deps);
  ok(again.status === "ready" && (await itemRows()).length === before, "replaying order 1's webhook is a no-op");

  console.log("\nready orders to deliver: " + [ORDER_BASE + 1, ORDER_BASE + 2, ORDER_BASE + 3].join(" "));
}

async function cleanup(sid: string) {
  const ids = [1, 2, 3, 4].map((n) => String(ORDER_BASE + n));
  const { data: orders } = await supabaseAdmin.from("print_orders").select("id, shopify_order_id").eq("session_id", sid).in("shopify_order_id", ids);
  const orderIds = (orders ?? []).map((o) => o.id as string);
  if (orderIds.length) await supabaseAdmin.from("print_order_items").delete().in("print_order_id", orderIds);
  await supabaseAdmin.from("print_orders").delete().eq("session_id", sid).in("shopify_order_id", ids);
  await supabaseAdmin.from("print_reprints").delete().eq("session_id", sid);
  await supabaseAdmin.from("print_rounds").delete().eq("session_id", sid);
  await supabaseAdmin.from("session_photos").delete().eq("session_id", sid);
  await supabaseAdmin.from("session_extras").delete().eq("session_id", sid);
  // Storage: only this test session's own folder and this test's frozen copies.
  const bucket = supabaseAdmin.storage.from("photos");
  const rm = async (prefix: string) => {
    const { data } = await bucket.list(prefix, { limit: 1000 });
    const files = (data ?? []).filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
    const dirs = (data ?? []).filter((f) => !f.id).map((f) => `${prefix}/${f.name}`);
    if (files.length) await bucket.remove(files);
    for (const d of dirs) await rm(d);
  };
  await rm(sid);
  for (const id of ids) await rm(`print-orders/${id}`);
  console.log("cleanup done for session", sid);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
