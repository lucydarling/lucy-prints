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
- **Not built:** the checkout button on the site, automatic delivery from the webhook, the prepaid-discount-code flow, "Ordered" labels in the book switcher / "my books" email.

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
| `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_ADMIN_DOMAIN` | Manual retry only (`print-order:retry`): Admin API token with `read_orders`, and the `*.myshopify.com` host. Not needed by the webhook. | Retry only |

Database: 008 (`print_orders`) applied 2026-10-09; 009 (`updated_at` trigger) applied; 010 (`sent`/`error` statuses, `sent_at`, `destination`, `error_reason`, `error_at`) applied and verified 2026-10-10.

## 3. Shopify setup
1. **Product** "Custom Photo Prints for Memory Book" (currently **Draft**, both variants $0.00; Standard `48078680424673`, Luxury `48078680457441`): set the Standard and Luxury prices and set it to Active. Price is flat per book; `photo_count` never affects price.
2. **Shipping & handling:** make sure the cart charges shipping for this product (placeholder in plan: $6).
3. **Checkout link:** the button (not yet wired) must open `buildCheckoutUrl` (`src/lib/shopify.ts`) so the cart carries `session_token` and `book_theme`. The webhook refuses a paid order without them. It should show `printingMessage()` ("You're printing X of Y photos") and run `validatePrintRequest()` first.
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
