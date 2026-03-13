"use client";

import { useState } from "react";
import { useSaveStore } from "@/store/save-store";
import { usePhotoStore } from "@/store/photo-store";

export function SaveProgressModal() {
  const showSaveModal = useSaveStore((s) => s.showSaveModal);
  const setShowSaveModal = useSaveStore((s) => s.setShowSaveModal);
  const setSession = useSaveStore((s) => s.setSession);
  const setSaveStatus = useSaveStore((s) => s.setSaveStatus);
  const addToUploadQueue = useSaveStore((s) => s.addToUploadQueue);
  const bookTheme = usePhotoStore((s) => s.bookTheme);
  const photos = usePhotoStore((s) => s.photos);

  const [email, setEmail] = useState("");
  const [babyName, setBabyName] = useState("");
  const [babyBirthdate, setBabyBirthdate] = useState("");
  const [phone, setPhone] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [birthdateOptOut, setBirthdateOptOut] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!showSaveModal) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);

    try {
      // Create session via API
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          babyName: babyName.trim() || undefined,
          babyBirthdate: babyBirthdate || undefined,
          phone: phone.trim() || undefined,
          smsOptIn,
          bookTheme,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create session");
      }

      const { token, sessionId } = await res.json();

      // Save session to store
      setSession(token, sessionId, email.trim(), babyName.trim() || undefined);
      setSaveStatus("saving");

      // Queue all cropped photos for upload
      const croppedSlotKeys = Object.entries(photos)
        .filter(([, p]) => p.status === "cropped" && p.croppedUrl)
        .map(([key]) => key);

      if (croppedSlotKeys.length > 0) {
        addToUploadQueue(croppedSlotKeys);
      }

      // Close modal
      setShowSaveModal(false);

      // Send magic link email
      try {
        await fetch("/api/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: token }),
        });
      } catch {
        // Non-critical — user can request another email later
        console.warn("Magic link email send failed (non-critical)");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => !loading && setShowSaveModal(false)}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-6 mx-4 mb-0 sm:mb-auto animate-slide-up">
        {/* Close button */}
        <button
          onClick={() => !loading && setShowSaveModal(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          disabled={loading}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div className="text-center mb-5">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ backgroundColor: "#FAB8A9" }}
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900">Save My Progress</h2>
          <p className="text-sm text-gray-500 mt-1">
            We&apos;ll email you a link so you can pick up where you left off — on any device.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email — required */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#FAB8A9] focus:border-transparent"
            />
          </div>

          {/* Baby name — optional */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Baby&apos;s Name <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={babyName}
              onChange={(e) => setBabyName(e.target.value)}
              placeholder="e.g. Emma"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#FAB8A9] focus:border-transparent"
            />
          </div>

          {/* Baby birthdate — optional with explanation */}
          {!birthdateOptOut && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Baby&apos;s Birthday <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={babyBirthdate}
                onChange={(e) => setBabyBirthdate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#FAB8A9] focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                This helps us send gentle milestone reminders so you never miss a photo moment.
                We never sell your info.{" "}
                <a
                  href="https://www.lucydarling.com/policies/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-gray-600"
                >
                  Privacy Policy
                </a>
              </p>
              <button
                type="button"
                onClick={() => {
                  setBirthdateOptOut(true);
                  setBabyBirthdate("");
                }}
                className="text-xs text-gray-400 hover:text-gray-500 mt-1 underline"
              >
                I don&apos;t want help remembering to take photos
              </button>
            </div>
          )}

          {birthdateOptOut && (
            <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
              <p className="text-xs text-gray-500">
                No milestone reminders — got it! You can always change your mind later.
              </p>
              <button
                type="button"
                onClick={() => setBirthdateOptOut(false)}
                className="text-xs text-[#FAB8A9] hover:text-[#f5a898] mt-1 underline font-medium"
              >
                Actually, I&apos;d like reminders
              </button>
            </div>
          )}

          {/* Phone — optional */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#FAB8A9] focus:border-transparent"
            />
          </div>

          {/* SMS opt-in */}
          {phone && (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={smsOptIn}
                onChange={(e) => setSmsOptIn(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-[#FAB8A9]"
              />
              <span className="text-xs text-gray-500 leading-tight">
                Send me milestone reminders via text so I never miss a photo moment!
              </span>
            </label>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 text-white font-semibold rounded-xl transition-colors text-sm disabled:opacity-60"
            style={{ backgroundColor: "#FAB8A9" }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </span>
            ) : (
              "Save & Email Me a Link"
            )}
          </button>

          <p className="text-xs text-center text-gray-400">
            Your photos are stored securely. No account needed.
            <br />
            <a
              href="https://www.lucydarling.com/policies/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              Privacy Policy
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
