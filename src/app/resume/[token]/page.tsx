"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { usePhotoStore } from "@/store/photo-store";
import { useSaveStore } from "@/store/save-store";

interface SessionData {
  session: {
    token: string;
    email: string;
    babyName: string | null;
    babyBirthdate: string | null;
    bookTheme: string;
    photoCount: number;
    notes: Record<string, Record<string, string>>;
    detailsMode: boolean;
  };
  photos: Record<
    string,
    {
      signedUrl: string;
      customLabel: string | null;
      milestoneDate: string | null;
      printSize: string;
      status: string;
    }
  >;
  extras: Array<{
    extraId: string;
    printSize: string;
    signedUrl: string | null;
    quantity: number;
  }>;
}

export default function ResumePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();

  const [status, setStatus] = useState<
    "loading" | "restoring" | "done" | "error" | "conflict"
  >("loading");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [sessionData, setSessionData] = useState<SessionData | null>(null);

  // Check for existing local data conflict
  const existingTheme = usePhotoStore((s) => s.bookTheme);
  const existingPhotos = usePhotoStore((s) => s.photos);
  const existingSessionToken = useSaveStore((s) => s.sessionToken);

  const hasExistingData =
    existingTheme !== null &&
    existingSessionToken !== token &&
    Object.values(existingPhotos).some(
      (p) => p.status === "cropped" || p.status === "uploaded"
    );

  // Fetch session on mount
  useEffect(() => {
    fetchSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function fetchSession() {
    try {
      const res = await fetch(`/api/sessions/${token}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError(
            "This link is no longer valid. It may have expired or been used on another device."
          );
        } else {
          setError("Something went wrong loading your session.");
        }
        setStatus("error");
        return;
      }

      const data: SessionData = await res.json();
      setSessionData(data);

      // Check for conflict with existing local data
      if (hasExistingData) {
        setStatus("conflict");
        return;
      }

      // No conflict — restore immediately
      await restoreSession(data);
    } catch {
      setError("Could not connect. Please check your internet and try again.");
      setStatus("error");
    }
  }

  async function restoreSession(data: SessionData) {
    setStatus("restoring");

    const photoKeys = Object.keys(data.photos);
    const totalPhotos = photoKeys.length + data.extras.length;
    setProgress({ current: 0, total: totalPhotos });

    try {
      // Set book theme first
      usePhotoStore.getState().setBookTheme(data.session.bookTheme);
      usePhotoStore.getState().initializeSlots();

      // Download and restore each photo
      let restored = 0;

      for (const [slotKey, photoData] of Object.entries(data.photos)) {
        try {
          // Download the signed URL and convert to base64 data URL
          const response = await fetch(photoData.signedUrl);
          const blob = await response.blob();
          const dataUrl = await blobToDataUrl(blob);

          // Set both preview and cropped URLs
          usePhotoStore.getState().setPhoto(slotKey, dataUrl);
          usePhotoStore.getState().setCropped(slotKey, dataUrl);

          // Restore custom label and milestone date
          if (photoData.customLabel) {
            usePhotoStore.getState().setCustomLabel(slotKey, photoData.customLabel);
          }
          if (photoData.milestoneDate) {
            usePhotoStore
              .getState()
              .setMilestoneDate(slotKey, photoData.milestoneDate);
          }

          restored++;
          setProgress({ current: restored, total: totalPhotos });
        } catch (err) {
          console.warn(`Failed to restore photo ${slotKey}:`, err);
          // Continue with other photos even if one fails
        }
      }

      // Restore extras
      for (const extra of data.extras) {
        try {
          if (extra.signedUrl) {
            const response = await fetch(extra.signedUrl);
            const blob = await response.blob();
            const dataUrl = await blobToDataUrl(blob);

            usePhotoStore
              .getState()
              .addExtra(extra.printSize as "3x3" | "4x4");
            const extras = usePhotoStore.getState().extras;
            const lastExtra = extras[extras.length - 1];
            if (lastExtra) {
              usePhotoStore.getState().setExtraPhoto(lastExtra.id, dataUrl);
              usePhotoStore.getState().setExtraCropped(lastExtra.id, dataUrl);
            }
          }

          restored++;
          setProgress({ current: restored, total: totalPhotos });
        } catch (err) {
          console.warn(`Failed to restore extra ${extra.extraId}:`, err);
        }
      }

      // Restore notes and detailsMode to photo store
      if (data.session.notes && Object.keys(data.session.notes).length > 0) {
        usePhotoStore.setState({ notes: data.session.notes });
      }
      if (data.session.detailsMode) {
        usePhotoStore.getState().setDetailsMode(true);
      }

      // Save the session info to save-store
      useSaveStore.getState().setSession(
        data.session.token,
        "", // sessionId comes from the API but we don't expose it via GET
        data.session.email,
        data.session.babyName || undefined,
        data.session.babyBirthdate || undefined
      );

      // Mark all restored photos as already uploaded (no need to re-upload)
      const uploadedKeys = Object.keys(data.photos);
      useSaveStore.setState({
        uploadedSlots: uploadedKeys,
        saveStatus: "saved",
      });

      setStatus("done");

      // Redirect to upload page after a short delay
      setTimeout(() => {
        router.push("/upload");
      }, 2000);
    } catch {
      setError("Failed to restore your photos. Please try again.");
      setStatus("error");
    }
  }

  // Conflict resolution: replace existing data
  function handleReplace() {
    if (sessionData) {
      // Clear existing data including notes and detailsMode
      usePhotoStore.setState({
        bookTheme: null,
        photos: {},
        extras: [],
        notes: {},
        detailsMode: false,
      });
      useSaveStore.getState().clearSession();

      restoreSession(sessionData);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 text-center">
        {/* Logo */}
        <div className="mb-6">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
            style={{ backgroundColor: "#FAB8A9" }}
          >
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        </div>

        {/* Loading */}
        {status === "loading" && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Loading Your Photos
            </h1>
            <p className="text-sm text-gray-500 mb-6">
              Finding your saved session...
            </p>
            <div className="flex justify-center">
              <svg
                className="w-8 h-8 animate-spin text-[#FAB8A9]"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          </>
        )}

        {/* Restoring */}
        {status === "restoring" && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Restoring Your Photos
            </h1>
            <p className="text-sm text-gray-500 mb-6">
              Downloading {progress.current} of {progress.total} photos...
            </p>
            <div className="w-full bg-gray-100 rounded-full h-3 mb-4">
              <div
                className="h-3 rounded-full transition-all duration-300"
                style={{
                  width: `${progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%`,
                  backgroundColor: "#FAB8A9",
                }}
              />
            </div>
            <p className="text-xs text-gray-400">
              This may take a moment on slower connections.
            </p>
          </>
        )}

        {/* Done */}
        {status === "done" && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Welcome Back!
            </h1>
            <p className="text-sm text-gray-500 mb-6">
              {progress.current} photos restored. Redirecting to your photo
              book...
            </p>
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            </div>
            <button
              onClick={() => router.push("/upload")}
              className="text-sm font-medium underline"
              style={{ color: "#D4857A" }}
            >
              Go to my photos now
            </button>
          </>
        )}

        {/* Error */}
        {status === "error" && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Oops — Something Went Wrong
            </h1>
            <p className="text-sm text-gray-500 mb-6">
              {error || "We couldn't load your session."}
            </p>
            <div className="space-y-3">
              <button
                onClick={() => {
                  setStatus("loading");
                  setError("");
                  fetchSession();
                }}
                className="w-full py-3 text-white font-semibold rounded-xl text-sm"
                style={{ backgroundColor: "#FAB8A9" }}
              >
                Try Again
              </button>
              <button
                onClick={() => router.push("/")}
                className="w-full py-3 text-gray-600 font-medium rounded-xl text-sm border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Start a New Book
              </button>
            </div>
          </>
        )}

        {/* Conflict — existing data warning */}
        {status === "conflict" && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              You Have Existing Photos
            </h1>
            <p className="text-sm text-gray-500 mb-6">
              This device already has photos from another session. Loading your
              saved photos will replace them.
            </p>
            <div className="space-y-3">
              <button
                onClick={handleReplace}
                className="w-full py-3 text-white font-semibold rounded-xl text-sm"
                style={{ backgroundColor: "#FAB8A9" }}
              >
                Replace with Saved Photos
              </button>
              <button
                onClick={() => router.push("/upload")}
                className="w-full py-3 text-gray-600 font-medium rounded-xl text-sm border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Keep Current Photos
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
