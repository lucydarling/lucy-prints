#!/usr/bin/env python3
"""
Memory-book ZIP baseline: build the customer ZIP for a book under all three
print options from fixed generated images, and record every file's name, size
and SHA-256. Run it on two versions of the app and diff the results.

  # record a version (run from this repo's root; --repo is the checkout to test)
  python3 scripts/zip-baseline/run.py --repo /path/to/checkout --label main
  python3 scripts/zip-baseline/run.py --repo . --label journal-areas
  # compare
  python3 scripts/zip-baseline/run.py --compare zip-baseline-main.json zip-baseline-journal-areas.json

Needs: python3 with `playwright` (+ chromium), and node_modules in --repo
(esbuild bundles that checkout's src/lib/download-zip.ts). ZIP container bytes
carry timestamps, so the entries inside are hashed, not the ZIP itself.
Compare two runs on the SAME machine and browser build: JPEG/PNG encoding is
deterministic there, not across browsers.
"""
import argparse, hashlib, json, subprocess, sys, tempfile, zipfile, pathlib

OPTIONS = ["as-is", "pad-3x3-to-4x4", "all-on-4x6"]

def record(repo, label, theme, out):
    from playwright.sync_api import sync_playwright
    here = pathlib.Path(__file__).resolve().parent
    repo = pathlib.Path(repo).resolve()
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="zip-baseline-"))
    bundle = tmp / "bundle.js"
    subprocess.run(
        ["npx", "esbuild", str(here / "entry.ts"), "--bundle", "--format=iife", "--platform=browser",
         f"--alias:@={repo / 'src'}", f"--outfile={bundle}", "--log-level=warning"],
        cwd=repo, check=True)
    result = {"label": label, "theme": theme, "options": {}}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for option in OPTIONS:
            page = browser.new_page(accept_downloads=True)
            page.set_content("<html><body></body></html>")
            page.add_script_tag(path=str(bundle))
            with page.expect_download(timeout=120000) as dl:
                page.evaluate("([t, o]) => window.runZip(t, o)", [theme, option])
            z = tmp / f"{option}.zip"
            dl.value.save_as(str(z))
            with zipfile.ZipFile(z) as zf:
                result["options"][option] = {
                    i.filename: {"size": i.file_size, "sha256": hashlib.sha256(zf.read(i)).hexdigest()}
                    for i in sorted(zf.infolist(), key=lambda i: i.filename) if not i.is_dir()
                }
            page.close()
        browser.close()
    pathlib.Path(out).write_text(json.dumps(result, indent=1))
    print(f"{label}: " + ", ".join(f"{o}={len(v)} files" for o, v in result["options"].items()) + f" -> {out}")

def compare(a, b):
    A, B = json.loads(pathlib.Path(a).read_text()), json.loads(pathlib.Path(b).read_text())
    bad = 0
    for option in OPTIONS:
        fa, fb = A["options"][option], B["options"][option]
        for name in sorted(set(fa) | set(fb)):
            if fa.get(name) != fb.get(name):
                bad += 1
                print(f"DIFF [{option}] {name}: {fa.get(name)} vs {fb.get(name)}")
    total = sum(len(v) for v in A["options"].values())
    print(f"{'IDENTICAL' if bad == 0 else 'DIFFERENT'}: {total} files compared across {len(OPTIONS)} options, {bad} differences")
    return 1 if bad else 0

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo"); ap.add_argument("--label"); ap.add_argument("--theme", default="little_goose")
    ap.add_argument("--out"); ap.add_argument("--compare", nargs=2)
    a = ap.parse_args()
    if a.compare: sys.exit(compare(*a.compare))
    record(a.repo, a.label, a.theme, a.out or f"zip-baseline-{a.label}.json")
