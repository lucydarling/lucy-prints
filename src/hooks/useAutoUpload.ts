"use client";

import { useEffect, useRef } from "react";
import { useSaveStore } from "@/store/save-store";
import { usePhotoStore } from "@/store/photo-store";
import { PHOTO_SLOTS } from "@/lib/photo-slots";

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

  // Watch for newly cropped photos and auto-queue them
  useEffect(() => {
    if (!sessionToken) return;

    const prev = prevPhotosRef.current;
    const newlyCropped: string[] = [];

    for (const [key, entry] of Object.entries(photos)) {
      if (
        entry.status === "cropped" &&
        entry.croppedUrl &&
        (!prev[key] || prev[key].status !== "cropped" || prev[key].croppedUrl !== entry.croppedUrl)
      ) {
        newlyCropped.push(key);
      }
    }

    if (newlyCropped.length > 0) {
      addToUploadQueue(newlyCropped);
    }

    prevPhotosRef.current = photos;
  }, [photos, sessionToken, addToUploadQueue]);

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
      const slotDef = PHOTO_SLOTS.find((s) => s.key === nextSlotKey);
      printSize = slotDef?.size || "4x4";
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
      isExtra,
      extraId,
    })
      .then(() => {
        markUploaded(nextSlotKey);
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
  isExtra,
  extraId,
}: {
  sessionToken: string;
  slotKey: string;
  croppedUrl: string;
  customLabel?: string;
  milestoneDate?: string;
  printSize?: string;
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
