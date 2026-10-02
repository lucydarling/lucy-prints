import { cookies } from "next/headers";
import { HomePage } from "@/components/HomePage";
import { getProductForTheme } from "@/lib/photo-slots";
import { PJ_PREVIEW_COOKIE, isJournalUnlocked } from "@/lib/preview-gate";

/**
 * Home: book picker. Reads the preview cookie on the server so a hidden book
 * never reaches a visitor who hasn't unlocked it, and honours
 * ?book=<product or theme id> by putting that book first.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ book?: string | string[] }>;
}) {
  const [{ book }, jar] = await Promise.all([searchParams, cookies()]);
  const journalVisible = isJournalUnlocked(jar.get(PJ_PREVIEW_COOKIE)?.value);

  const wanted = typeof book === "string" ? book : null;
  const wantedProduct =
    wanted === "pregnancy_journal" || wanted === "memory_book"
      ? wanted
      : getProductForTheme(wanted);
  // A hidden journal falls back to the normal home page, as if no ?book= was given.
  const preselect =
    wantedProduct && (wantedProduct !== "pregnancy_journal" || journalVisible)
      ? wanted
      : null;

  return <HomePage journalVisible={journalVisible} preselect={preselect} />;
}
