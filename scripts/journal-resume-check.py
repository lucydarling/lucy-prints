#!/usr/bin/env python3
"""
Journal resume check against a (preview) deployment: saves two journal sessions
the way the app does, resumes each in a real browser, and checks the photos and
layouts come back. Creates sessions for TEST_EMAIL; prints their tokens so they
can be deleted afterwards (--cleanup-note lists them; no deletion happens here).

  python3 scripts/journal-resume-check.py --base https://<deployment>.vercel.app \
      --share '<shareable url from Vercel, if the deployment is protected>'

The preview key is read from ~/Library/Application Support/lucy-darling/secrets/photo-lab-pj-preview-key.txt
and never printed.
"""
import argparse, io, json, pathlib, sys, time
from PIL import Image
from playwright.sync_api import sync_playwright

KEY = pathlib.Path.home() / "Library/Application Support/lucy-darling/secrets/photo-lab-pj-preview-key.txt"
EMAIL = "kevin+pjtest@lucydarling.com"
PX = {"3x3": 900, "4x4": 1200}

def jpeg(n, side):
    im = Image.new("RGB", (side, side), ((n * 53) % 256, (n * 97) % 256, (n * 29) % 256))
    b = io.BytesIO(); im.save(b, "JPEG", quality=80); return b.getvalue()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--base", required=True); ap.add_argument("--share")
    a = ap.parse_args(); base = a.base.rstrip("/")
    key = KEY.read_text().strip()
    out = {"tokens": {}, "checks": []}
    def check(name, ok, detail=""):
        out["checks"].append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 430, "height": 900})
        page = ctx.new_page()
        if a.share: page.goto(a.share)
        page.goto(f"{base}/preview?key={key}")
        req = ctx.request

        def make(theme):
            r = req.post(f"{base}/api/sessions", data={"email": EMAIL, "bookTheme": theme})
            assert r.ok, (r.status, r.text()[:200])
            return r.json()["token"]
        def upload(token, slot, size_label, n):
            side = PX[size_label]
            r = req.post(f"{base}/api/photos/upload", multipart={
                "sessionToken": token, "slotKey": slot, "printSize": size_label,
                "image": {"name": f"{slot}.jpg", "mimeType": "image/jpeg", "buffer": jpeg(n, side)}})
            assert r.ok, (slot, r.status, r.text()[:200])
        def notes(token, layouts):
            r = req.patch(f"{base}/api/sessions/{token}", data={"notes": {"_layouts": layouts}, "detailsMode": False})
            assert r.ok, (r.status, r.text()[:200])
        def api_photos(token):
            r = req.get(f"{base}/api/sessions/{token}"); assert r.ok, r.status
            return r.json()

        # Session A (Desert Sand): an old layout — page 4, 1 x 4x4.
        A = make("love_grows_desert_sand"); out["tokens"]["A_desert_sand"] = A
        upload(A, "pj_month_1_2_1", "4x4", 1)
        notes(A, {"pj_month_1_2": "1x4x4"})
        # Session B (Moss Green): new layouts — page 28 4 x 3x3, page 6 (Month 4) 2 x 3x3.
        B = make("love_grows_moss_green"); out["tokens"]["B_moss_green"] = B
        for i in range(1, 5): upload(B, f"pj_adjusting_{i}", "3x3", 10 + i)
        for i in range(1, 3): upload(B, f"pj_month_4_{i}", "3x3", 20 + i)
        notes(B, {"pj_adjusting": "4x3x3", "pj_month_4": "2x3x3"})

        def resume(token):
            """Fresh browser storage, open the resume link, return the app's stored state."""
            c = br.new_context(viewport={"width": 430, "height": 900})
            for ck in ctx.cookies(): c.add_cookies([ck])
            pg = c.new_page()
            pg.goto(f"{base}/resume/{token}")
            pg.wait_for_url("**/upload", timeout=60000)
            pg.wait_for_timeout(1500)
            state = pg.evaluate("() => JSON.parse(localStorage.getItem('lucy-prints-photos') || '{}').state || {}")
            return c, pg, state
        def cropped(state):
            return sorted(k for k, v in state.get("photos", {}).items() if v.get("croppedUrl"))

        cA, pgA, sA = resume(A)
        check("A: layout comes back (page 4 = 1 x 4x4)", sA.get("regionLayouts", {}).get("pj_month_1_2", {}).get("layoutId") == "1x4x4", json.dumps(sA.get("regionLayouts")))
        check("A: photo comes back", cropped(sA) == ["pj_month_1_2_1"], str(cropped(sA)))
        cA.close()

        cB, pgB, sB = resume(B)
        lay = sB.get("regionLayouts", {})
        check("B: page 28 comes back as 4 x 3x3", lay.get("pj_adjusting", {}).get("layoutId") == "4x3x3", json.dumps(lay.get("pj_adjusting")))
        check("B: Month 4 comes back as 2 x 3x3", lay.get("pj_month_4", {}).get("layoutId") == "2x3x3", json.dumps(lay.get("pj_month_4")))
        want = sorted([f"pj_adjusting_{i}" for i in range(1, 5)] + ["pj_month_4_1", "pj_month_4_2"])
        check("B: all six photos come back", cropped(sB) == want, str(cropped(sB)))
        card = pgB.locator('[data-region="pj_adjusting"]')
        card.scroll_into_view_if_needed()
        check("B: page 28 card shows 4 photo slots", card.get_by_text("of 4").count() == 4, f"{card.get_by_text('of 4').count()}")
        card.screenshot(path="journal-resume-B-4x3x3.png")

        # Switch page 28 down to 2 x 3x3 in the UI, let the notes sync, resume again.
        card.get_by_role("radio", name="2 photos · 3x3\"").click()
        pgB.wait_for_timeout(4000)  # debounced notes sync
        cB.close()
        cB2, pgB2, sB2 = resume(B)
        lay2 = sB2.get("regionLayouts", {})
        check("B after switching down: page 28 resumes as 2 x 3x3", lay2.get("pj_adjusting", {}).get("layoutId") == "2x3x3", json.dumps(lay2.get("pj_adjusting")))
        card2 = pgB2.locator('[data-region="pj_adjusting"]'); card2.scroll_into_view_if_needed()
        check("B after switching down: only 2 photo slots shown", card2.get_by_text("of 2").count() == 2, f"{card2.get_by_text('of 2').count()}")
        card2.screenshot(path="journal-resume-B-2x3x3.png")
        kept = sorted(k for k in api_photos(B)["photos"] if k.startswith("pj_adjusting_"))
        check("B after switching down: photos 3 and 4 still stored in the database", kept == [f"pj_adjusting_{i}" for i in range(1, 5)], str(kept))
        cB2.close(); br.close()
    print(json.dumps(out["tokens"]))
    sys.exit(0 if all(ok for _, ok, _ in out["checks"]) else 1)

main()
