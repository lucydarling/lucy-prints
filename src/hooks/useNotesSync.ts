"use client";

import { useEffect, useRef } from "react";
import { usePhotoStore } from "@/store/photo-store";
import { useSaveStore } from "@/store/save-store";

/**
 * Debounced notes sync hook — sends notes and detailsMode to the server
 * whenever they change, with a 2-second debounce to avoid excessive requests.
 *
 * Only syncs when a session token exists (user has saved at least once).
 */
export function useNotesSync() {
  const sessionToken = useSaveStore((s) => s.sessionToken);
  const notes = usePhotoStore((s) => s.notes);
  const detailsMode = usePhotoStore((s) => s.detailsMode);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedRef = useRef<string>("");

  useEffect(() => {
    if (!sessionToken) return;

    // Serialize current state to detect actual changes
    const serialized = JSON.stringify({ notes, detailsMode });
    if (serialized === lastSyncedRef.current) return;

    // Debounce: wait 2 seconds after last change before syncing
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionToken}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes, detailsMode }),
        });

        if (res.ok) {
          lastSyncedRef.current = serialized;
        }
      } catch {
        // Silent failure — notes will sync on next change or session save
      }
    }, 2000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [sessionToken, notes, detailsMode]);
}
