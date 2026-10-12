import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { getPrintDimensions, getPrintSizeLabel, getSlots } from "@/lib/photo-slots";
import {
  PRINT_PREVIEW_COOKIE,
  printButtonAllowed,
  printOrdersEnabled,
  printPreviewCookieValue,
  printPreviewKeyMatches,
} from "@/lib/print-orders/print-gate";
import { prepareCheckout } from "@/lib/print-orders/checkout-prepare";
import { handlePaidOrder, type CustomerNotice, type PaidOrderDeps, type ShopifyPaidOrder } from "@/lib/print-orders/paid-order";
import {
  customerEmailAllowed,
  printOrderHeldEmail,
  printOrderReceivedEmail,
  printOrderShippedEmail,
} from "@/lib/email";

const SECRET = "preview-secret-0123456789";
const THEME = "little_artist";
const jar = (cookies: Record<string, string>) => ({ get: (n: string) => (n in cookies ? { value: cookies[n] } : undefined) });

beforeEach(() => {
  delete process.env.PRINT_ORDERS_ENABLED;
  process.env.PRINT_PREVIEW_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SHOPIFY_VARIANT_STANDARD = "111";
  process.env.NEXT_PUBLIC_SHOPIFY_VARIANT_LUXURY = "222";
  process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN = "www.example-shop.test";
});

// ---------- the flag and the preview cookie ----------

test("flag off and no cookie: print ordering does not exist; the session's email never matters", () => {
  assert.equal(printOrdersEnabled(), false);
  assert.equal(printButtonAllowed(jar({})), false);
  assert.equal(printButtonAllowed(undefined), false);
  assert.equal(printButtonAllowed(jar({ ld_email: "someone@lucydarling.com" })), false);
});

test("only PRINT_ORDERS_ENABLED=true turns it on for everyone", () => {
  process.env.PRINT_ORDERS_ENABLED = "1";
  assert.equal(printButtonAllowed(jar({})), false);
  process.env.PRINT_ORDERS_ENABLED = "true";
  assert.equal(printButtonAllowed(jar({})), true);
});

test("the preview cookie: right value opens it, wrong/short/other values do not", () => {
  const good = printPreviewCookieValue()!;
  assert.ok(good && !good.includes(SECRET), "the cookie holds a hash, never the secret");
  assert.equal(printButtonAllowed(jar({ [PRINT_PREVIEW_COOKIE]: good })), true);
  assert.equal(printButtonAllowed(jar({ [PRINT_PREVIEW_COOKIE]: good.slice(1) + "0" })), false);
  assert.equal(printButtonAllowed(jar({ [PRINT_PREVIEW_COOKIE]: SECRET })), false);
  assert.equal(printButtonAllowed(jar({ [PRINT_PREVIEW_COOKIE]: "" })), false);
});

test("the secret: constant-time compare, and a missing or short secret never unlocks", () => {
  assert.equal(printPreviewKeyMatches(SECRET), true);
  assert.equal(printPreviewKeyMatches(SECRET + " "), false);
  assert.equal(printPreviewKeyMatches("nope"), false);
  assert.equal(printPreviewKeyMatches(null), false);
  process.env.PRINT_PREVIEW_SECRET = "short";
  assert.equal(printPreviewKeyMatches("short"), false);
  assert.equal(printPreviewCookieValue(), null);
  delete process.env.PRINT_PREVIEW_SECRET;
  assert.equal(printPreviewKeyMatches(SECRET), false);
  assert.equal(printButtonAllowed(jar({ [PRINT_PREVIEW_COOKIE]: "x" })), false);
});

test("/review?print_preview=: right secret sets an httpOnly cookie and cleans the URL; wrong secret does not; no parameter passes through", async () => {
  const { proxy, config } = await import("@/proxy");
  assert.deepEqual(config.matcher, ["/review"]);
  const ok = proxy(new NextRequest(`https://memories.test/review?print_preview=${SECRET}`));
  assert.equal(ok.headers.get("location"), "https://memories.test/review");
  const set = ok.headers.get("set-cookie") ?? "";
  assert.ok(set.includes(`${PRINT_PREVIEW_COOKIE}=${printPreviewCookieValue()}`) && /httponly/i.test(set));
  const bad = proxy(new NextRequest("https://memories.test/review?print_preview=wrong"));
  assert.equal(bad.headers.get("location"), "https://memories.test/review");
  assert.equal(bad.headers.get("set-cookie"), null);
  const none = proxy(new NextRequest("https://memories.test/review"));
  assert.equal(none.headers.get("location"), null);
  assert.equal(none.headers.get("set-cookie"), null);
});

test("flag off: the checkout route answers 404 before touching anything", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "x";
  const { POST } = await import("@/app/api/sessions/[token]/print-checkout/route");
  const res = await POST(new NextRequest("https://memories.test/api/sessions/abc/print-checkout", { method: "POST" }), { params: Promise.resolve({ token: "abc" }) });
  assert.equal(res.status, 404);
});

// ---------- the checkout decision ----------

const photoRows = (n: number) =>
  getSlots(THEME).slice(0, n).map((s) => {
    const d = getPrintDimensions(s.size, s.orientation);
    return { slot_key: s.key, storage_path: `p/${s.key}`, print_size: getPrintSizeLabel(s.size, s.orientation), status: "cropped" as const, _d: d };
  });
const base: { token: string; bookTheme: string; extraRows: []; lock: null } = { token: "tok123", bookTheme: THEME, extraRows: [], lock: null };

test("checkout: a saved book gets the confirm line and a cart-clearing Shopify URL carrying the token", () => {
  const r = prepareCheckout({ ...base, photoRows: photoRows(5) });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.match(r.message, /^You're printing 5 of \d+ photos$/);
  const u = new URL(r.url);
  assert.match(u.host, /lucydarling\.com$|example-shop\.test$/);
  assert.equal(u.pathname, "/cart/clear");
  const inner = new URL(u.searchParams.get("return_to")!, "https://x.test");
  assert.equal(inner.pathname, "/cart/111:1");
  assert.equal(inner.searchParams.get("attributes[session_token]"), "tok123");
  assert.equal(inner.searchParams.get("attributes[book_theme]"), THEME);
});

test("checkout: blocks an empty book, a locked book, a held book and an unprintable book, with a reason and no URL", () => {
  for (const [name, input] of [
    ["empty", { ...base, photoRows: [] }],
    ["slots without a stored file or marked empty", { ...base, photoRows: [{ ...photoRows(1)[0], storage_path: "" }, { ...photoRows(2)[1], status: "empty" }] }],
    ["frozen", { ...base, photoRows: photoRows(3), lock: "frozen" as const }],
    ["held", { ...base, photoRows: photoRows(3), lock: "held" as const }],
    ["unknown book", { ...base, bookTheme: "nope", photoRows: photoRows(3) }],
  ] as const) {
    const r = prepareCheckout(input as Parameters<typeof prepareCheckout>[0]);
    assert.equal(r.ok, false, name);
    assert.ok(!r.ok && r.errors.length > 0 && !("url" in r), name);
  }
});

test("checkout: extras over the free cap are blocked at the button, extras within it are counted", () => {
  const extra = (n: number) => [{ extra_id: "e", print_size: "4x4", orientation: "portrait", storage_path: "p/e", quantity: n }];
  assert.equal(prepareCheckout({ ...base, photoRows: photoRows(2), extraRows: extra(13) }).ok, false);
  const ok = prepareCheckout({ ...base, photoRows: photoRows(2), extraRows: extra(3) });
  assert.ok(ok.ok && /plus 3 extra prints/.test(ok.message));
});

test("checkout: a Luxury book is sent to the Luxury variant", () => {
  const r = prepareCheckout({ ...base, bookTheme: "honey_bee", photoRows: photoRows(2) });
  assert.ok(r.ok);
  if (!r.ok) return;
  const inner = new URL(new URL(r.url).searchParams.get("return_to")!, "https://x.test");
  assert.equal(inner.pathname, "/cart/222:1");
});

// ---------- customer emails ----------

test("TEST_MODE: customer emails go only to @lucydarling.com addresses", () => {
  assert.equal(customerEmailAllowed("kevin@lucydarling.com", true), true);
  assert.equal(customerEmailAllowed("Kevin@LucyDarling.com ", true), true);
  assert.equal(customerEmailAllowed("mom@gmail.com", true), false);
  assert.equal(customerEmailAllowed("x@lucydarling.com.evil.test", true), false);
  assert.equal(customerEmailAllowed("evil@notlucydarling.com", true), false);
  assert.equal(customerEmailAllowed("mom@gmail.com", false), true);
});

test("emails: received lists counts and ship-to and escapes customer-supplied text; held links back to the book; shipped carries tracking", () => {
  const r = printOrderReceivedEmail({
    bookName: "Little Artist", babyName: "Zoë <b>", bookPrints: 14, extraPrints: 3,
    shipTo: { fname: "Pat", lname: "Smith", address1: "12 Main St", city: "Springfield", state: "IL", zip: "62701", country: "US" },
    orderName: "#1001",
  });
  assert.match(r.html, /14 photos plus 3 extra prints/);
  assert.match(r.html, /12 Main St/);
  assert.ok(!r.html.includes("<b>") && r.html.includes("&lt;b&gt;"));
  assert.ok(!/google\.com\/url/.test(r.html));
  const h = printOrderHeldEmail({ resumeUrl: "https://memories.lucydarling.com/resume/tok", orderName: "#1001" });
  assert.match(h.html, /href="https:\/\/memories\.lucydarling\.com\/resume\/tok"/);
  assert.match(h.html, /reply to this email and we.{1,8}ll send your order to print/);
  const s = printOrderShippedEmail({ bookName: "Little Artist", carrier: "USPS", trackingNumber: "9400", trackingUrl: "https://track.test/9400" });
  assert.match(s.html, /9400/);
  for (const e of [r, h, s]) assert.ok(!/free|discount|guarantee|days/i.test(e.html.replace(/<[^>]+>/g, " ")), "no offers or promises");
});

// ---------- the webhook sends at most the right emails ----------

const STD = "111";
function notifyDeps(opts: { filled: number; existing?: { status: string } | null; throwNotify?: boolean }) {
  const notices: CustomerNotice[] = [];
  const slots = getSlots(THEME);
  const d: PaidOrderDeps = {
    variants: { standardVariantId: STD, luxuryVariantId: "222", extraVariantIds: [] },
    loadSession: async () => ({
      session: { id: "sess-1", book_theme: THEME, baby_name: "Ada" },
      photoRows: slots.slice(0, opts.filled).map((s) => {
        const dim = getPrintDimensions(s.size, s.orientation);
        return { slot_key: s.key, storage_path: `p/${dim.width}x${dim.height}`, print_size: getPrintSizeLabel(s.size, s.orientation), status: "cropped" };
      }),
      extraRows: [],
      fetchImage: async (p: string) => {
        const slot = slots.find((s) => s.key === p.split("/").pop())!;
        const { width: w, height: h } = getPrintDimensions(slot.size, slot.orientation);
        const noise = Buffer.alloc(w * h * 3);
        for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
        return sharp(noise, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 70 }).toBuffer();
      },
    }),
    loadExisting: async () => opts.existing ?? null,
    freeze: async (id, photoRows, extraRows) => ({ frozenAt: "2026-10-11T00:00:00Z", photoRows: photoRows.map((r) => ({ ...r, storage_path: `frozen/${id}/${r.slot_key}` })), extraRows }),
    alert: async () => {},
    otherReadyOrderForSession: async () => false,
    record: async () => {},
    notify: async (n) => {
      if (opts.throwNotify) throw new Error("resend down");
      notices.push(n);
    },
  };
  return { d, notices };
}
const order = (over: Partial<ShopifyPaidOrder> = {}): ShopifyPaidOrder => ({
  id: 7770001, name: "#2001", email: "pat@example.test",
  line_items: [{ variant_id: Number(STD), quantity: 1 }],
  note_attributes: [{ name: "session_token", value: "tok" }, { name: "book_theme", value: THEME }],
  shipping_address: { first_name: "Pat", last_name: "Smith", address1: "12 Main St", city: "Springfield", province_code: "IL", zip: "62701", country_code: "US" },
  ...over,
});

test("a ready order emails 'received' once; a retry of a ready order sends nothing", async () => {
  const a = notifyDeps({ filled: 4 });
  const r = await handlePaidOrder(order(), a.d);
  assert.equal(r.status, "ready", r.reasons.join(";"));
  assert.equal(a.notices.length, 1);
  assert.deepEqual([a.notices[0].kind, a.notices[0].to, a.notices[0].bookPrints, a.notices[0].babyName], ["received", "pat@example.test", 4, "Ada"]);
  const again = notifyDeps({ filled: 4, existing: { status: "ready" } });
  await handlePaidOrder(order(), again.d);
  assert.equal(again.notices.length, 0);
});

test("an empty (held) order emails 'held' once; a refused order sends the customer nothing", async () => {
  const h = notifyDeps({ filled: 0 });
  assert.equal((await handlePaidOrder(order(), h.d)).status, "held");
  assert.deepEqual(h.notices.map((n) => n.kind), ["held"]);
  assert.equal(h.notices[0].sessionToken, "tok");
  const held2 = notifyDeps({ filled: 0, existing: { status: "held" } });
  await handlePaidOrder(order(), held2.d);
  assert.equal(held2.notices.length, 0, "a repeated held outcome does not re-email");
  const ref = notifyDeps({ filled: 3 });
  const r = await handlePaidOrder(order({ note_attributes: [{ name: "session_token", value: "tok" }, { name: "book_theme", value: "honey_bee" }] }), ref.d);
  assert.equal(r.status, "refused");
  assert.equal(ref.notices.length, 0);
});

test("held then completed: becoming ready sends 'received'; an email failure never fails the order; no email address = no email", async () => {
  const completed = notifyDeps({ filled: 4, existing: { status: "held" } });
  await handlePaidOrder(order(), completed.d);
  assert.deepEqual(completed.notices.map((n) => n.kind), ["received"]);
  const boom = notifyDeps({ filled: 4, throwNotify: true });
  assert.equal((await handlePaidOrder(order(), boom.d)).status, "ready");
  const noEmail = notifyDeps({ filled: 4 });
  await handlePaidOrder(order({ email: undefined }), noEmail.d);
  assert.equal(noEmail.notices.length, 0);
});
