# Print orders: retention proposal (NOT IMPLEMENTED, decision needed)

Written 2026-10-11. Nothing here deletes anything; no cleanup code exists. This follows the standing rule: **retention is gated on use signals, never on age alone**, and customer photos are never deleted to save space.

## What is kept, and how big it is
| Where | What | Why it exists |
|---|---|---|
| Supabase `photos/print-orders/<order id>/` | Frozen copy of every image in the order, taken at payment | The printed order is rebuilt from this, never from the live book (a later edit can't change what was printed) |
| `print_orders.snapshot` + `print_order_items` | Order record, ship-to, what was printed | Reprint locks, support, `printed_count` |
| Dropbox `demo/<order id>/` (later `live/`) | The folder pfRouter picks up; pfRouter moves a rejected one to `_error/` | Delivery |
| Dropbox `staging/<order id>-run-<n>/` | Our own pre-delivery copy | Deleted by the deliver script itself after the move |

Size (measured 2026-10-11, read-only): the `photos` bucket holds 5,159 files, 1,970 MB, average **391 KB per image**; there are no print orders yet. So an order of 20 prints is roughly **8 MB frozen in Supabase and 8 MB in Dropbox**. 1,000 such orders is about 8 GB in each place. Storage is not a pressure point; this is a "tidy up and limit exposure" question, not a "free space" one.

## Proposal
**Rule: a frozen copy or delivered folder is eligible for cleanup only when ALL of these are true:**
1. The order is `sent` and pfRouter has had a full cycle with no `_error` folder for it (the `_error` cron runs every 15 minutes), AND the printer has confirmed the print went out (today that confirmation is manual; tracking is still open with Jason). Until a shipped/tracking signal exists, nothing is eligible.
2. A grace window has passed since that signal: **proposed 12 months**. This covers reprints, "it arrived damaged" and chargeback windows. The window is a number in one config constant.
3. The customer's book still exists independently (the live session photos are untouched, so the customer loses nothing; only our frozen duplicate goes).
4. No open support issue on the order (`held`/`error` orders are never eligible).

**Never eligible, whatever the age:** the order record, `print_order_items` rows (the per-photo lock depends on them), and the live session photos in `photos/<session>/`.

**How cleanup would run (if you approve it):**
- A script, not a cron, run by hand at first: `print-order:retention-report` lists eligible folders, their sizes and why (dry run, read-only). Deleting is a **separate second command** that needs the explicit order ids, prints what it will remove, and asks for confirmation. No automatic deletion.
- Dropbox `demo/` folders (test orders) can follow a shorter, separate rule once Photo Finale confirms what happens to a processed folder (open question 4 in the launch doc).
- Customer notice: before the first real cleanup, add one line to the order-received email and the FAQ ("we keep a copy of what we printed for 12 months").

## Decisions for you
1. Grace window: 12 months, or longer/shorter?
2. Is "printer confirmed shipped" (needs tracking from Photo Finale) the right gate, or is `sent` plus the window enough?
3. Build the report-only script now, or wait until there are real orders?
4. Do you want the customer-notice line added before launch regardless of cleanup?
