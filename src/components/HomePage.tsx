"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePhotoStore } from "@/store/photo-store";
import {
  BOOK_THEMES,
  PRODUCTS,
  getBookProgress,
  getProductForTheme,
  type ProductType,
} from "@/lib/photo-slots";
import { openBook } from "@/lib/open-book";
import { resolveInitialProduct, visibleProducts } from "@/lib/home-picker";
import { OnboardingModal } from "@/components/OnboardingModal";

export function HomePage({
  unlockedBooks,
  preselect,
}: {
  /**
   * Hidden books this visitor may see (public, or unlocked by a preview
   * link): "pregnancy_journal", "little_years". Empty for most visitors.
   */
  unlockedBooks: ProductType[];
  /** ?book= — a product ("pregnancy_journal") or theme id to put first and highlight. */
  preselect: string | null;
}) {
  const bookTheme = usePhotoStore((s) => s.bookTheme);
  const router = useRouter();
  // Multi-book mode: any hidden book this visitor can see. Otherwise the page
  // is the single-book memory book page, exactly as before.
  const multiBook = unlockedBooks.length > 0;
  const [selectedProduct, setSelectedProduct] = useState<ProductType>(() =>
    resolveInitialProduct(preselect, unlockedBooks)
  );

  const [showFindBooks, setShowFindBooks] = useState(false);
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError("");
    setEmailSent(false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lookupEmail)) {
      setLookupError("Enter a valid email address.");
      return;
    }
    setLookupLoading(true);
    try {
      // Never return session tokens to the page. Email the resume links to the
      // address on file instead — the response is neutral and never reveals
      // whether any books exist for that email.
      await fetch("/api/my-books-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: lookupEmail }),
      });
      setEmailSent(true);
    } catch {
      setLookupError("Something went wrong. Please try again.");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleSelect = (themeId: string) => {
    openBook(themeId);
    router.push("/upload");
  };

  const hasExisting = bookTheme !== null;
  // Tile click: swap Step 2 and keep ?book= in step so reload / share keeps the choice.
  const selectProduct = (product: ProductType) => {
    setSelectedProduct(product);
    router.replace(`/?book=${product}`, { scroll: false });
  };

  const coverGrid = multiBook
    ? "grid grid-cols-2 sm:grid-cols-3 gap-3"
    : "grid grid-cols-1 sm:grid-cols-2 gap-3";

  const coversFor = (tier: string) =>
    BOOK_THEMES.filter((t) => t.tier === tier).map((theme) => (
      <ThemeCard
        key={theme.id}
        theme={theme}
        onSelect={handleSelect}
        luxury={tier === "luxury"}
        retiring={tier === "retiring"}
        highlighted={preselect === theme.id}
      />
    ));

  // The memory book's three groups; the same in single- and multi-book mode.
  const memoryBookCovers = (
    <>
      {/* Standard Memory Books */}
      <div className={coverGrid}>{coversFor("standard")}</div>

      {/* Luxury Memory Books */}
      <h3 className="text-sm font-semibold text-gray-700 mt-6 mb-3">Luxury Collection</h3>
      <div className={coverGrid}>{coversFor("luxury")}</div>

      {/* Retiring titles */}
      <h3 className="text-sm font-semibold text-gray-400 mt-6 mb-1">Limited Availability</h3>
      <p className="text-xs text-gray-400 mb-3">
        These titles are being retired — available while supplies last.
      </p>
      <div className={coverGrid}>{coversFor("retiring")}</div>
    </>
  );

  const howItWorks = (
    <div className="mb-6 p-4 rounded-xl bg-white border border-gray-100">
      <h3 className="text-sm font-semibold text-gray-800 mb-2">How it works</h3>
      <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
        {/* DRAFT multi-book copy — pending Haily. */}
        <li>{multiBook ? "Pick your book, then which style" : "Select your memory book theme below"}</li>
        <li>Upload photos — we&apos;ll tell you exactly which ones you need</li>
        <li>Crop each photo to the perfect size</li>
        <li>Download your ready-to-print photos</li>
        <li>Print at home or any photo lab, then add them to your book</li>
      </ol>
      <p className="text-xs text-rose-600 mt-3">Direct print ordering is on its way.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <OnboardingModal bookWord={bookWordFor(multiBook ? selectedProduct : "memory_book")} />

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
          <p className="text-sm font-medium mt-2 text-rose-600">Photo Lab</p>
          <p className="text-sm text-gray-500 mt-3 max-w-md mx-auto">
            {/* DRAFT multi-book copy — pending Haily. */}
            {multiBook
              ? "Get your photos perfectly sized for every page of your Lucy Darling book — then print at home or at any photo lab."
              : "Get your photos perfectly sized for every page of your memory book — then print at home or at any photo lab."}
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
                  onClick={() => { setShowFindBooks(false); setEmailSent(false); setLookupError(""); }}
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

              {emailSent && (
                <p className="text-xs text-gray-500 mt-3">
                  If we found books for that email, we&apos;ve sent the links to your inbox.
                </p>
              )}
            </div>
          )}
        </div>

        {multiBook ? (
          <>
            <BookTiles
              products={visibleProducts(unlockedBooks)}
              selected={selectedProduct}
              onSelect={selectProduct}
            />
            <div className="mt-8">
              <Eyebrow>Step 2</Eyebrow>
              {/* DRAFT copy — pending Haily. */}
              <h2 className="text-base font-semibold text-gray-800">
                {STEP2[selectedProduct].heading}
              </h2>
              <p className="text-xs text-gray-500 mt-1 mb-4">{STEP2[selectedProduct].helper}</p>
              {selectedProduct === "memory_book" ? (
                memoryBookCovers
              ) : (
                <div className={coverGrid}>
                  {coversFor(selectedProduct === "pregnancy_journal" ? "journal" : "little_years")}
                </div>
              )}
            </div>
            <div className="mt-8">{howItWorks}</div>
          </>
        ) : (
          <>
            {howItWorks}

            {/* Theme selection */}
            <h2 className="text-base font-semibold text-gray-800 mb-3">
              {hasExisting ? "Start a New Book" : "Choose Your Book"}
            </h2>
            {memoryBookCovers}
          </>
        )}
      </div>
    </div>
  );
}

const STEP2: Record<ProductType, { heading: string; helper: string }> = {
  memory_book: {
    heading: "Find your cover",
    helper: "Pick the design on the front of your memory book.",
  },
  pregnancy_journal: {
    heading: "Pick your cover color",
    helper: "Your Love Grows journal comes in two colors.",
  },
  little_years: {
    heading: "Pick your edition",
    helper: "The Little Years comes in a Boy and a Girl edition.",
  },
};

// DRAFT copy — pending Haily.
const TILES: Record<ProductType, { name: string; descriptor: string; image: string }> = {
  pregnancy_journal: {
    name: "Pregnancy Journal",
    descriptor: "Love Grows · Pregnancy Journal",
    image: "love_grows_desert_sand",
  },
  memory_book: {
    name: "Baby Memory Book",
    descriptor: "Baby\u2019s first year",
    image: "little_camper",
  },
  little_years: {
    name: "The Little Years",
    descriptor: "Toddler book · ages 1\u20135",
    image: "little_years_boy",
  },
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-rose-600 mb-1">{children}</p>
  );
}

/** Step 1: which book are you filling? One tile per book this visitor can see. */
function BookTiles({
  products,
  selected,
  onSelect,
}: {
  products: ProductType[];
  selected: ProductType;
  onSelect: (product: ProductType) => void;
}) {
  return (
    <div>
      <Eyebrow>Step 1</Eyebrow>
      {/* DRAFT copy — pending Haily. */}
      <h2 className="text-base font-semibold text-gray-800 mb-3">Which book are you filling?</h2>
      <div className="grid grid-cols-3 gap-2.5">
        {products.map((product) => {
          const tile = TILES[product];
          const isSelected = product === selected;
          // Any theme of the product has the same slot total.
          const firstTheme = BOOK_THEMES.find((t) => t.product === product);
          const count = firstTheme ? getBookProgress(firstTheme.id, {}).total : 0;
          return (
            <button
              key={product}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(product)}
              className={`relative flex flex-col rounded-xl overflow-hidden border text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 ${
                isSelected
                  ? "border-rose-500 ring-1 ring-rose-500 bg-rose-50"
                  : "border-gray-200 hover:border-rose-200 bg-white"
              }`}
            >
              <div className="relative aspect-square w-full bg-gray-50">
                <Image
                  src={`/covers/${tile.image}.jpg`}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="(max-width: 672px) 33vw, 220px"
                />
                {isSelected && (
                  <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                )}
              </div>
              <div className="p-2">
                <p className="text-sm font-semibold leading-snug text-gray-800">{tile.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{tile.descriptor}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {count} {PRODUCTS[product].progressUnit}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function bookWordFor(product: ProductType): string {
  if (product === "pregnancy_journal") return "pregnancy journal";
  if (product === "little_years") return "Little Years book";
  return "memory book";
}

function ThemeCard({
  theme,
  onSelect,
  luxury,
  retiring,
  highlighted,
}: {
  theme: (typeof BOOK_THEMES)[number];
  onSelect: (id: string) => void;
  luxury?: boolean;
  retiring?: boolean;
  /** Picked by ?book= — ringed so it stands out. */
  highlighted?: boolean;
}) {
  const product = getProductForTheme(theme.id) ?? "memory_book";
  return (
    <button
      onClick={() => onSelect(theme.id)}
      className={`group relative rounded-xl overflow-hidden border transition-all text-left ${
        highlighted ? "ring-2 ring-rose-400 ring-offset-2 " : ""
      }${
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
          {/* Journal and Little Years cards sit under their book's heading —
              show just the variant (cover color, Boy/Girl). */}
          {product !== "memory_book"
            ? theme.name.replace(/^.*\((.*)\)$/, "$1")
            : theme.name}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {getBookProgress(theme.id, {}).total} {PRODUCTS[product].progressUnit}
        </p>
      </div>
    </button>
  );
}
