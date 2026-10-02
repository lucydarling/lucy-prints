"use client";

import { useEffect, useRef } from "react";
import { useSaveStore } from "@/store/save-store";
import { usePhotoStore } from "@/store/photo-store";
import { getBookSlots, getPrintSizeLabel } from "@/lib/photo-slots";
import { diffCrops } from "@/lib/crop-sync";

/**
 * Slots re-cropped while their previous crop was still uploading. When that
 * upload finishes it would mark the slot done and the new crop would never go
 * up, so the completion handler re-queues anything in here.
 */
const staleWhileUploading = new Set<string>();

/**
 * A crop that REPLACES an already-seen crop must go up again, but
 * addToUploadQueue skips keys in uploadedSlots, so drop them first.
 */
function requeueRecropped(keys: string[]) {
  if (keys.length === 0) return;
  const { uploadingSlot } = useSaveStore.getState();
  useSaveStore.setState((s) => ({
    uploadedSlots: s.uploadedSlots.filter((k) => !keys.includes(k)),
  }));
  for (const k of keys) if (k === uploadingSlot) staleWhileUploading.add(k);
  useSaveStore.getState().addToUploadQueue(keys);
}

/**
 * A crop that was CLEARED (orientation or layout changed, photo removed)
 * leaves the cloud copy stale. Forget that it was uploaded, so the crop that
 * replaces it uploads instead of being skipped as "already uploaded". If it's
 * mid-upload right now, the completion handler re-queues it, and the queue
 * drops it again while it has no crop.
 */
function forgetUploaded(keys: string[]) {
  if (keys.length === 0) return;
  const { uploadingSlot } = useSaveStore.getState();
  useSaveStore.setState((s) => ({
    uploadedSlots: s.uploadedSlots.filter((k) => !keys.includes(k)),
  }));
  for (const k of keys) if (k === uploadingSlot) staleWhileUploading.add(k);
}

/** Slot crops as key → cropped URL (only status "cropped" counts as cropped). */
function slotCrops(photos: Record<string, { status: string; croppedUrl: string | null }>) {
  return new Map(
    Object.entries(photos).map(([k, p]) => [k, p.status === "cropped" ? p.croppedUrl : null])
  );
}

/**
 * Background upload hook — processes the upload queue one photo at a time.
 * Also watches for newly cropped photos and queues them for upload.
 */
export function useAutoUpload() {
  const sessionToken = useSaveStore((s) => s.sessionToken);
  const uploadQueue = useSaveStore((s) => s.uploadQueue);
  const uploadingSlot = useSaveStore((s) => s.uploadingSlot);
  const setUploadingSlot = useSaveStore((s) => s.setUploadingSlot);
  const markUploaded = useSaveStore((s) => s.markUploaded);
  const markUploadError = useSaveStore((s) => s.markUploadError);
  const addToUploadQueue = useSaveStore((s) => s.addToUploadQueue);
  const photos = usePhotoStore((s) => s.photos);
  const extras = usePhotoStore((s) => s.extras);

  const prevPhotosRef = useRef<typeof photos>({});
  const prevExtrasRef = useRef<typeof extras>([]);

  // Watch for newly cropped photos and auto-queue them
  useEffect(() => {
    if (!sessionToken) return;

    // A different crop replacing one we already had (not the first-mount pass,
    // where prev is empty) has to overwrite what's in the cloud; a cleared
    // crop's replacement must upload too.
    const { newlyCropped, recropped, cleared } = diffCrops(
      slotCrops(prevPhotosRef.current),
      slotCrops(photos)
    );

    forgetUploaded(cleared);
    requeueRecropped(recropped);
    if (newlyCropped.length > 0) {
      addToUploadQueue(newlyCropped);
    }

    prevPhotosRef.current = photos;
  }, [photos, sessionToken, addToUploadQueue]);

  // Watch for newly cropped extras and auto-queue them
  useEffect(() => {
    if (!sessionToken) return;

    // Changing an extra's orientation clears its crop (it must be re-cropped
    // to the new shape) — the re-crop must reach the cloud, not be skipped.
    const { newlyCropped, recropped, cleared } = diffCrops(
      new Map(prevExtrasRef.current.map((e) => [e.id, e.croppedUrl])),
      new Map(extras.map((e) => [e.id, e.croppedUrl]))
    );

    forgetUploaded(cleared);
    requeueRecropped(recropped);
    if (newlyCropped.length > 0) {
      addToUploadQueue(newlyCropped);
    }

    prevExtrasRef.current = extras;
  }, [extras, sessionToken, addToUploadQueue]);

  // Process upload queue — one at a time
  useEffect(() => {
    if (!sessionToken || uploadingSlot || uploadQueue.length === 0) return;

    const nextSlotKey = uploadQueue[0];
    if (!nextSlotKey) return;

    // Find the photo data
    const isExtra = nextSlotKey.startsWith("extra_");
    let croppedUrl: string | null = null;
    let customLabel: string | undefined;
    let milestoneDate: string | undefined;
    let printSize: string | undefined;
    let orientation: string | undefined;
    let extraId: string | undefined;

    if (isExtra) {
      const extra = extras.find((e) => e.id === nextSlotKey);
      if (!extra?.croppedUrl) {
        // No data yet — remove from queue
        useSaveStore.getState().removeFromQueue(nextSlotKey);
        return;
      }
      croppedUrl = extra.croppedUrl;
      printSize = extra.size;
      orientation = extra.orientation;
      extraId = extra.id;
    } else {
      const photo = photos[nextSlotKey];
      if (!photo?.croppedUrl) {
        useSaveStore.getState().removeFromQueue(nextSlotKey);
        return;
      }
      croppedUrl = photo.croppedUrl;
      customLabel = photo.customLabel;
      milestoneDate = photo.milestoneDate;
      // Look up print size from slot config
      const { bookTheme, regionLayouts } = usePhotoStore.getState();
      const slotDef = getBookSlots(bookTheme, regionLayouts).find(
        (s) => s.key === nextSlotKey
      );
      // Stored as the print reads ("4x3", "3x4", "3.5x3.5"): for a region
      // photo that's how its layout's orientation survives a resume. Memory
      // book slots have no orientation, so their value is unchanged.
      printSize = slotDef ? getPrintSizeLabel(slotDef.size, slotDef.orientation) : "4x4";
    }

    if (!croppedUrl) return;

    setUploadingSlot(nextSlotKey);

    // Convert data URL to blob and upload
    uploadPhoto({
      sessionToken,
      slotKey: nextSlotKey,
      croppedUrl,
      customLabel,
      milestoneDate,
      printSize,
      orientation,
      isExtra,
      extraId,
    })
      .then(() => {
        markUploaded(nextSlotKey);
        if (staleWhileUploading.delete(nextSlotKey)) {
          // Re-cropped during this upload: the copy we just sent is already old.
          requeueRecropped([nextSlotKey]);
        }
      })
      .catch((err) => {
        markUploadError(nextSlotKey, err.message || "Upload failed");
      });
  }, [sessionToken, uploadQueue, uploadingSlot, photos, extras, setUploadingSlot, markUploaded, markUploadError]);
}

async function uploadPhoto({
  sessionToken,
  slotKey,
  croppedUrl,
  customLabel,
  milestoneDate,
  printSize,
  orientation,
  isExtra,
  extraId,
}: {
  sessionToken: string;
  slotKey: string;
  croppedUrl: string;
  customLabel?: string;
  milestoneDate?: string;
  printSize?: string;
  orientation?: string;
  isExtra: boolean;
  extraId?: string;
}) {
  // Convert base64 data URL to blob
  const res = await fetch(croppedUrl);
  const blob = await res.blob();

  const formData = new FormData();
  formData.append("sessionToken", sessionToken);
  formData.append("slotKey", slotKey);
  formData.append("image", blob, `${slotKey}.jpg`);
  if (customLabel) formData.append("customLabel", customLabel);
  if (milestoneDate) formData.append("milestoneDate", milestoneDate);
  if (printSize) formData.append("printSize", printSize);
  if (orientation) formData.append("orientation", orientation);
  if (isExtra) formData.append("isExtra", "true");
  if (extraId) formData.append("extraId", extraId);

  // Retry up to 3 times with exponential backoff
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const uploadRes = await fetch("/api/photos/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        const data = await uploadRes.json();
        throw new Error(data.error || `Upload failed (${uploadRes.status})`);
      }

      return; // success
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Upload failed");
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError || new Error("Upload failed after retries");
}
