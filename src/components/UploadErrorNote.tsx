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
