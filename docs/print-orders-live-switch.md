# Switching print orders to the live lab (dealer 4013): Justin's pfRouter checklist

Written 2026-11-13 (step 9). **Do nothing here until Kevin says go.** Print ordering for customers (`PRINT_ORDERS_ENABLED`) is a separate switch and stays off; this only changes which lab account a delivered order goes to.

## What changes, in one line
One setting in the app, `PRINT_LAB_ENV` (Vercel, Production), plus the matching pfRouter config on the cloud PC:

| | Demo (today) | Live |
|---|---|---|
| App setting `PRINT_LAB_ENV` | unset (or `demo`) | `live` |
| Photo Finale dealer | 3404 (license 21277) | **4013** (license: ask Jason) |
| Hotfolder (pfRouter `path`) | `/LucyDarling-PrintOrders/demo/` | `/LucyDarling-PrintOrders/live/` |
| Rejected orders (pfRouter makes it) | `demo/_error/` | `live/_error/` |
| Accepted orders (pfRouter `moveTo`) | `/LucyDarling-PrintOrders/processed/demo/` | `/LucyDarling-PrintOrders/processed/live/` |
| Product codes in the XML | 7963 / 7965 / 7969 | 7963 / 7965 / 7969 (to be confirmed by Josh for 4013) |
| `_error` + "not picked up" alerts watch | `demo/` | `live/` |

The app and pfRouter must point at the **same** tree. If the app says live and pfRouter still watches `demo/`, orders sit in `live/` and the "not picked up" alert fires after 30 minutes.

## Before the switch (all must be true)
- [ ] Kevin has said go.
- [ ] Jason (Photo Finale) has given the **live license number** for dealer 4013 and confirmed 4013 is set up for our orders (see "What Jason needs to do").
- [ ] Josh (Persnickety) has confirmed **7963 = 4x4, 7965 = 4x6, 7969 = 5x5 matte (lustre)** on dealer 4013.
- [ ] No demo order is still waiting: `demo/` holds no order folders (anything sent should already be in `processed/demo/` or `demo/_error/`).

## 1. Dropbox (prints@lucydarling.com, under `/LucyDarling-PrintOrders`)
- [ ] Create `live/` (the live hotfolder). Leave it empty.
- [ ] Create `processed/live/` **next to** `processed/demo/`, NOT inside `live/` (pfRouter treats every folder inside a hotfolder as an order).
- [ ] Do not create `live/_error/`; pfRouter makes it the first time it rejects an order.
- [ ] On the cloud PC, check both new folders show up in the synced Dropbox (selective sync on).

## 2. myLab → Store Management → Kiosk → Advanced Configuration
Same screen used for the demo license 21277, but on the **live license** Jason gives you.
- [ ] `DealerCode` = `4013`
- [ ] Hotfolder setting, Windows paths with backslashes doubled (use the same drive/Dropbox path as the demo one, only `demo` → `live`):
  ```
  { "path": "<synced Dropbox>\\LucyDarling-PrintOrders\\live\\",
    "postAction": "move",
    "moveTo": "<synced Dropbox>\\LucyDarling-PrintOrders\\processed\\live\\" }
  ```
- [ ] Save, then relaunch pfRouter.
- [ ] Only ONE pfRouter instance should run (one dealer per instance). Stop the demo one, or ask Jason whether both can run side by side.

## 3. App setting (Kevin or Claude Code, after steps 1 and 2)
- [ ] Vercel → lucy-prints → Settings → Environment Variables → Production: `PRINT_LAB_ENV` = `live`. Leave `PRINT_DESTINATION` unset (old name; if it is set to anything else the app refuses to run delivery or the checks).
- [ ] Redeploy production so the setting takes effect.
- [ ] `.env.local` on the machine that runs `npm run print-order:deliver`: also `PRINT_LAB_ENV=live` (deliver reads the local setting).

## 4. First order on live (a test)
- [ ] Deliver one `TEST-` order (TEST_MODE stays on, so its id starts `TEST-`): `npm run print-order:deliver -- <order id>`. It must print `Destination: live (dealer 4013)`.
- [ ] Within ~2 minutes the folder leaves `live/` and appears in `processed/live/`; the order shows in myLab under dealer 4013.
- [ ] If it lands in `live/_error/`, read `reason.txt` (an alert email also arrives) and stop.

## Switching back to demo
1. Vercel Production: delete `PRINT_LAB_ENV` (or set it to `demo`), redeploy. Same in `.env.local`.
2. myLab Advanced Configuration: back to the demo license 21277, `DealerCode` 3404, `path` `...\\demo\\`, `moveTo` `...\\processed\\demo\\`. Save, relaunch pfRouter.
3. Leave `live/` and `processed/live/` in place (empty is fine). Anything still in `live/` will not be picked up by the demo instance: move it out by hand only after checking it was not already printed.

## What Jason (Photo Finale) needs to do for 4013
- Give us the **live license number** for dealer 4013 (demo was 21277) and confirm it is active.
- Confirm the products **7963, 7965, 7969** (4x4, 4x6, 5x5 matte) are active for 4013 and route to Persnickety.
- Confirm a **"standard"** mail shipping method is active on 4013 (our XML asks for `standard`).
- Confirm one pfRouter install can switch from 3404 to 4013 by config alone (or whether it needs a fresh install or a second instance).
- Confirm orders under 4013 are billed and fulfilled by Persnickety, not by Photo Finale's demo lab.
