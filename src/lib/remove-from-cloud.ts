import { useSaveStore } from "@/store/save-store";

/**
 * The customer removed a photo or extra: delete the saved copy too, so it
 * can't come back when the book is resumed. Call this BEFORE clearing it
 * locally, and only clear locally if it resolves. Rejects with a message fit
 * to show the customer (e.g. the book was already sent to print).
 *
 * A photo that was never saved (no session yet) has nothing to delete.
 */
export async function removeFromCloud(key: string, isExtra: boolean): Promise<void> {
  const { sessionToken, removeFromQueue } = useSaveStore.getState();
  // Never upload it after this, and forget that it was uploaded.
  removeFromQueue(key);
  useSaveStore.setState((s) => ({ uploadedSlots: s.uploadedSlots.filter((k) => k !== key) }));
  if (!sessionToken) return;

  const res = await fetch("/api/photos/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(isExtra ? { sessionToken, extraId: key } : { sessionToken, slotKey: key }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Couldn't remove that photo. Please try again.");
  }
}
