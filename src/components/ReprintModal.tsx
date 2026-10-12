"use client";

import { useRef, useState } from "react";
import { Cropper, CropperRef } from "react-advanced-cropper";
import "react-advanced-cropper/dist/style.css";
import { usePhotoStore } from "@/store/photo-store";
import { useSaveStore } from "@/store/save-store";
import { refreshPrintedState, usePrintedStore } from "@/store/printed-store";
import { uploadPhoto } from "@/hooks/useAutoUpload";
import { getBookSlots, getPrintDimensions, getPrintSizeLabel } from "@/lib/photo-slots";

/**
 * Crop a replacement for an already-printed photo. It is saved as a PENDING
 * reprint (never over the printed photo) and printed, at the per-print price,
 * with the customer's next order.
 */
export function ReprintModal() {
  const draft = usePrintedStore((s) => s.reprintDraft);
  const setDraft = usePrintedStore((s) => s.setReprintDraft);
  const sessionToken = useSaveStore((s) => s.sessionToken);
  const bookTheme = usePhotoStore((s) => s.bookTheme);
  const regionLayouts = usePhotoStore((s) => s.regionLayouts);
  const cropperRef = useRef<CropperRef>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!draft) return null;
  const slot = getBookSlots(bookTheme, regionLayouts).find((s) => s.key === draft.slotKey);
  if (!slot) return null;
  const { width, height } = getPrintDimensions(slot.size, slot.orientation);
  const sizeLabel = getPrintSizeLabel(slot.size, slot.orientation);

  const close = () => {
    setError(null);
    setDraft(null);
  };

  async function done() {
    if (!sessionToken) return;
    const canvas = cropperRef.current?.getCanvas({ width, height });
    if (!canvas) {
      setError("We couldn't open this photo. Please try a JPG or PNG version.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadPhoto({
        sessionToken,
        slotKey: draft!.slotKey,
        croppedUrl: canvas.toDataURL("image/jpeg", 0.95),
        printSize: sizeLabel,
        isExtra: false,
        reprint: true,
      });
      await refreshPrintedState(sessionToken);
      close();
    } catch (err) {
      setError((err as Error).message || "That didn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/50">
        <button onClick={close} disabled={busy} className="text-white/80 hover:text-white text-sm font-medium">Cancel</button>
        <div className="text-center">
          <p className="text-white text-sm font-medium">Replace: {slot.prompt}</p>
          <p className="text-white/60 text-xs">{sizeLabel}&quot; reprint</p>
        </div>
        <button onClick={done} disabled={busy} className="text-rose-400 hover:text-rose-300 text-sm font-semibold disabled:opacity-50">
          {busy ? "Saving…" : "Done"}
        </button>
      </div>
      <div className="flex-1 relative">
        <Cropper ref={cropperRef} src={draft.url} stencilProps={{ aspectRatio: width / height }} onError={() => setError("We couldn't open this photo. Please try a JPG or PNG version.")} className="h-full" />
      </div>
      <div className="px-4 py-3 bg-black/50 text-center">
        {error && <p role="alert" className="text-rose-300 text-xs mb-1">{error}</p>}
        <p className="text-white/60 text-xs">
          This is a paid reprint. Your printed photo stays as it is; the new one is added to your next order at the per-print price.
        </p>
      </div>
    </div>
  );
}
