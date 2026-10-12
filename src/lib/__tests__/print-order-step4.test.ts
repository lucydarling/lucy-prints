import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { getPrintSizeLabel, getSlots } from "@/lib/photo-slots";
import {
  PRINT_PREVIEW_COOKIE,
  printButtonAllowed,
  printOrdersEnabled,
  printPreviewCookieValue,
  printPreviewKeyMatches,
} from "@/lib/print-orders/print-gate";
import { prepareCheckout } from "@/lib/print-orders/checkout-prepare";
import { MAX_EXTRAS_PER_ORDER, MIN_PRINTS_PER_ORDER } from "@/lib/print-orders/config";
import { emptyPrinted } from "@/lib/print-orders/printed";
import { buildCheckoutUrl } from "@/lib/shopify";
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
  process.env.NEXT_PUBLIC_SHOPIFY_VARIANT_PRINT = "111";
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
  getSlots(THEME).slice(0, n).map((s) => ({
    slot_key: s.key, storage_path: `p/${s.key}`, print_size: getPrintSizeLabel(s.size, s.orientation), status: "cropped" as const,
  }));
const base = { token: "tok123", bookTheme: THEME, extraRows: [] as never[], reprintRows: [] as never[], printed: emptyPrinted(), variantId: () => "111" };
const createRound = async () => "round-1";

test("checkout: a saved book gets the confirm line, the price breakdown and a cart-clearing Shopify URL carrying the round", async () => {
  const r = await prepareCheckout({ ...base, photoRows: photoRows(6), createRound });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.match(r.message, /^You're printing 6 new photos\. 0 of \d+ printed so far\.$/);
  assert.equal(r.price.lines[0].quantity, 6);
  assert.equal(r.price.totalCents, 6 * r.price.lines[0].unitCents + r.price.shippingCents);
  const u = new URL(r.url);
  assert.match(u.host, /lucydarling\.com$|example-shop\.test$/);
  assert.equal(u.pathname, "/cart/clear");
  const inner = new URL(u.searchParams.get("return_to")!, "https://x.test");
  assert.equal(inner.pathname, "/cart/111:6");
  assert.equal(inner.searchParams.get("attributes[session_token]"), "tok123");
  assert.equal(inner.searchParams.get("attributes[book_theme]"), THEME);
  assert.equal(inner.searchParams.get("attributes[round_id]"), "round-1");
});

test("checkout: the cart has one line per variant (per-size variants are supported)", () => {
  const url = buildCheckoutUrl({ quantities: { "111": 4, "222": 2 }, sessionToken: "t", bookTheme: THEME, roundId: "r", printCount: 6 });
  assert.match(new URL(url).pathname, /^\/cart\/111:4,222:2$/);
  assert.throws(() => buildCheckoutUrl({ quantities: {}, sessionToken: "t", bookTheme: THEME, roundId: "r", printCount: 0 }), /at least one print/);
});

test("checkout: blocks an empty book, nothing new, an under-minimum round and an unprintable book, with a reason, no URL and no round recorded", async () => {
  let recorded = 0;
  const counting = async () => { recorded += 1; return "r"; };
  const printedAll = { slots: new Map(photoRows(3).map((x) => [x.slot_key, 1])), extras: new Set<string>() };
  for (const [name, input, re] of [
    ["empty", { ...base, photoRows: [] }, /nothing new to print/],
    ["slots without a stored file or marked empty", { ...base, photoRows: [{ ...photoRows(1)[0], storage_path: "" }, { ...photoRows(2)[1], status: "empty" }] }, /nothing new to print/],
    ["everything already printed", { ...base, photoRows: photoRows(3), printed: printedAll }, /nothing new to print/],
    ["under the minimum", { ...base, photoRows: photoRows(MIN_PRINTS_PER_ORDER - 1) }, new RegExp(`at least ${MIN_PRINTS_PER_ORDER} prints`)],
    ["unknown book", { ...base, bookTheme: "nope", photoRows: photoRows(6) }, /unknown book/],
  ] as const) {
    const r = await prepareCheckout({ ...(input as object), createRound: counting } as unknown as Parameters<typeof prepareCheckout>[0]);
    assert.equal(r.ok, false, name);
    assert.ok(!r.ok && r.errors.some((e) => re.test(e)) && !("url" in r), name);
  }
  assert.equal(recorded, 0);
});

test("checkout: extras and reprints count toward the minimum; only the hidden 100-extras limit blocks extras", async () => {
  const extra = (n: number) => [{ extra_id: "e", print_size: "4x4", orientation: "portrait", storage_path: "p/e", quantity: n }];
  const ok = await prepareCheckout({ ...base, photoRows: photoRows(2), extraRows: extra(3), createRound });
  assert.ok(ok.ok && /2 new photos and 3 extra prints/.test(ok.message), JSON.stringify(ok));
  assert.equal((await prepareCheckout({ ...base, photoRows: [], extraRows: extra(40), createRound })).ok, true, "no customer-facing cap");
  const over = await prepareCheckout({ ...base, photoRows: [], extraRows: extra(MAX_EXTRAS_PER_ORDER + 1), createRound });
  assert.ok(!over.ok && /looks like a mistake/.test(over.errors[0]));
  const printed = { slots: new Map([[getSlots(THEME)[0].key, 1]]), extras: new Set<string>() };
  const reprints = Array.from({ length: MIN_PRINTS_PER_ORDER }, (_, i) => ({ id: `rp${i}`, slot_key: getSlots(THEME)[0].key, storage_path: "x", print_size: "4x4" }));
  const withReprints = await prepareCheckout({ ...base, photoRows: [], printed, reprintRows: reprints.slice(0, 1), createRound });
  assert.equal(withReprints.ok, false, "one reprint alone is under the minimum");
  const mix = await prepareCheckout({ ...base, photoRows: photoRows(MIN_PRINTS_PER_ORDER - 1).slice(1), printed, reprintRows: reprints.slice(0, 1), extraRows: extra(3), createRound });
  assert.ok(mix.ok && /1 reprint/.test(mix.message), JSON.stringify(mix));
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
    bookName: "Little Artist", babyName: "Zoë <b>", newPhotos: 14, extraPrints: 3, reprints: 1, printedSoFar: 24, bookSlots: 49,
    shipTo: { fname: "Pat", lname: "Smith", address1: "12 Main St", city: "Springfield", state: "IL", zip: "62701", country: "US" },
    orderName: "#1001",
  });
  assert.match(r.html, /14 new photos, 3 extra prints and 1 reprint/);
  assert.match(r.html, /24 of 49 photos printed so far/);
  assert.match(r.html, /12 Main St/);
  assert.ok(!r.html.includes("<b>") && r.html.includes("&lt;b&gt;"));
  assert.ok(!/google\.com\/url/.test(r.html));
  const h = printOrderHeldEmail({ resumeUrl: "https://memories.lucydarling.com/resume/tok", orderName: "#1001" });
  assert.match(h.html, /href="https:\/\/memories\.lucydarling\.com\/resume\/tok"/);
  assert.match(h.html, /you don.{1,8}t need to pay again/i);
  const s = printOrderShippedEmail({ bookName: "Little Artist", carrier: "USPS", trackingNumber: "9400", trackingUrl: "https://track.test/9400" });
  assert.match(s.html, /9400/);
  for (const e of [r, h, s]) assert.ok(!/free|discount|guarantee|days/i.test(e.html.replace(/<[^>]+>/g, " ")), "no offers or promises");
});

