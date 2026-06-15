"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSaveStore } from "@/store/save-store";
import { usePhotoStore } from "@/store/photo-store";
import { BOOK_THEMES } from "@/lib/photo-slots";

interface BookSession {
  token: string;
  bookTheme: string;
  themeName: string;
  babyName: string | null;
  photoCount: number;
}

export function BookSwitcher() {
  const [open, setOpen] = useState(false);
  const [books, setBooks] = useState<BookSession[] | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const email = useSaveStore((s) => s.email);
  const sessionToken = useSaveStore((s) => s.sessionToken);
  const bookTheme = usePhotoStore((s) => s.bookTheme);

  const currentTheme = BOOK_THEMES.find((t) => t.id === bookTheme);
  const currentName = currentTheme?.name ?? bookTheme ?? "Your Book";

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleOpen() {
    if (!email) {
      // No saved session — just go to homepage to pick a new book
      router.push("/");
      return;
    }

    setOpen(!open);

    if (!open && books === null) {
      setLoading(true);
      try {
        const res = await fetch(`/api/sessions?email=${encodeURIComponent(email)}`);
        const data = await res.json();
        setBooks(data.sessions || []);
      } catch {
        setBooks([]);
      } finally {
        setLoading(false);
      }
    }
  }

  function handleSelectBook(token: string) {
    setOpen(false);
    if (token === sessionToken) return;
    router.push(`/resume/${token}`);
  }

  function handleNewBook() {
    setOpen(false);
    router.push("/");
  }

  const otherBooks = books?.filter((b) => b.token !== sessionToken) ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleOpen}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-rose-500 transition-colors font-medium"
      >
        {email ? (
          <>
            <span className="truncate max-w-[140px]">{currentName}</span>
            <svg
              className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </>
        ) : (
          <span>← Change book</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-xl border border-gray-100 shadow-lg z-50 overflow-hidden">
          {/* Current book */}
          <div className="px-3 py-2 bg-rose-50 border-b border-gray-100">
            <p className="text-xs font-semibold text-rose-600">{currentName}</p>
            <p className="text-[10px] text-rose-400">Currently editing</p>
          </div>

          {/* Other books */}
          {loading ? (
            <div className="px-3 py-4 text-center">
              <svg className="w-4 h-4 animate-spin mx-auto text-gray-300" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : otherBooks.length > 0 ? (
            <div className="max-h-48 overflow-y-auto">
              {otherBooks.map((book) => (
                <button
                  key={book.token}
                  onClick={() => handleSelectBook(book.token)}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0"
                >
                  <p className="text-xs font-medium text-gray-700">
                    {book.babyName ? `${book.babyName} — ` : ""}
                    {book.themeName}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {book.photoCount} photo{book.photoCount !== 1 ? "s" : ""}
                  </p>
                </button>
              ))}
            </div>
          ) : books !== null ? (
            <p className="px-3 py-3 text-[10px] text-gray-400">No other books saved yet.</p>
          ) : null}

          {/* Start new book */}
          <button
            onClick={handleNewBook}
            className="w-full text-left px-3 py-2.5 border-t border-gray-100 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
          >
            <span className="text-rose-400 text-sm">+</span>
            <span className="text-xs font-medium text-gray-600">Start a new book</span>
          </button>
        </div>
      )}
    </div>
  );
}
