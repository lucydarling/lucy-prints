"use client";

import { useEffect, useState } from "react";
import { useSaveStore } from "@/store/save-store";

/**
 * Shown when the open book has a print order: locked once the order is ready
 * (or refused), or waiting for the customer to finish it (held).
 */
export function PrintLockBanner() {
  const sessionToken = useSaveStore((s) => s.sessionToken);
  const [lock, setLock] = useState<"frozen" | "held" | null>(null);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    fetch(`/api/sessions/${sessionToken}/print-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setLock(d?.printStatus ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  if (!lock) return null;
  return (
    <div role="status" className="mx-4 mb-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
      {lock === "held"
        ? "Add photos to finish your print order."
        : "Your print order has been placed, so this book is now locked. Start a new book to make another."}
    </div>
  );
}
