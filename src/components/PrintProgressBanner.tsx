"use client";

import { useEffect } from "react";
import { useSaveStore } from "@/store/save-store";
import { refreshPrintedState, usePrintedStore } from "@/store/printed-store";

/**
 * Shown once part of the open book has been printed: how far along it is, and
 * that printed photos are locked (they can be replaced as a paid reprint).
 * Renders nothing while print ordering is off or nothing has been printed.
 */
export function PrintProgressBanner() {
  const sessionToken = useSaveStore((s) => s.sessionToken);
  const printedCount = usePrintedStore((s) => s.printedCount);
  const bookSlots = usePrintedStore((s) => s.bookSlots);

  useEffect(() => {
    if (sessionToken) refreshPrintedState(sessionToken);
  }, [sessionToken]);

  if (printedCount === 0) return null;
  return (
    <div role="status" className="mx-4 mb-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900">
      {printedCount} of {bookSlots} photos printed so far. Printed photos are locked; you can keep adding the rest, and print them whenever you&apos;re ready. To change a printed photo, choose Replace photo — that&apos;s a paid reprint.
    </div>
  );
}
