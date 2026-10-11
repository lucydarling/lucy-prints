"use client";

import { useEffect, useState } from "react";
import { useSaveStore } from "@/store/save-store";

/**
 * The block at the bottom of the review page. Until the server says print
 * ordering is on for this browser (the flag, or the private preview cookie)
 * it renders exactly the "coming soon" note that was always there, so with
 * the feature off nothing differs.
 */
export function PrintOrderSection() {
  const sessionToken = useSaveStore((s) => s.sessionToken);
  const uploadQueue = useSaveStore((s) => s.uploadQueue);
  const uploadingSlot = useSaveStore((s) => s.uploadingSlot);
  const uploadErrors = useSaveStore((s) => s.uploadErrors);
  const setShowSaveModal = useSaveStore((s) => s.setShowSaveModal);

  const [enabled, setEnabled] = useState(false);
  const [lock, setLock] = useState<"frozen" | "held" | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ url: string; message: string } | null>(null);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    fetch(`/api/sessions/${sessionToken}/print-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setEnabled(d.printEnabled === true);
        setLock(d.printStatus ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  if (!enabled) {
    return (
      <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-center">
        <p className="text-xs text-rose-600 font-medium">
          Direct print ordering coming soon
        </p>
        <p className="text-xs text-rose-600 mt-0.5">
          We&apos;re working on connecting Lucy Darling prints directly — wanted to get this into your hands right away.
        </p>
      </div>
    );
  }

  if (lock === "frozen") {
    return (
      <div role="status" className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-center text-xs text-amber-900">
        Your print order has been placed, so this book is now locked. Start a new book to make another.
      </div>
    );
  }

  const saving = uploadQueue.length > 0 || uploadingSlot !== null;
  const failed = Object.keys(uploadErrors).length;

  async function start() {
    setErrors([]);
    if (!sessionToken) {
      setShowSaveModal(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionToken}/print-checkout`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.url && data.message) setConfirm({ url: data.url, message: data.message });
      else setErrors(data.errors ?? ["print ordering is not available right now"]);
    } catch {
      setErrors(["print ordering is not available right now"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 rounded-xl bg-white border border-rose-100">
      <p className="text-sm font-semibold text-gray-800 mb-1">Have us print them</p>
      <p className="text-xs text-gray-500 leading-relaxed mb-3">
        We&apos;ll print and mail your photos. Shipping and handling is added at checkout.
      </p>
      {saving && <p className="text-xs text-gray-500 mb-2">Saving your photos… one moment.</p>}
      {failed > 0 && (
        <p role="alert" className="text-xs text-red-600 mb-2">
          {failed} photo{failed === 1 ? "" : "s"} didn&apos;t save. Fix {failed === 1 ? "it" : "them"} on the upload page before ordering.
        </p>
      )}
      {errors.length > 0 && (
        <div role="alert" className="text-xs text-red-600 mb-2">
          <p className="font-semibold">We can&apos;t start this order yet:</p>
          <ul className="list-disc ml-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={start}
        disabled={busy || saving || failed > 0}
        className="w-full py-3 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? "Checking your book…" : "Print my photos"}
      </button>

      {confirm && (
        <div role="dialog" aria-modal="true" aria-label="Confirm print order" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-base font-semibold text-gray-800 mb-2">{confirm.message}</p>
            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              Once you pay, this book is sent to print and its photos and details can&apos;t be changed. Only photos that are saved will print. Shipping and handling is added at checkout.
            </p>
            <button
              type="button"
              onClick={() => window.location.assign(confirm.url)}
              className="w-full py-3 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl text-sm"
            >
              Continue to checkout
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="w-full mt-2 py-2 text-xs text-gray-500 underline">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
