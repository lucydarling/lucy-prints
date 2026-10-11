# Print orders — launch readiness

Status: **test mode; manual delivery to a DEMO Dropbox hotfolder only.** Written 2026-10-09, step 3 added 2026-10-10, branch `print-orders-step1`.
Nothing is sent to Photo Finale or Persnickety. `live/` is never written (`LIVE_DELIVERY_ALLOWED = false`).

## 1. What exists
- Shopify `orders/paid` webhook → `POST /api/webhooks/shopify/orders-paid` (Node runtime, HMAC-verified).
- For a print order it freezes the photos at payment, checks them, and records `ready` / `held` / `refused` in `print_orders`. Refused and held outcomes email Kevin.
- Sessions lock after a `ready`, `refused`, `sent` or `error` order (409 on upload, delete, notes); a `held` session stays editable. A webhook or retry never re-checks or overwrites a `sent`/`error` order.
- Order folder builder (Photo Finale `apm_order` XML + JPEGs), `TEST-` ids, local-folder/ZIP output only, buildable from the frozen snapshot (`print-order:build`).
- Builder refuses any file whose shape (after padding) is not its product's `aspect` (pfRouter would silently center-crop it). `aspect` is derived from the print method in `config.ts`.
- **Delivery (manual):** `npm run print-order:deliver -- <order id>` uploads to Dropbox and marks the order `sent` (section 5).
- **`_error` check:** `GET /api/cron/print-order-errors` (Vercel Cron, daily at 15:00 UTC, `CRON_SECRET`-gated) and `npm run print-order:check-errors`. Each sent order found in `<hotfolder>/_error/` becomes `error` with pfRouter's `reason.txt`, and Kevin gets one alert.
- **Step 4 (customer-facing, hidden):** the "Print my photos" button on `/review`, a server-side checkout route, customer emails, and "Ordered" labels. All of it is invisible until print ordering is turned on (section 8).
- **Not built:** automatic delivery from the webhook; the **prepaid-prints discount-code flow** (skipped on purpose, section 9); the **shipped** email is built but wired to nothing.

## 2. Environment variables (Vercel, Production)
Already set (see `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SHOPIFY_DOMAIN`, `NEXT_PUBLIC_SHOPIFY_VARIANT_STANDARD`, `NEXT_PUBLIC_SHOPIFY_VARIANT_LUXURY`, `KV_REST_API_URL` / `KV_REST_API_TOKEN` (rate limiting).

New for print orders:

| Variable | Needed for | Required? |
|---|---|---|
| `SHOPIFY_WEBHOOK_SECRET` | Verifying the webhook signature. Without it every webhook is refused (500). | **Yes** |
| `PRINT_ORDER_ALERT_TO` | Who gets held/refused alerts. Defaults to kevin@lucydarling.com. | No |
| `SHOPIFY_EXTRA_PRINT_VARIANT_IDS` | Comma-separated variant ids of a paid "extra print" product, if extras ever become paid. Leave unset while extras are free (cap 12). | No |
| `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`, `DROPBOX_ROOT_PATH` | Dropbox delivery (local `.env.local`) and the `_error` cron (Vercel). The refresh token comes from `npm run dropbox:connect`. | For delivery / cron |
| `CRON_SECRET` | Gates `/api/cron/print-order-errors`; Vercel Cron sends it as a bearer token. Without it the route answers 500. | For the cron |
| `PRINT_DESTINATION` | `demo` (default) or `live`. `live` also needs `TEST_MODE` off, and is blocked anyway while `LIVE_DELIVERY_ALLOWED` is false. **Do not set it.** | No |
| `PRINT_ORDERS_ENABLED` | `true` shows the button to everyone and opens the checkout route. **Unset/anything else = off** (the launch switch). | No (default off) |
| `PRINT_PREVIEW_SECRET` | 16+ characters. `/review?print_preview=<secret>` sets an httpOnly cookie in that browser; that cookie opens print ordering for that browser even with the flag off. | For the private preview |
| `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_ADMIN_DOMAIN` | Manual retry only (`print-order:retry`): Admin API token with `read_orders`, and the `*.myshopify.com` host. Not needed by the webhook. | Retry only |

Database: 008 (`print_orders`) applied 2026-10-09; 009 (`updated_at` trigger) applied; 010 (`sent`/`error` statuses, `sent_at`, `destination`, `error_reason`, `error_at`) applied and verified 2026-10-10. **011** (`customer_email`, `received_email_sent_at`, `held_email_sent_at`, `shipped_email_sent_at`) is written in `supabase/migrations/011_print_orders_customer_email.sql`; it must be applied **before** the step-4 code is deployed, because the webhook's upsert writes `customer_email`.

## 3. Shopify setup
1. **Product** "Custom Photo Prints for Memory Book" (currently **Draft**, both variants $0.00; Standard `48078680424673`, Luxury `48078680457441`): set the Standard and Luxury prices and set it to Active. Price is flat per book; `photo_count` never affects price.
2. **Shipping & handling = $6 flat, US only, as a shipping-profile rate (not a line item).** Exact steps (done by Kevin in Shopify admin; the store's current settings were not visible when this was written, so verify each screen):
   1. Settings → **Shipping and delivery** → under *Shipping*, **Create custom shipping profile** (name: `Photo prints`).
   2. **Add products** → pick **Custom Photo Prints for Memory Book** (both variants). A product belongs to exactly one profile, so this moves it out of *General*.
   3. Set the ship-from location to the same one the other products use (iDrive Fulfillment, Salt Lake City).
   4. **Create shipping zone** → name `United States`, country **United States** only → **Add rate** → *Set up your own rate*: name `Shipping & handling`, price **$6.00**. Do **not** add conditions (no "free over $75", no weight/price tiers). Save the zone, then **Save** the profile.
   5. **Keep the $75 free-shipping rule from waiving it.** The $75 rule must not be a store-wide *Free shipping* discount. Check Discounts in admin: any **Free shipping** discount (automatic or code) applies to *every* shipping line in a cart, including this one. If one exists, delete it or move the free-over-$75 behaviour into the *General* profile as a conditional rate ("Free, order $75+") so it only applies to those products.
   6. **Rebuy:** open Rebuy admin and check each of Cart / Smart Cart (free-shipping progress bar, **Discounts**) and any *Automations* that create or apply a discount. A progress bar alone is display-only and can't waive anything, but a Rebuy rule that applies a Shopify free-shipping discount can. Turn off any Rebuy rule that applies shipping discounts, or exclude the print product from it. (Rebuy's own screens were not inspected; trust the test in step 7.)
   7. **Test (pass/fail):** with the product Active, open the checkout URL from the internal preview with the cart containing only the print product, and read the shipping line at checkout: it must say `Shipping & handling $6.00`. Then add a $75+ item in a second cart and check the print line still shows $6.00 (the cart-clear step means customers normally have prints only). Anything other than $6.00 means a free-shipping discount or Rebuy rule is still waiving it.
   8. A non-US address must show *no shipping options* (prints are US-only to start). Photo Finale shipping countries are still open (section 7).
   Placeholders: prints $20, S&H $6 in `config.ts`/the plan. Kevin sets the real prices and the Active status.
3. **Checkout link:** built. `POST /api/sessions/[token]/print-checkout` counts the saved book from the database, runs `validatePrintRequest()`, and returns the `printingMessage()` line plus a URL that clears the cart (`/cart/clear?return_to=…`) and then adds the variant with `session_token`, `book_theme` and `photo_count` as cart attributes. The button shows the line with a confirm step, then redirects. The webhook refuses a paid order without those attributes.
4. **Webhook:** Shopify admin → Settings → Notifications → Webhooks → Create webhook:
   - Event: **Order payment** (`orders/paid`), Format: JSON
   - URL: `https://memories.lucydarling.com/api/webhooks/shopify/orders-paid`
   - Copy the **signing secret** shown on that page into `SHOPIFY_WEBHOOK_SECRET`, then redeploy.
   - Every paid order in the store hits it; non-print orders are ignored (200, not recorded).
5. **Test:** place a real order for the product with a test session; confirm a `print_orders` row appears (`ready`, id `TEST-<order id>`). Then test a session with zero photos to see the held alert.

## 4. Statuses
- `ready`: paid, photos frozen (rows in `snapshot`, files copied to `photos/print-orders/<order id>/…`), built and validated (sizes, shapes, images, XML rules, extras within the cap of 12). **Not delivered.**
- `sent`: `print-order:deliver` put the order folder in the hotfolder (`sent_at`, `destination` = demo/live).
- `error`: pfRouter moved a sent order to `_error` (`error_reason` = its `reason.txt`, `error_at`). Nothing retries it.
- `held` / `refused`: as before.

`external_id` carries the `TEST-` prefix while `TEST_MODE` is on (`src/lib/print-orders/config.ts`); test mode only ever delivers to the demo hotfolder.

## 5. Retry and manual send
**Retry the check** — `npm run print-order:retry -- <numeric Shopify order id>` (needs the Admin env vars). A `held` order always re-freezes on retry, so let the customer add photos first. `--refreeze` forces a fresh snapshot of a refused order. A `ready` order is never re-frozen.

**Deliver** — `npm run print-order:deliver -- <numeric Shopify order id>`:
- Rebuilds from the snapshot exactly as `print-order:build` does (same checks), then writes to Dropbox under `DROPBOX_ROOT_PATH`:
  - `staging/<id>-run-<n>/`: every image, then the XML; checked (names + sizes) before anything reaches the hotfolder.
  - one server-side move to `demo/<id>/` (the demo dealer's hotfolder). The move never overwrites.
  - only then `print_orders` → `sent`.
- Refuses unless the order is `ready`. Refuses if `demo/<id>` or `demo/_error/<id>` already exists.
- A failure before the move leaves the order `ready` and the hotfolder untouched; just run it again (it clears that order's old staging folders first).
- If it prints "delivered … do not re-run", the folder is in the hotfolder but the database update failed: set the row to `sent` by hand.
- `--force` on a `sent` order prints a warning and then refuses: *resend disabled until Photo Finale confirms how a repeated external_id is handled*. The resend path (folder `<id>-resend-<timestamp>`, same external_id) is built; switch it on with `RESEND_ENABLED` in `config.ts`.
- The Dropbox app has full-account access, so the client refuses any path outside `DROPBOX_ROOT_PATH`, and writes only into `staging/` and the destination's hotfolder.

**Local build for inspection** — for an order whose `print_orders.status` is `ready`:
1. `npm run print-order:build -- <numeric Shopify order id>` (add `--out DIR` to choose where; default `print-orders-out/`).
   - It reads **only** `print_orders.snapshot` and the frozen copies under `photos/print-orders/<order id>/`. It never reads live session rows, and refuses to read any file outside that folder.
   - It refuses unless the order is `ready`, and refuses if the rebuilt id or print count differs from what was recorded.
   - It uses the same code as the webhook (`buildFromSnapshot`), so the XML and validation are identical. The ship-to and customer name come from the Shopify order, saved in the snapshot at payment.
   - Output: `print-orders-out/TEST-<order id>/` (images, then the XML) and `TEST-<order id>.zip`. Read any `WARNING:` lines (images off-size or scaled down).
2. Open the XML and spot-check: ship-to address, item count = `print_count` in `print_orders`, product codes (still `TBD-…` placeholders until Photo Finale answers — replace them only once confirmed).
3. Never hand-copy a folder into a hotfolder; use `print-order:deliver` so the order is recorded as sent. Do not create `.pfrouter-partner.json`.

`npm run print-order:sample -- <session token>` is **testing only**: it reads the customer's LIVE session and uses placeholder ship-to details. Never use it for a real order.

**Never delete** `print-orders/<order id>/` files or `print_orders` rows by hand. Delivery deletes only its own staging copies in Dropbox.

## 6. Behaviour to know about
- Payment = finished: whatever is filled prints. Only an order with zero photos is held.
- Extras: free, max 12 per print order (enforced by `validatePrintRequest`; the extras UI is not capped).
- Journal and Little Years books are refused for printing for now.
- A customer can always start a new book after a ready/refused one (same email + theme creates a new session).
- Legacy rows saved at 4x4 for a 3x3 slot (118 `baby_bump`, 5 `my_first_10/11`) are scaled down to the slot size.

## 7. Photo Finale / Persnickety: answered and still open
**Answered (2026-10-09):**
- `quantity` = copies of that one image (we use one order item per image).
- One product code per size covers both orientations (6x4 uses the 4x6 code).
- Any resolution is accepted. We still refuse files under 50% of the print size, only to catch broken/placeholder files.
- **If a file's shape doesn't match its product, pfRouter silently center-crops it.** So every product has an `aspect` in `config.ts` and the builder refuses an order whose file (after padding) isn't that shape (0.5% tolerance).
- Testing goes to a separate **demo dealer account**: `resolveDestination()` in `config.ts` (demo by default; live only with `PRINT_DESTINATION=live` and `TEST_MODE` off).
- pfRouter watches a shared cloud folder at Persnickety; we see its `_error` folder through the same share. Chosen provider: **Dropbox** (dedicated account, scoped Full-Dropbox app).

**Still open:**
1. The real product codes for every size (3x3, 4x4, 4x6, 5x5), and the demo dealer details (Jason).
2. Do they print 3x3, 3.5x3.5 and 4x3 natively, or should those stay on a 4x4 sheet? (Flipping one to native in `config.ts` changes its `aspect` automatically.)
3. Padding placement on 4x4 sheets: image bottom-left, padding top/right, no trim guides. OK for their trimming?
4. Is the dealer chosen by which hotfolder an order lands in (`demo/` vs `live/`)? Is `_error` inside each hotfolder? What happens to a processed order folder?
5. How is a repeated `external_id` treated? (Gates `RESEND_ENABLED`.)
6. Shipping speeds: the `delivery_type` values our dealer has active (Chari's team). Tracking (Jason, next week).

## 8. Customer-facing pieces (step 4) and how to turn them on
Everything below is invisible to customers until the switch is flipped. With it off, `/review` still shows the old "Direct print ordering coming soon" note, `print-status`, `siblings` and the my-books email return exactly what they did before, and `POST …/print-checkout` answers 404.

**Who sees it:** (a) everyone, when `PRINT_ORDERS_ENABLED=true`; (b) only a browser that opened `https://memories.lucydarling.com/review?print_preview=<PRINT_PREVIEW_SECRET>` (httpOnly cookie, 30 days; a wrong secret just lands on a clean `/review`). Session emails are never used as a key: they aren't verified.

**The button** is on `/review`. It is blocked, with the reason shown and no redirect, when the book isn't saved, photos are still uploading or failed, there is nothing saved to print, extras are over 12, the book can't be printed through the Photo Lab, or the book already has / is waiting on a print order. Otherwise it shows "You're printing X of Y photos…" with a confirm, then goes to Shopify.

**Customer emails** (Resend, `prints@lucydarling.com`; `npm run print-order:email-test` sends samples to Kevin):
- **Order received** — when the webhook records a `ready` order (counts, ship-to, "we prepare your prints and mail them"). Sent once per order (`received_email_sent_at`).
- **We need photos (held)** — zero saved photos; links back to the book. Once per order (`held_email_sent_at`).
- **Refused — NO customer email.** Kevin gets the alert and handles it by hand.
- **Shipped** — template and `sendPrintOrderShipped()` exist but nothing calls them. Wire it when Photo Finale sends tracking details (`shipped_email_sent_at` is reserved).
- While `TEST_MODE` is on, customer emails are sent only to `@lucydarling.com` addresses; others are skipped and logged. If migration 011 isn't applied, no customer email is sent (the check fails closed).

**"Ordered" labels** — a book with a `ready`, `sent`, `refused` or `error` order is labelled "Ordered" in the book switcher and the my-books email (button reads "View This Book"). A `held` order isn't labelled (the customer can still edit). Labels follow the same switch as the button.

**Before going live** (not done): apply 011 → deploy → set the real prices and Active status → do the S&H steps in section 3 → register the webhook (section 3.4) → set `PRINT_ORDERS_ENABLED=true`. Delivery to the printer stays manual (`print-order:deliver`) and `LIVE_DELIVERY_ALLOWED` stays false.

## 9. Prepaid prints as discount codes — NOT built (future, needs a product decision)
No "prepaid prints" product exists in Shopify (checked 2026-10-11: only "Custom Photo Prints for Memory Book", Draft). Until one does, there is nothing to detect, so no code, table or Admin API scope was added, and `SHOPIFY_ADMIN_*` is not in Vercel production. Design agreed for when it is built:
- Detect a prepaid purchase on `orders/paid` (a separate line item/variant).
- Issue a one-time Shopify discount code (Admin GraphQL `discountCodeBasicCreate`): **100% off the print product for the matching tier only** (a Standard prepay can't be used on a Luxury book), shipping excluded (S&H is still charged), `usageLimit` 1, 5-year `endsAt`, non-refundable. 100% of the product rather than a fixed amount, so the credit survives a price change.
- Store it in a `print_credits` table (code, discount id, source order, email, tier, status, expires_at, used_order); apply with `?discount=CODE` on the checkout URL when the buyer's email has an unused credit; mark it used when a later order's `discount_codes` contains it.
- Needs `write_discounts` + `read_discounts` on the Admin API app and the token in Vercel production.
