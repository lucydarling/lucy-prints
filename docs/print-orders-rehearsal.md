# Print orders — live rehearsal (Justin, own card)

Written 2026-10-11 for print-in-rounds (step 5). **Nothing in this rehearsal goes to Photo Finale or Persnickety.** Delivery is manual, to the Dropbox `demo/` hotfolder only, in TEST_MODE (`TEST-` ids; customer emails only reach @lucydarling.com addresses). `PRINT_ORDERS_ENABLED` stays unset; Justin sees the feature only through the private preview link.

Prices below are PLACEHOLDERS until Chari confirms: **$20.00 per print** (`PRICE_CENTS_BY_VARIANT_KEY` in `src/lib/print-orders/config.ts`), **$6.00 S&H per order**, **5-print minimum** (`MIN_PRINTS_PER_ORDER`). The price Shopify charges is the variant's price; the number in the confirm step comes from `config.ts`, so **change both together** or the confirm step and checkout will disagree.

## 1. Setup checklist (Kevin)

**Code and database (done by Claude before this doc was handed over)**
- [ ] Migration 012 applied (tables `print_rounds`, `print_order_items`, `print_reprints`; columns `print_orders.round_id`, `paid_quantity`). Verified by SQL 2026-10-11.
- [ ] Step 5 code deployed with the flag OFF.

**Shopify product "Custom Photo Prints for Memory Book"**
1. Variants: one variant, "Photo print" (id `48078680424673`). Done 2026-10-11 (the Luxury variant is deleted).
2. Price: currently a **$1.00 placeholder** in Shopify. For the rehearsal the paid amount does not matter to the app; for launch set the real price and keep it equal to `PRICE_CENTS_BY_VARIANT_KEY.print` ÷ 100.
3. Inventory: don't track quantity. "This is a physical product" stays on (shipping is needed).
4. **Status: Active** (done; the cart link answers 410 while it is Draft).
5. **Keep it out of collections and search:**
   - Collections: open the product → *Collections* must be empty. Then check each automated collection's conditions (e.g. "All products", vendor/type/tag rules) so none of them picks it up.
   - Search and recommendations: add the product metafield `seo.hidden` (integer) = `1` (hides it from storefront search, predictive search and the sitemap). Also check the product page's *Sales channels*: publish it to **Online Store only** (not Google & YouTube, Meta, Shop, Faire, etc.).
   - Rebuy: in Rebuy admin make sure no widget/rule can recommend or upsell this product (exclude it by title/tag or restrict widgets to collections).
   - Verify: store search for "Custom Photo Prints" returns nothing; the product is in no collection; `/products/<handle>` is the only way to find it (the cart link doesn't need the page).
6. **Shipping & handling = $6 flat, US only, as a shipping-profile rate** — follow `docs/print-orders-launch.md` section 3.2 steps 1–8 exactly (custom profile `Photo prints`, one US zone, one `Shipping & handling` rate of $6.00, no conditions). A cart now holds **many units of one variant**, so also confirm the rate is flat, not per-item or weight-based.
7. **Free-shipping rules and Rebuy must not waive S&H:** no store-wide *Free shipping* discount (automatic or code), and no Rebuy rule that applies one (launch doc 3.2 steps 5–6). Test: at checkout with a 5+ print cart the line must read `Shipping & handling $6.00`; add a $75+ item in a second cart and re-check.

**Vercel (Production)**
- [ ] `NEXT_PUBLIC_SHOPIFY_VARIANT_PRINT` = `48078680424673`. Set in Production and Preview. The old `NEXT_PUBLIC_SHOPIFY_VARIANT_STANDARD` and `NEXT_PUBLIC_SHOPIFY_VARIANT_LUXURY` variables are no longer read by any code and can be deleted from Vercel. **It is a `NEXT_PUBLIC_` variable, so redeploy after setting it.**
- [ ] `SHOPIFY_WEBHOOK_SECRET` = the signing secret Shopify shows when you create the webhook (below). Redeploy.
- [ ] Already set: `PRINT_PREVIEW_SECRET`, `PRINT_REPLY_TO`, `NEXT_PUBLIC_APP_URL`, Dropbox vars, `CRON_SECRET`. **Not set: `PRINT_ORDERS_ENABLED`, `PRINT_DESTINATION`.**

**Webhook**
- [ ] Shopify admin → Settings → Notifications → Webhooks → Create webhook: Event **Order payment** (`orders/paid`), Format JSON, URL `https://memories.lucydarling.com/api/webhooks/shopify/orders-paid`. Copy the signing secret into `SHOPIFY_WEBHOOK_SECRET` (above) and redeploy. Non-print orders are ignored (200, nothing recorded).

## 2. Justin's rehearsal

1. Justin opens the **preview link** you give him (`https://memories.lucydarling.com/review?print_preview=<PRINT_PREVIEW_SECRET>`) in the browser he'll use. It sets a 30-day cookie; only that browser sees print ordering.
2. He starts a book with an **@lucydarling.com email** (so test-mode emails reach him) and saves at least **5 photos** (extras count too). Use real-size photos.
3. On the review page: **Print my photos** → the confirm step must read *"You're printing N new photos… 0 of 49 printed so far."* with the price lines (N × $20.00, S&H $6.00, total). → *Continue to checkout* → he pays with his own card.
4. Checkout must show exactly the confirm step's quantity and `Shipping & handling $6.00`. His cart should contain only the print product (the link empties the cart first).
5. **Round 2:** he adds more photos (and, if he likes, an extra) and orders again → the confirm step counts only photos added since round 1, and *"X of 49 printed so far"* includes round 1. Printed photos are labelled **Printed** and can't be changed.
6. **Reprint:** on a printed photo he taps **Replace photo**, crops a new one, and the card says *replacement added to your next order*. Round 3 includes it (confirm step: "…and 1 reprint").
7. **Under-minimum / nothing-new:** with fewer than 5 new prints, or nothing new, the button explains why and nothing is charged.

## 3. What Kevin/Claude do after each order

Find the numeric order id (Shopify admin → the order → the number at the end of the URL, not the `#1001` name). Then, with Claude Code in the repo:

```bash
cd "Photo App/lucy-prints"
npm run print-order:deliver -- <numeric-shopify-order-id>
```

It rebuilds from the frozen snapshot, uploads to `staging/`, moves the finished folder to `demo/TEST-<id>/`, and marks the order `sent`. A webhook that reported anything but `ready` (see `print_orders.status` / the alert email) is not deliverable — `held` and `refused` need a person.

**Check in the order folder (`demo/TEST-<id>/`):**
- The `.xml` and one JPEG per print; the number of `<item>` quantities adds up to the **prints Justin paid for** (also `print_orders.print_count` and `paid_quantity`, which must be equal).
- Ship-to in the XML matches his address.
- Round 2 contains **only** the photos added since round 1 (no repeats); a reprint round contains the new crop (same slot name) and not the old one.
- Product codes are demo dealer 3404's (since 2026-10-22): 3x3 → 7364, 4x4 and every size on the 4x4 sheet (4x3, 3.5x3.5) → 7963, 4x6/6x4 → 7965, 5x5 → 7969. A `TBD-…` code in a `TEST-` order means something is wrong.
- No `WARNING:` lines about off-size images (or understand them).
- In the database: `print_order_items` has one row per printed slot/extra (reprints at `generation` 2) and `print_rounds.status = 'paid'`.

## 4. Refunds

Test orders are never printed, so refund each one **in full**: Shopify admin → the order → *Refund* → select the print line **and the shipping** → *Refund*. Do not restock. This returns the card charge; it does not change the app.

A refund does **not** unlock a printed photo (the app records printing, not payment). To reuse Justin's book for another rehearsal, ask Claude to clear that test order's rows (`print_order_items` for that order, set the order aside) — or have him start a new book. Never touch a real customer's order this way.

## 5. If something looks wrong
- Order stuck `held`: read `print_orders.reasons` and the alert email. Typical causes: a photo was removed after he clicked *Continue to checkout*, or the paid quantity didn't match the round. Nothing is locked. Fix, then `npm run print-order:retry -- <numeric order id>`.
- `refused`: a round that included something already printed, a missing round id, or a non-printable book. Handled by hand.
- Roll back: unregister the webhook (or unset the preview cookie) — customers never see print ordering without `PRINT_ORDERS_ENABLED=true`.
