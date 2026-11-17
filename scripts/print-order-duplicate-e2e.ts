/**
 * TESTING ONLY. Replays ONE synthetic orders/paid body twice at the same time
 * against ONE internal, otherwise-empty test session (an @lucydarling.com
 * little_artist book), to prove a duplicate delivery ends with one ready row,
 * one "received" email and no refused/held alert (the 2026-11-17 #60895 race).
 * Nothing is paid; nothing is delivered to a print partner (no deliver step).
 *
 *   npm run print-order:duplicate-e2e -- local   <session id>   both deliveries through handlePaidOrder + real Supabase deps
 *   npm run print-order:duplicate-e2e -- route   <session id>   both deliveries POSTed to the deployed webhook with a valid HMAC
 *                                                             (needs SHOPIFY_WEBHOOK_SECRET in the environment)
 *   npm run print-order:duplicate-e2e -- cleanup <session id>   removes ONLY this test's rows and files
 *
 * The session must have no photos, rounds or orders of its own before `local`/`route`:
 * cleanup empties it again. Order id 99000301 can never collide with a real Shopify order.
 */
import crypto from "node:crypto";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getPrintDimensions, getPrintSizeLabel, getSlots } from "@/lib/photo-slots";
import { handlePaidOrder, type ShopifyPaidOrder } from "@/lib/print-orders/paid-order";
import { realPaidOrderDeps } from "@/lib/print-orders/paid-order-deps";
import { computeRound } from "@/lib/print-orders/round";
import { emptyPrinted } from "@/lib/print-orders/printed";
import { MIN_PRINTS_PER_ORDER, variantIdForKey } from "@/lib/print-orders/config";

const THEME = "little_artist";
const ORDER_ID = 99000301;
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "https://memories.lucydarling.com/api/webhooks/shopify/orders-paid";
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

async function main() {
  const [mode, sid] = process.argv.slice(2);
  if (!["local", "route", "cleanup"].includes(mode) || !sid) throw new Error("usage: duplicate-e2e local|route|cleanup <session id>");
  const { data: session } = await supabaseAdmin.from("sessions").select("id, token, email, book_theme").eq("id", sid).maybeSingle();
  if (!session) throw new Error("session not found");
  if (!/@lucydarling\.com$/i.test(session.email) || session.book_theme !== THEME) throw new Error("refusing: not an internal @lucydarling.com little_artist test session");
  if (mode === "cleanup") return cleanup(sid);

  for (const t of ["session_photos", "print_rounds", "print_orders", "print_order_items"]) {
    const { count } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true }).eq("session_id", sid);
    if (count) throw new Error(`refusing: the session already has ${count} ${t} rows (run cleanup first, or pick an empty test session)`);
  }

  // 8 cropped photos and the round the "Print my photos" click would record.
  const slots = getSlots(THEME).slice(0, MIN_PRINTS_PER_ORDER);
  for (const s of slots) {
    const d = getPrintDimensions(s.size, s.orientation);
    const raw = Buffer.alloc(d.width * d.height * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
    const path = `${sid}/${s.key}.jpg`;
    const up = await supabaseAdmin.storage.from("photos").upload(path, await sharp(raw, { raw: { width: d.width, height: d.height, channels: 3 } }).jpeg({ quality: 60 }).toBuffer(), { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error(up.error.message);
    const { error } = await supabaseAdmin.from("session_photos").upsert({ session_id: sid, slot_key: s.key, storage_path: path, print_size: getPrintSizeLabel(s.size, s.orientation), status: "cropped" }, { onConflict: "session_id,slot_key" });
    if (error) throw new Error(error.message);
  }
  const { data: photos } = await supabaseAdmin.from("session_photos").select("slot_key, storage_path, print_size, status").eq("session_id", sid);
  const round = computeRound({ bookTheme: THEME, photoRows: photos ?? [], extraRows: [], reprintRows: [], printed: emptyPrinted() });
  const { data: r, error: rErr } = await supabaseAdmin.from("print_rounds").insert({ session_id: sid, items: round.items, quantities: round.quantities, total_prints: round.total }).select("id").single();
  if (rErr) throw new Error(rErr.message);

  const order: ShopifyPaidOrder = {
    id: ORDER_ID, name: "#DUP-E2E", email: "duplicate-e2e@example.test", created_at: new Date().toISOString(), financial_status: "paid",
    line_items: [{ variant_id: Number(variantIdForKey("print")), quantity: round.total }],
    note_attributes: [{ name: "session_token", value: session.token }, { name: "book_theme", value: THEME }, { name: "round_id", value: r.id }],
    shipping_address: { first_name: "Dup", last_name: "Tester", address1: "1 Test Way", city: "Salt Lake City", province_code: "UT", zip: "84116", country_code: "US" },
    customer: { first_name: "Dup", last_name: "Tester" },
  };
  console.log(`round ${r.id}: ${round.total} prints; order ${ORDER_ID}; mode ${mode}`);
  const started = new Date().toISOString();

  if (mode === "local") {
    const counts = { notify: 0, alert: 0 };
    const deps = realPaidOrderDeps();
    // Count instead of emailing: this is a rehearsal.
    deps.notify = async () => { counts.notify += 1; };
    deps.alert = async (i) => { counts.alert += 1; console.log("ALERT would be sent:", i.status, i.reasons.join("; ")); };
    const results = await Promise.all([handlePaidOrder(order, deps), handlePaidOrder(order, deps)]);
    console.log("results:", results.map((x) => x.status).join(", "));
    ok(results.every((x) => x.status === "ready"), "both deliveries report ready");
    ok(counts.notify === 1, `exactly one 'received' email (${counts.notify})`);
    ok(counts.alert === 0, `no refused/held alert (${counts.alert})`);
  } else {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!secret) throw new Error("SHOPIFY_WEBHOOK_SECRET is not set");
    const body = JSON.stringify(order);
    const hmac = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
    const post = (webhookId: string) =>
      fetch(WEBHOOK_URL, {
        method: "POST", body,
        headers: { "content-type": "application/json", "x-shopify-hmac-sha256": hmac, "x-shopify-topic": "orders/paid", "x-shopify-webhook-id": webhookId, "x-shopify-event-id": "dup-e2e-event", "x-shopify-triggered-at": started },
      }).then(async (res) => ({ http: res.status, body: await res.text() }));
    const results = await Promise.all([post("dup-e2e-a"), post("dup-e2e-b")]);
    console.log("responses:", JSON.stringify(results));
    ok(results.every((x) => x.http === 200 && /"ready"/.test(x.body)), "both deliveries answered 200 ready");
  }

  const { data: rows } = await supabaseAdmin.from("print_orders").select("id, status, claim_id, reasons, external_id, print_count").eq("shopify_order_id", String(ORDER_ID));
  ok(rows?.length === 1 && rows[0].status === "ready" && rows[0].claim_id === null, `one ready row, claim released (${JSON.stringify(rows?.map((x) => [x.status, x.claim_id, x.print_count]))})`);
  const { count: items } = await supabaseAdmin.from("print_order_items").select("*", { count: "exact", head: true }).eq("session_id", sid);
  ok(items === MIN_PRINTS_PER_ORDER, `${items} items written once`);
  const { data: sends } = await supabaseAdmin.from("email_sends").select("route, outcome, internal_recipient, created_at").gte("created_at", started);
  console.log("email_sends since start:", JSON.stringify(sends));
}

async function cleanup(sid: string) {
  const { data: orders } = await supabaseAdmin.from("print_orders").select("id").eq("shopify_order_id", String(ORDER_ID));
  const ids = (orders ?? []).map((o) => o.id as string);
  if (ids.length) await supabaseAdmin.from("print_order_items").delete().in("print_order_id", ids);
  await supabaseAdmin.from("print_orders").delete().eq("shopify_order_id", String(ORDER_ID));
  await supabaseAdmin.from("print_rounds").delete().eq("session_id", sid);
  await supabaseAdmin.from("session_photos").delete().eq("session_id", sid);
  const bucket = supabaseAdmin.storage.from("photos");
  for (const prefix of [sid, `print-orders/${ORDER_ID}`]) {
    const { data } = await bucket.list(prefix, { limit: 1000 });
    const files = (data ?? []).filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
    if (files.length) await bucket.remove(files);
  }
  console.log("cleanup done for session", sid);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
