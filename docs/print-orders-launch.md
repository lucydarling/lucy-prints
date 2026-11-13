# Print orders — launch readiness

Status: **test mode; manual delivery to a DEMO Dropbox hotfolder only.** Written 2026-10-09, step 3 added 2026-10-10, **rewritten for print-in-rounds 2026-10-11 (step 5)**. For the live rehearsal see `docs/print-orders-rehearsal.md`.
Nothing is sent to Photo Finale or Persnickety. `live/` is written only when `PRINT_LAB_ENV=live` (step 9, 2026-11-13; not set). Switching labs: `docs/print-orders-live-switch.md`.

## 1. What exists
- Shopify `orders/paid` webhook → `POST /api/webhooks/shopify/orders-paid` (Node runtime, HMAC-verified).
- For a print order it freezes the photos at payment, checks them, and records `ready` / `held` / `refused` in `print_orders`. Refused and held outcomes email Kevin.
- **Printing is in rounds (step 5).** Each order prints a *round* recorded when the customer clicks "Print my photos" (`print_rounds`): the book photos, extras and paid reprints not yet printed. The session never locks as a whole; a slot or extra locks only once an order containing it is `ready` (a `print_order_items` row; a unique key prevents printing anything twice). Upload/recrop/delete on a printed slot or extra answer 409; a printed slot can be replaced as a paid reprint (`print_reprints`, included in the next order, original never overwritten). Notes and baby details are always editable. A webhook or retry never re-checks or overwrites a `sent`/`error` order.
- **Pricing is per print** plus S&H per order, both **read from Shopify at click time** (since 2026-11-13: the "Photo print" variant's price via `/variants/<id>.js` and the shipping profile's quote for that exact cart via a throwaway storefront cart, `src/lib/print-orders/shopify-price.ts`). There are no price constants in code, so the confirm step always matches checkout (before tax). If Shopify can't answer, the button says "not available right now" and no round is recorded. Check what it shows now: `npm run print-order:price-check -- 8`; the cart is one line per print variant with quantity = prints; the webhook requires the paid quantity per variant to equal the round, else it **holds** the order (alert, nothing locked). `MIN_PRINTS_PER_ORDER` (8, Persnickety's minimum, Chari 2026-10-30) is enforced at the button and the webhook; extras have no customer-facing cap, only a hidden limit of 100 per order.
- Order folder builder (Photo Finale `apm_order` XML + JPEGs), `TEST-` ids, local-folder/ZIP output only, buildable from the frozen snapshot (`print-order:build`).
- Builder refuses any file whose shape (after padding) is not its product's `aspect` (pfRouter would silently center-crop it). `aspect` is derived from the print method in `config.ts`.
- **Delivery (manual):** `npm run print-order:deliver -- <order id>` uploads to Dropbox and marks the order `sent` (section 5).
- **`_error` check:** `GET /api/cron/print-order-errors` (Vercel Cron, every 15 minutes (`*/15 * * * *`, needs the Pro plan), `CRON_SECRET`-gated) and `npm run print-order:check-errors`. Each sent order found in `<hotfolder>/_error/` becomes `error` with pfRouter's `reason.txt`, and Kevin gets one alert. A folder in `_error/` that matches **no** `print_orders` row at all (any status; e.g. a folder dropped in by hand) gets one "[Photo Lab] Unknown order in _error: <folder>" alert instead, once per folder ever (recorded in `print_error_unknown_folders`, migration 016, step 7, 2026-11-12). Folders of orders already marked `error` stay quiet. If 016 is missing, that part fails, is logged and the cron answers 500; the sent-order part still runs.
- **Not-picked-up check (2026-10-27):** the same cron then looks for `sent` orders whose `sent_at` is older than `STALLED_AFTER_MINUTES` (30, `config.ts`) and whose folder is still at `<hotfolder>/<external_id>` (not moved to `processed/<dest>/` or `_error/`). Kevin gets one alert per order (guarded update of `print_orders.stalled_alerted_at`, migration 015); the alert says whether `.pfrouter-partner.json` exists in the folder (missing = pfRouter never saw it: not running or not syncing). Two or more stalled in one run send a single combined "pfRouter may be down" alert. Only orders sent in the last `STALLED_LOOKBACK_HOURS` (72) are checked. Read-only toward Dropbox. Manual run: `npm run print-order:check-stalled`. **Apply 015 before deploying**; if the column is missing the stalled check fails (logged, cron answers 500) but the `_error` check still runs.
- **Step 4 (customer-facing, hidden):** the "Print my photos" button on `/review`, a server-side checkout route, customer emails, and "Ordered" labels. All of it is invisible until print ordering is turned on (section 8).
- **Not built:** automatic delivery from the webhook; the **prepaid-prints discount-code flow** (skipped on purpose, section 9); the **shipped** email is built but wired to nothing.

## 2. Environment variables (Vercel, Production)
Already set (see `.env.local`; the three `NEXT_PUBLIC_SHOPIFY_*` ones were missing from Vercel until 2026-10-11, now in Production and Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SHOPIFY_DOMAIN`, `NEXT_PUBLIC_SHOPIFY_VARIANT_PRINT` (`48078680424673`, the one "Photo print" variant), `KV_REST_API_URL` / `KV_REST_API_TOKEN` (rate limiting).

New for print orders:

| Variable | Needed for | Required? |
|---|---|---|
| `SHOPIFY_WEBHOOK_SECRET` | Verifying the webhook signature. Without it every webhook is refused (500). | **Yes** |
| `PRINT_ORDER_ALERT_TO` | Who gets held/refused alerts. Defaults to kevin@lucydarling.com. | No |
| `SHOPIFY_EXTRA_PRINT_VARIANT_IDS` | Comma-separated variant ids of a paid "extra print" product, if extras ever become paid. Leave unset while extras are free. | No |
| `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`, `DROPBOX_ROOT_PATH` | Dropbox delivery (local `.env.local`) and the `_error` cron (Vercel). The refresh token comes from `npm run dropbox:connect`. | For delivery / cron |
| `CRON_SECRET` | Gates `/api/cron/print-order-errors`; Vercel Cron sends it as a bearer token. Without it the route answers 500. | For the cron |
| `PRINT_LAB_ENV` | Which lab account orders go to: unset/`demo` = demo dealer 3404 + `demo/` tree, `live` = dealer 4013 + `live/` tree (delivery, product codes and both cron checks follow it). Replaces `PRINT_DESTINATION` (if that is set and disagrees, everything refuses). **Do not set it until Kevin says go**; see `docs/print-orders-live-switch.md`. | No |
| `PRINT_ORDERS_ENABLED` | `true` shows the button to everyone and opens the checkout route. **Unset/anything else = off** (the launch switch). | No (default off) |
| `PRINT_PREVIEW_SECRET` | 16+ characters. `/review?print_preview=<secret>` sets an httpOnly cookie in that browser; that cookie opens print ordering for that browser even with the flag off. | For the private preview |
| `PRINT_REPLY_TO` | Reply-to on every customer print email (the support inbox). The held email tells the customer to reply, so **set it before launch**; unset = no Reply-To header (replies would go to the send-only `prints@` address). | Before launch |
| `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_ADMIN_DOMAIN` | Manual retry only (`print-order:retry`): Admin API token with `read_orders`, and the `*.myshopify.com` host. Not needed by the webhook. | Retry only |

Database: **012 (print rounds: `print_rounds`, `print_order_items`, `print_reprints`, `print_orders.round_id`/`paid_quantity`) applied 2026-10-11 and verified by SQL; it must be applied before the step-5 code is deployed (the webhook's `record()` writes `round_id`).** 008 (`print_orders`) applied 2026-10-09; 009 (`updated_at` trigger) applied; 010 (`sent`/`error` statuses, `sent_at`, `destination`, `error_reason`, `error_at`) applied and verified 2026-10-10. **011** (`customer_email`, `received_email_sent_at`, `held_email_sent_at`, `shipped_email_sent_at`) is written in `supabase/migrations/011_print_orders_customer_email.sql`; it must be applied **before** the step-4 code is deployed, because the webhook's upsert writes `customer_email`.

## 3. Shopify setup
1. **Product** "Custom Photo Prints for Memory Book": **Active**, hidden from search, one variant "Photo print" (`48078680424673`) at a **$1.00 placeholder**; set the real per-print price when ready. Price is per print (variant price × cart quantity). There is no Standard/Luxury split. `config.ts` maps each print size/extras/reprints to a variant so sizes can be priced separately later.
2. **Shipping & handling = $6 flat, US only, as a shipping-profile rate (not a line item).** Exact steps (done by Kevin in Shopify admin; the store's current settings were not visible when this was written, so verify each screen):
   1. Settings → **Shipping and delivery** → under *Shipping*, **Create custom shipping profile** (name: `Photo prints`).
   2. **Add products** → pick **Custom Photo Prints for Memory Book** (its one "Photo print" variant). A product belongs to exactly one profile, so this moves it out of *General*.
   3. Set the ship-from location to the same one the other products use (iDrive Fulfillment, Salt Lake City).
   4. **Create shipping zone** → name `United States`, country **United States** only → **Add rate** → *Set up your own rate*: name `Shipping & handling`, price **$6.00**. Do **not** add conditions (no "free over $75", no weight/price tiers). Save the zone, then **Save** the profile.
   5. **Keep the $75 free-shipping rule from waiving it.** The $75 rule must not be a store-wide *Free shipping* discount. Check Discounts in admin: any **Free shipping** discount (automatic or code) applies to *every* shipping line in a cart, including this one. If one exists, delete it or move the free-over-$75 behaviour into the *General* profile as a conditional rate ("Free, order $75+") so it only applies to those products.
   6. **Rebuy:** open Rebuy admin and check each of Cart / Smart Cart (free-shipping progress bar, **Discounts**) and any *Automations* that create or apply a discount. A progress bar alone is display-only and can't waive anything, but a Rebuy rule that applies a Shopify free-shipping discount can. Turn off any Rebuy rule that applies shipping discounts, or exclude the print product from it. (Rebuy's own screens were not inspected; trust the test in step 7.)
   7. **Test (pass/fail):** with the product Active, open the checkout URL from the internal preview with the cart containing only the print product, and read the shipping line at checkout: it must say `Shipping & handling $6.00`. Then add a $75+ item in a second cart and check the print line still shows $6.00 (the cart-clear step means customers normally have prints only). Anything other than $6.00 means a free-shipping discount or Rebuy rule is still waiving it.
   8. A non-US address must show *no shipping options* (prints are US-only to start). Photo Finale shipping countries are still open (section 7).
   Kevin sets the real per-print price and the Active status in Shopify; the app reads both prices from Shopify (nothing to change in code). As of 2026-11-13 Shopify quotes the rate as **"Photo Print Shipping" $6.00** (AZ and NY) and the variant is **$1.00**.
3. **Checkout link:** built. `POST /api/sessions/[token]/print-checkout` counts the saved book from the database, runs `validatePrintRequest()`, and returns the `printingMessage()` line plus a URL that clears the cart (`/cart/clear?return_to=…`) and then adds the variant with `session_token`, `book_theme` and `photo_count` as cart attributes. The button shows the line with a confirm step, then redirects. The webhook refuses a paid order without those attributes.
4. **Webhook:** Shopify admin → Settings → Notifications → Webhooks → Create webhook:
   - Event: **Order payment** (`orders/paid`), Format: JSON
   - URL: `https://memories.lucydarling.com/api/webhooks/shopify/orders-paid`
   - Copy the **signing secret** shown on that page into `SHOPIFY_WEBHOOK_SECRET`, then redeploy.
   - Every paid order in the store hits it; non-print orders are ignored (200, not recorded).
5. **Test:** place a real order for the product with a test session; confirm a `print_orders` row appears (`ready`, id `TEST-<order id>`). Then test a session with zero photos to see the held alert.

## 4. Statuses
- `ready`: paid, photos frozen (rows in `snapshot`, files copied to `photos/print-orders/<order id>/…`), built and validated (sizes, shapes, images, XML rules, extras within the hidden limit of 100 per order). **Not delivered.**
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
- Refuses unless the order is `ready`. Refuses if `demo/<id>`, `demo/_error/<id>` or `processed/demo/<id>` (under `DROPBOX_ROOT_PATH`) already exists.
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
2. Open the XML and spot-check: ship-to address, item count = `print_count` in `print_orders`, product codes (a `TEST-` order carries demo dealer 3404's real codes, see section 13; since step 9 a live order carries `PRODUCT_CODES.live`, the same 7963/7965/7969; a `TBD-` code anywhere means something is wrong).
3. Never hand-copy a folder into a hotfolder; use `print-order:deliver` so the order is recorded as sent. Do not create `.pfrouter-partner.json`.

`npm run print-order:sample -- <session token>` is **testing only**: it reads the customer's LIVE session and uses placeholder ship-to details. Never use it for a real order.

**Never delete** `print-orders/<order id>/` files or `print_orders` rows by hand. Delivery deletes only its own staging copies in Dropbox.

## 6. Behaviour to know about
- Payment prints exactly the round recorded at the click; photos added afterwards wait for the next round. Anything that changed between click and payment (a photo or reprint removed, an extra's quantity edited, an expired round >24h, quantities that don't match) holds the order.
- Extras: charged per print like any other print; hidden sanity limit of 100 per order.
- Journal and Little Years books are refused for printing for now.
- The same book continues after an order (same email + theme reuses the session); the customer prints the next round when ready.
- Legacy rows saved at 4x4 for a 3x3 slot (118 `baby_bump`, 5 `my_first_10/11`) are scaled down to the slot size.

## 7. Photo Finale / Persnickety: answered and still open
**Answered (2026-10-09):**
- `quantity` = copies of that one image (we use one order item per image).
- One product code per size covers both orientations (6x4 uses the 4x6 code).
- Any resolution is accepted. We still refuse files under 50% of the print size, only to catch broken/placeholder files.
- **If a file's shape doesn't match its product, pfRouter silently center-crops it.** So every product has an `aspect` in `config.ts` and the builder refuses an order whose file (after padding) isn't that shape (0.5% tolerance).
- Testing goes to a separate **demo dealer account**: `resolveDestination()` in `config.ts`: one setting, `PRINT_LAB_ENV` (demo by default; `live` = dealer 4013). Since step 9 (2026-11-13) a `TEST-` order may go to live; only demo with `TEST_MODE` off is refused.
- pfRouter watches a shared cloud folder at Persnickety; we see its `_error` folder through the same share. Chosen provider: **Dropbox** (dedicated account, scoped Full-Dropbox app).

**Answered (2026-10-12, Photo Finale):**
- **pfRouter runs on OUR Windows machine.** It syncs the Dropbox `demo/` and `live/` folders and uses them as hotfolders. One `DealerCode` per pfRouter instance: demo first, then live at launch.
- **`_error`** is `<hotfolder>/_error/<order folder>/reason.txt`. This is exactly where `checkErrorFolder` reads (`<root>/<hotfolder>/_error/<folder>/reason.txt`), so the cron matches.
- **`postAction` will be "move"** to a processed folder, and **we configure that destination ourselves**: `DROPBOX_ROOT_PATH/processed/demo/` and `DROPBOX_ROOT_PATH/processed/live/` (the matching one per pfRouter instance). It sits **outside the hotfolders on purpose**, because pfRouter treats every subfolder of a hotfolder as an order. The double-send guard therefore also refuses if `<root>/processed/<demo|live>/<order folder>` exists (alongside the hotfolder and `_error` checks, and the database rule that only a `ready` order can be delivered; a moved order is no longer in `demo/`, so this closes the case where the "marked sent" update failed and someone re-runs). Our Dropbox client only ever **reads** `processed/` (it is not in the writable list; the root guard still blocks anything outside `DROPBOX_ROOT_PATH`), and the `_error` check reads only `_error/`, so moved orders don't affect it. A sent order stays `sent` until it appears in `_error`. **When setting up pfRouter on the Windows machine, create `processed/demo` and `processed/live` and point each instance's postAction move there.**
- **Repeated `external_id`s are allowed** (a new lab order is created), so the resend path (`<id>-resend-<timestamp>`) may be enabled later. **`RESEND_ENABLED` stays `false`** for now; resending prints a second set and bills a second lab order, so enable it deliberately.

**Still open:**
1. **The live dealer's (4013) product codes**: in `config.ts` since step 9 (2026-11-13) as 7963/7965/7969 per Kevin's brief; Josh still to confirm them for 4013. The demo dealer's codes were answered 2026-10-22 and are in `config.ts` (section 13). DealerCodes answered 2026-10-14.
2. ~~Native 3x3 / 3.5x3.5 / 4x3?~~ Answered 2026-10-30 (Persnickety): their machines can't run anything under ~3.5x5 on its own, and Kevin + Haily chose **no hand-cutting**. Since step 7 (2026-11-12) **3x3, 3.5x3.5, 4x3 and 3x4 all print on the 4x4 sheet with trim marks** and the customer trims them. The demo 3x3 Press Print code (7364) is no longer used.
3. ~~Padding placement on 4x4 sheets~~ Decided 2026-11-12 (Kevin + Haily, step 8, layout A): one small print per 4x4 sheet, **centered**, with traditional **corner crop marks** (see "Crop marks" in section 13). No 4x6 pairing. Step 7's bottom-left layout is replaced. Lab samples: `Photo App/Persnickety Trim-Mark Samples (2026-11-12)/`, rebuilt with `npm run print-order:trim-samples -- <photo> <dir> [--portrait <photo>]`; Kevin's reference mockups: `Photo App/Persnickety Crop-Mark Samples (2026-11-12)/`.
4. ~~Dealer / `_error` / processed folder~~ Answered 2026-10-12 (above); the `processed/` location is ours to configure (decided, see above).
5. ~~How is a repeated `external_id` treated?~~ Answered 2026-10-12 (above).
6. Shipping speeds: the `delivery_type` values our dealer has active (Chari's team). Tracking (Jason, next week).

## 8. Customer-facing pieces (step 4) and how to turn them on
Everything below is invisible to customers until the switch is flipped. With it off, `/review` still shows the old "Direct print ordering coming soon" note, `print-status`, `siblings` and the my-books email return exactly what they did before, and `POST …/print-checkout` answers 404.

**Who sees it:** (a) everyone, when `PRINT_ORDERS_ENABLED=true`; (b) only a browser that opened `https://memories.lucydarling.com/review?print_preview=<PRINT_PREVIEW_SECRET>` (httpOnly cookie, 30 days; a wrong secret just lands on a clean `/review`). Session emails are never used as a key: they aren't verified.

**The button** is on `/review`. It is blocked, with the reason shown and no redirect, when the book isn't saved, photos are still uploading or failed, there is nothing saved to print, extras are over the hidden limit of 100, the book can't be printed through the Photo Lab, or the book already has / is waiting on a print order. Otherwise it shows "You're printing X of Y photos…" with a confirm, then goes to Shopify.

**Verified 2026-10-11 (production, flag off):** `print-status`, `siblings` and `print-checkout` (404) responses and the page markup match the pre-deploy baseline; with the preview cookie the same endpoints show `printEnabled`, the "Ordered" label and a checkout URL. Following that URL with a cookie jar lands on `…/checkouts/cn/…` with an earlier 2-item cart replaced by one item and the three cart attributes present (tested with an active book variant; the print variant was still Draft then; it has been Active since 2026-10-11, one "Photo print" variant at a $1.00 placeholder).

**Customer emails** (Resend, `prints@lucydarling.com`; `npm run print-order:email-test` sends samples to Kevin):
- **Order received** — when the webhook records a `ready` order (counts, ship-to, "we prepare your prints and mail them"). Sent once per order (`received_email_sent_at`).
- **We need photos (held)** — zero saved photos; links back to the book. Once per order (`held_email_sent_at`).
- **Refused — NO customer email.** Kevin gets the alert and handles it by hand.
- **Shipped** — template and `sendPrintOrderShipped()` exist but nothing calls them. Wire it when Photo Finale sends tracking details (`shipped_email_sent_at` is reserved).
- While `TEST_MODE` is on, customer emails are sent only to `@lucydarling.com` addresses; others are skipped and logged. If migration 011 isn't applied, no customer email is sent (the check fails closed).

**"Ordered" labels** — a book with a `ready`, `sent`, `refused` or `error` order is labelled "Ordered" in the book switcher and the my-books email (button reads "View This Book"). A `held` order isn't labelled (the customer can still edit). Labels follow the same switch as the button.

**Before going live** (not done): apply 011 → deploy → set the real prices and Active status → do the S&H steps in section 3 → register the webhook (section 3.4) → set `PRINT_ORDERS_ENABLED=true`. Delivery to the printer stays manual (`print-order:deliver`) and `LIVE_DELIVERY_ALLOWED` stays false.

## 9. Prepaid prints as discount codes — NOT built (future, needs a product decision)
No "prepaid prints" product exists in Shopify (checked 2026-10-11: only "Custom Photo Prints for Memory Book", now Active). Until one does, there is nothing to detect, so no code, table or Admin API scope was added, and `SHOPIFY_ADMIN_*` is not in Vercel production. Design agreed for when it is built:
- Detect a prepaid purchase on `orders/paid` (a separate line item/variant).
- Issue a one-time Shopify discount code (Admin GraphQL `discountCodeBasicCreate`): **100% off the print product**, shipping excluded (S&H is still charged), `usageLimit` 1, 5-year `endsAt`, non-refundable. 100% of the product rather than a fixed amount, so the credit survives a price change.
- Store it in a `print_credits` table (code, discount id, source order, email, tier, status, expires_at, used_order); apply with `?discount=CODE` on the checkout URL when the buyer's email has an unused credit; mark it used when a later order's `discount_codes` contains it.
- Needs `write_discounts` + `read_discounts` on the Admin API app and the token in Vercel production.

## 10. App URL and the old hostname (2026-10-12)
`NEXT_PUBLIC_APP_URL` is `https://memories.lucydarling.com` (no trailing slash) in Production and Preview (it had been `https://lucy-prints.vercel.app`; the Development value in Vercel is still the old one and only matters for `vercel env pull`). It sets the logo and the resume links ("Continue My Photo Book", "Continue/View This Book", the held email's "Back to My Photo Book") in every email built in `src/lib/email.ts`. Checked on a real production magic-link email and a `[TEST]` held email: logo and links use `memories.lucydarling.com` and load.

**Keep `lucy-prints.vercel.app` attached to the Vercel project.** Every email sent before 2026-10-12 links to `lucy-prints.vercel.app/resume/<token>` and loads its logo from there, so removing that domain would break "continue my book" for everyone who saved a book earlier. It currently serves both (200).

## 11. Klaviyo round-reminder data (2026-10-11)
Data only. No flows or emails were built; Kevin builds them in Klaviyo from these profile properties. Code: `src/lib/print-orders/round-reminders.ts`, `round-reminder-sync.ts`, thresholds in `ROUND_REMINDER` (`config.ts`).

Properties describe the memory book **saved most recently** (Klaviyo profiles are one value per email, last write wins, same as `baby_birthdate` / `book_theme`):

| Property | Meaning |
|---|---|
| `printed_count` | Book photos printed: distinct slots with a `print_order_items` row (the same number as the per-photo lock and the "X of Y photos printed" line; orders in ready/sent/error). |
| `unprinted_count` | Prints the next order would hold from new photos: saved book photos not yet printed + extra prints not yet printed (by quantity). Pending reprints are not counted. |
| `last_print_order_at` | ISO time of the latest ready/sent/error order for the book. Not written if none. |
| `print_round_due` | `welcome_baby`: baby 3-12 months, no order yet, `unprinted_count >= 10`. `first_year`: baby 13+ months, `unprinted_count >= 10`, no order in the last 60 days. `growing_up`: child 5+ years, `unprinted_count >= MIN_PRINTS_PER_ORDER`. Otherwise `""`. Not written if the book has no birthdate. A child 5+ is checked for `growing_up` first. |

When they are written: only if print ordering is on for the caller. From request routes (a save/notes sync `PATCH /api/sessions/[token]`, reopening an existing book `POST /api/sessions`) that means `PRINT_ORDERS_ENABLED=true` or a valid preview cookie; from the `orders/paid` webhook and the daily cron `GET /api/cron/print-round-reminders` (14:00 UTC, `CRON_SECRET`-gated) it means the flag only. With the flag off the cron answers `{"skipped": ...}` and no profile changes. Journal and Little Years books never write them. Limitation: if a birthdate is later removed, `print_round_due` keeps its last value (the property is left unset rather than cleared).

## 12. Planned (NOT built): mark print lines fulfilled in Shopify
When the printer confirms shipping, mark the print order's line items **fulfilled** in Shopify with the **tracking number** and `notifyCustomer: false` (our own "shipped" email, already built but unwired, would be the customer notice). Needs:
- Tracking details from Photo Finale (carrier, tracking number, and how/when we receive them; still open).
- The **fulfillment scope** on the Shopify admin app (`write_fulfillments`, plus the order read scope already used by retry), and the admin token in Vercel production (`SHOPIFY_ADMIN_*` is currently not set there).
- The same trigger would start the 12-month retention clock (`docs/print-orders-retention.md`) and fire the "shipped" email (`shipped_email_sent_at`).
Nothing in this item is implemented.

## 13. Windows machine: pfRouter setup (2026-10-14; demo setup received 2026-10-22)
Photo Finale (Jason) sent the DealerCodes on 2026-10-14 and the demo setup on 2026-10-22. They are account IDs, not secrets.
- **Demo: DealerCode 3404, license 21277** (provisioned, ready for test orders)
- **Live: DealerCode 4013** (product codes 7963/7965/7969 in `PRODUCT_CODES.live` since step 9, pending Josh's confirmation; live license number still to come from Jason)

Both DealerCodes are set in **pfRouter's config on our Windows machine, not in the XML** (`config.ts` only uses them as a log label). One dealer per running pfRouter instance.

**How the hotfolder is configured (Photo Finale, 2026-10-22):** pfRouter's hotfolder is set **per license** in **myLab → Store Management → Kiosk → Advanced Configuration**, as `{ path, postAction: "move", moveTo }` (`postAction` can also be delete or none). `path` and `moveTo` are Windows paths with the backslashes escaped; save, then relaunch pfRouter. Ours, for the demo license 21277:
- `path` = the Dropbox-synced `demo/` folder on the Windows machine (`/LucyDarling-PrintOrders/demo/`)
- `postAction` = `"move"`
- `moveTo` = the synced `processed/demo` folder (`/LucyDarling-PrintOrders/processed/demo/`), outside the hotfolder

No logins, passwords or tokens for myLab, pfRouter or Dropbox go in this repo.

**Demo dealer 3404 product codes (Photo Finale, 2026-10-22)**, in `PRODUCT_CODES.demo` in `config.ts`. Since step 9 an order carries the codes of the lab `PRINT_LAB_ENV` points at (`PRODUCT_CODES.live` is the same 7963/7965/7969; only an unused native 3x4 is still `TBD-`). A size printed on the 4x4 sheet is ordered as a 4x4 and takes its code automatically.

| Our size | Printed as | Demo code |
|---|---|---|
| 4x4 | native (4x4 Matte) | 7963 |
| 4x6 (and 6x4) | native (4x6 Matte) | 7965 |
| 5x5 | native (5x5 Matte) | 7969 |
| 3x3 | on the 4x4 sheet with trim marks (since 2026-11-12; Persnickety can't print 3x3) | 7963 |
| 3.5x3.5 | on the 4x4 sheet with trim marks (there is no 3.5x3.5 code) | 7963 |
| 4x3 (and 3x4) | on the 4x4 sheet with trim marks | 7963 |
| 3x3 Press Print | not used since 2026-11-12 | 7364 |
| 4x3, if switched to native | 3x4 Matte | 7960 (not used) |

**Crop marks (step 8, 2026-11-12, layout A; `TRIM_MARK` in `config.ts`, drawn by `trimMarkRects` / `composeSheet` / `photoOrigin` in `image.ts`).** One small print per 1200px 4x4 sheet, photo **centered**: 3x3 900px at (150,150); 3.5x3.5 1050px at (75,75); 3x4 900x1200 at (150,0), full height; 4x3 1200x900 at (0,150), full width. A sheet photo of the right shape but another pixel size is scaled to exactly its size (the under-300-DPI warning stays in the order warnings); a wrong shape is refused. Marks: solid gray #808080, 4px, each in the 4px just outside a cut edge, never on the photo; cutting on the photo side of the marks gives the true size. For each cut edge, one mark beyond each end, in line with the edge: from 19px (1/16") past the photo's corner to 19px before the sheet edge (3x3: 112px, 3.5x3.5: 37px; 8 marks each). The 4" side of 3x4/4x3 runs to the sheet edge, so those get a 112px tick at each end of each cut edge, beside the photo, 19px in from the sheet edge (4 ticks). No full-length lines, no text. The customer ZIP's own trim guides are separate and unchanged.

Steps:
1. **Install pfRouter** (installer due from Jason this week).
2. **Configure the demo instance** (myLab → Store Management → Kiosk → Advanced Configuration, license 21277; relaunch pfRouter after saving):
   - `DealerCode` = `3404`
   - `path` = the synced Dropbox `/LucyDarling-PrintOrders/demo/`
   - `postAction` = `"move"`, `moveTo` = the synced `/LucyDarling-PrintOrders/processed/demo/`
   - Create `processed/demo` and `processed/live` first. They must sit **outside** the hotfolders (see section 7: pfRouter treats every subfolder of a hotfolder as an order).
3. **Run one `TEST-` order end to end:** `print-order:deliver` -> pfRouter picks it up -> the order appears in Photo Finale under dealer 3404 (myLab → Orders → Search) -> the order folder is moved to `processed/demo/`.

## 14. Go-live switch (rewritten 2026-11-13, step 9)
Only on Kevin's go. The full checklist (Dropbox folders, myLab Advanced Configuration for the live license, the `PRINT_LAB_ENV=live` setting, the first live TEST- order, switching back) is **`docs/print-orders-live-switch.md`**. In short: create `live/` and `processed/live/`; pfRouter `DealerCode` 3404 -> **4013** with `path` `live/` and `moveTo` `processed/live/`; then `PRINT_LAB_ENV=live` in Vercel Production (redeploy) and in `.env.local`. `LIVE_DELIVERY_ALLOWED` no longer exists: the env var is the one switch.
