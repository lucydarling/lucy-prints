import { create } from "zustand";

/**
 * What has been printed for the open book (from /print-status) and the
 * reprint being cropped. Printed slots and extras are locked; the rest of the
 * book stays editable. Empty (and everything hidden) while print ordering is off.
 */
interface PrintedState {
  printedSlots: string[];
  printedExtras: string[];
  /** Printed slots that have a replacement waiting for the next order. */
  reprintSlots: string[];
  printedCount: number;
  bookSlots: number;
  /** The reprint being cropped: the slot and the uncropped photo. */
  reprintDraft: { slotKey: string; url: string } | null;
  setPrinted: (p: Partial<Pick<PrintedState, "printedSlots" | "printedExtras" | "reprintSlots" | "printedCount" | "bookSlots">>) => void;
  setReprintDraft: (d: PrintedState["reprintDraft"]) => void;
}

export const usePrintedStore = create<PrintedState>((set) => ({
  printedSlots: [],
  printedExtras: [],
  reprintSlots: [],
  printedCount: 0,
  bookSlots: 0,
  reprintDraft: null,
  setPrinted: (p) => set(p),
  setReprintDraft: (reprintDraft) => set({ reprintDraft }),
}));

/** Re-read the printed state after anything that can change it (a reprint upload or removal). */
export async function refreshPrintedState(sessionToken: string): Promise<void> {
  try {
    const r = await fetch(`/api/sessions/${sessionToken}/print-status`);
    const d = r.ok ? await r.json() : null;
    const p = d?.printed;
    usePrintedStore.getState().setPrinted(
      p
        ? { printedSlots: p.slots ?? [], printedExtras: p.extras ?? [], reprintSlots: p.reprintSlots ?? [], printedCount: p.printedCount ?? 0, bookSlots: p.bookSlots ?? 0 }
        : { printedSlots: [], printedExtras: [], reprintSlots: [], printedCount: 0, bookSlots: 0 }
    );
  } catch {
    /* leave the last known state */
  }
}
