"use client";

import { useSaveStore } from "@/store/save-store";

/** Why this photo didn't save (e.g. too small to print), shown under it as soon as the upload fails. */
export function UploadErrorNote({ slotKey }: { slotKey: string }) {
  const message = useSaveStore((s) => s.uploadErrors[slotKey]);
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-xs leading-snug text-red-600">
      {message}
    </p>
  );
}

/** True while this photo has an upload error — its green "done" check is hidden meanwhile. */
export function useHasUploadError(slotKey: string): boolean {
  return useSaveStore((s) => Boolean(s.uploadErrors[slotKey]));
}
