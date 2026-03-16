"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePhotoStore } from "@/store/photo-store";
import { BOOK_THEMES } from "@/lib/photo-slots";
import { OnboardingModal } from "@/components/OnboardingModal";

type BookSession = {
  token: string;
  bookTheme: string;
  themeName: string;
  babyName: string | null;
  photoCount: number;
  lastActivity: string;
};

export default function Home() {
  const setBookTheme = usePhotoStore((s) => s.setBookTheme);
  const bookTheme = usePhotoStore((s) => s.bookTheme);
  const router = useRouter();

  const [showFindBooks, setShowFindBooks] = useState(false);
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupBooks, setLookupBooks] = useState<BookSession[] | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError("");
    setLookupBooks(null);
    setEmailSent(false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lookupEmail)) {
      setLookupError("Enter a valid email address.");
      return;
    }
    setLookupLoading(true);
    try {
      const res = await fetch(`/api/sessions?email=${encodeURIComponent(lookupEmail)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      setLookupBooks(data.sessions);
    } catch {
      setLookupError("Something went wrong. Please try again.");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleSendMyBooks = async () => {
    try {
      await fetch("/api/my-books-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: lookupEmail }),
      });
    } finally {
      setEmailSent(true);
    }
  };

  const handleSelect = (themeId: string) => {
    setBookTheme(themeId);
    router.push("/upload");
  };

  const hasExisting = bookTheme !== null;

  return (
    <div className="min-h-screen bg-gray-50">
      <OnboardingModal />

      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 py-8 text-center">
          <Image
            src="/logo.png"
            alt="Lucy Darling"
            width={200}
            height={160}
            className="mx-auto"
            priority
          />
          <p className="text-sm font-medium mt-2 text-rose-600">Photo Organizer</p>
          <p className="text-sm text-gray-500 mt-3 max-w-md mx-auto">
            Organize and crop your photos for every page of your memory book —
            then download them ready to print at home or at any photo lab.
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Continue existing session (local) */}
        {hasExisting && (
          <div className="mb-6">
            <button
              onClick={() => router.push("/upload")}
              className="w-full py-4 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm bg-rose-500 hover:bg-rose-600"
            >
              Continue Your Photo Book
            </button>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-gray-50 px-3 text-xs text-gray-400">
                  or start fresh
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Find My Books */}
        <div className="mb-6">
          {!showFindBooks ? (
            <button
              onClick={() => setShowFindBooks(true)}
              className="w-full py-3 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:border-rose-200 hover:text-rose-600 transition-colors bg-white"
            >
              📚 Find my saved books
            </button>
          ) : (
            <div className="p-4 rounded-xl bg-white border border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">Find My Saved Books</h3>
                <button
                  onClick={() => { setShowFindBooks(false); setLookupBooks(null); setLookupError(""); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <form onSubmit={handleLookup} className="flex gap-2">
                <input
                  type="email"
                  value={lookupEmail}
                  onChange={(e) => setLookupEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoFocus
                  className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-transparent"
                />
                <button
                  type="submit"
                  disabled={lookupLoading}
                  className="px-4 py-2.5 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
                >
                  {lookupLoading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : "Find"}
                </button>
              </form>

              {lookupError && (
                <p className="text-xs text-red-500 mt-2">{lookupError}</p>
              )}

              {lookupBooks !== null && (
                <div className="mt-3">
                  {lookupBooks.length === 0 ? (
                    <p className="text-xs text-gray-500">No saved books found for that email.</p>
                  ) : (
                    <div className="space-y-2">
                      {lookupBooks.map((book) => (
                        <button
                          key={book.token}
                          onClick={() => router.push(`/resume/${book.token}`)}
                          className="w-full text-left p-3 rounded-xl border border-gray-100 hover:border-rose-200 hover:bg-rose-50 transition-colors flex items-center justify-between gap-3"
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-800">
                              {book.babyName ? `${book.babyName} — ` : ""}{book.themeName}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {book.photoCount} photo{book.photoCount !== 1 ? "s" : ""} saved
                            </p>
                          </div>
                          <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      ))}
                      <button
                        onClick={handleSendMyBooks}
                        disabled={emailSent}
                        className="w-full text-xs text-gray-400 hover:text-gray-600 underline mt-1 disabled:no-underline disabled:cursor-default"
                      >
                        {emailSent ? "✓ Links sent — check your email" : "Email me links instead"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="mb-6 p-4 rounded-xl bg-white border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            How it works
          </h3>
          <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
            <li>Select your memory book theme below</li>
            <li>Upload photos — we&apos;ll tell you exactly which ones you need</li>
            <li>Crop each photo to the perfect size</li>
            <li>Download your ready-to-print photos</li>
            <li>Print at home or any photo lab, then add them to your book</li>
          </ol>
          <p className="text-xs text-rose-600 mt-3">
            Print ordering coming soon — we&apos;re working on it!
          </p>
        </div>

        {/* Theme selection */}
        <h2 className="text-base font-semibold text-gray-800 mb-3">
          {hasExisting ? "Start a New Book" : "Select Your Book Theme"}
        </h2>

        {/* Standard Memory Books */}
        <div className="grid grid-cols-2 gap-3">
          {BOOK_THEMES.filter((t) => t.tier === "standard").map((theme) => (
            <ThemeCard key={theme.id} theme={theme} onSelect={handleSelect} />
          ))}
        </div>

        {/* Luxury Memory Books */}
        <h3 className="text-sm font-semibold text-gray-700 mt-6 mb-3">
          Luxury Collection
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {BOOK_THEMES.filter((t) => t.tier === "luxury").map((theme) => (
            <ThemeCard key={theme.id} theme={theme} onSelect={handleSelect} luxury />
          ))}
        </div>

        {/* Retiring titles */}
        <h3 className="text-sm font-semibold text-gray-400 mt-6 mb-1">
          Limited Availability
        </h3>
        <p className="text-xs text-gray-400 mb-3">These titles are being retired — available while supplies last.</p>
        <div className="grid grid-cols-2 gap-3">
          {BOOK_THEMES.filter((t) => t.tier === "retiring").map((theme) => (
            <ThemeCard key={theme.id} theme={theme} onSelect={handleSelect} retiring />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  theme,
  onSelect,
  luxury,
  retiring,
}: {
  theme: (typeof BOOK_THEMES)[number];
  onSelect: (id: string) => void;
  luxury?: boolean;
  retiring?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(theme.id)}
      className={`group relative rounded-xl overflow-hidden border transition-all text-left ${
        luxury
          ? "border-amber-200 hover:border-amber-300 hover:shadow-md"
          : retiring
          ? "border-gray-200 hover:border-gray-300 hover:shadow-sm opacity-80 hover:opacity-100"
          : "border-gray-100 hover:border-rose-200 hover:shadow-md"
      }`}
    >
      <div
        className={`relative aspect-square ${
          theme.id === "flower_child"
            ? "bg-white"
            : luxury
            ? "bg-gradient-to-br from-amber-50 to-amber-100"
            : retiring
            ? "bg-gradient-to-br from-gray-50 to-gray-100"
            : "bg-gradient-to-br from-rose-50 to-pink-50"
        }`}
      >
        <Image
          src={theme.id === "flower_child" ? `/covers/flower_child.png` : `/covers/${theme.id}.jpg`}
          alt={theme.name}
          fill
          className={theme.id === "flower_child" ? "object-contain p-3" : "object-cover"}
          sizes="(max-width: 640px) 50vw, 256px"
        />
      </div>
      <div className="p-3 bg-white">
        <p className="text-sm font-medium text-gray-800 truncate">
          {theme.name}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">48 photos</p>
      </div>
    </button>
  );
}
