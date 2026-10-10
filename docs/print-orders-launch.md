# Print orders — launch readiness

Status: **test mode, delivery is a stub.** Written 2026-10-09 on branch `print-orders-step1`.
Nothing is sent to Photo Finale. Delivery is blocked on the open questions at the bottom.

## 1. What exists
- Shopify `orders/paid` webhook → `POST /api/webhooks/shopify/orders-paid` (Node runtime, HMAC-verified).
- For a print order it freezes the photos at payment, checks them, and records `ready` / `held` / `refused` in `print_orders`. Refused and held outcomes email Kevin.
- Sessions lock after a `ready` or `refused` order (409 on upload, delete, notes); a `held` session stays editable.
- Order folder builder (Photo Finale `apm_order` XML + JPEGs), `TEST-` ids, local-folder/ZIP output only.
- **Not built:** the checkout button on the site, the per-order delivery to Photo Finale, the prepaid-discount-code flow, "Ordered" labels in the book switcher / "my books" email.

## 2. Environment variables (Vercel, Production)
Already set (see `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SHOPIFY_DOMAIN`, `NEXT_PUBLIC_SHOPIFY_VARIANT_STANDARD`, `NEXT_PUBLIC_SHOPIFY_VARIANT_LUXURY`, `KV_REST_API_URL` / `KV_REST_API_TOKEN` (rate limiting).

New for print orders:

| Variable | Needed for | Required? |
|---|---|---|
| `SHOPIFY_WEBHOOK_SECRET` | Verifying the webhook signature. Without it every webhook is refused (500). | **Yes** |
| `PRINT_ORDER_ALERT_TO` | Who gets held/refused alerts. Defaults to kevin@lucydarling.com. | No |
| `SHOPIFY_EXTRA_PRINT_VARIANT_IDS` | Comma-separated variant ids of a paid "extra print" product, if extras ever become paid. Leave unset while extras are free (cap 12). | No |
| `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_ADMIN_DOMAIN` | Manual retry only (`print-order:retry`): Admin API token with `read_orders`, and the `*.myshopify.com` host. Not needed by the webhook. | Retry only |

Database: migrations 008 (`print_orders`) applied 2026-10-09. 009 (`updated_at` trigger) is pending approval.

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

## 4. What "ready" means while delivery is a stub
`status = ready` in `print_orders` means: the order was paid, the photos were frozen (rows in `snapshot`, files copied to `photos/print-orders/<order id>/…`), and the order built and validated (sizes, images, XML rules, extras within the cap of 12). **Nothing was delivered anywhere.** `external_id` carries the `TEST-` prefix. `CloudFolderDestination` deliberately throws. Test mode is `TEST_MODE` in `src/lib/print-orders/config.ts`; leave it on until delivery is built and Photo Finale confirms.

## 5. Retry and manual send
- **Retry the check:** `npm run print-order:retry -- <numeric Shopify order id>` (needs the Admin env vars). A `held` order always re-freezes on retry, so first let the customer add photos. `--refreeze` forces a fresh snapshot of a refused order. A `ready` order is never re-frozen.
- **Build a folder by hand:** `npm run print-order:sample -- <session token>` writes `print-orders-out/<id>/` and a ZIP locally (placeholder ship-to, `TEST-` id). **Gap:** this reads the live session, not the frozen snapshot — for a real order, build from `print_orders.snapshot` (to be added with delivery).
- **Never delete** `print-orders/<order id>/` files or `print_orders` rows by hand.

## 6. Behaviour to know about
- Payment = finished: whatever is filled prints. Only an order with zero photos is held.
- Extras: free, max 12 per print order (enforced by `validatePrintRequest`; the extras UI is not capped).
- Journal and Little Years books are refused for printing for now.
- A customer can always start a new book after a ready/refused one (same email + theme creates a new session).
- Legacy rows saved at 4x4 for a 3x3 slot (118 `baby_bump`, 5 `my_first_10/11`) are scaled down to the slot size.

## 7. Open questions for Photo Finale / Persnickety
1. Product codes for every size (3x3, 4x4, 4x6, 5x5). Is one code per size right regardless of orientation (6x4 landscape uses the 4x6 code)?
2. Do they print 3x3 and 3.5x3.5 and 4x3 natively, or should those stay on a 4x4 sheet?
3. Padding placement on 4x4 sheets: image bottom-left, padding top/right, no trim guides. OK for their trimming?
4. How `quantity` works on a single-image order item (N copies of that image?).
5. Delivery method into pfRouter (cloud folder? which one, credentials, folder naming) and the exact `delivery_type` values our dealer account has active.
6. Files at exactly print size, or is a larger file scaled by them?
7. What happens to a half-written folder (we write images first, XML last)?
