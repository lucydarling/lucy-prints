import type { BookThemeId } from "@/lib/photo-slots";

/** Shopify product handle for each book theme (verified in Shopify Admin 2026-10-01). */
export const REVIEW_PRODUCT_HANDLES: Record<BookThemeId, string> = {
  little_artist: "little-artist-memory-baby-book",
  little_animal_lover: "little-animal-lover-memory-baby-book",
  little_captain: "little-captain-memory-baby-book",
  little_camper: "little-camper-memory-baby-book",
  little_beach_babe: "little-beach-babe-memory-baby-book",
  little_rainbow: "little-rainbow-memory-baby-book",
  flower_child: "flower-child-memory-baby-book",
  little_farmer: "little-farmer-baby-memory-book",
  little_goose: "little-goose-baby-memory-book",
  cottage_garden: "cottage-garden-baby-memory-book",
  bowkissed_blush: "bowkissed-blush-baby-memory-book",
  my_first_rodeo: "my-first-rodeo-baby-memory-book",
  honey_bee: "honey-bee-luxury-memory-baby-book",
  teddy_bears_picnic: "teddy-bears-picnic-luxury-memory-baby-book",
  celestial_skies: "celestial-skies-luxury-memory-baby-book",
  wildflower_meadow: "wildflower-meadow-luxury-memory-baby-book",
  golden_blossom: "special-edition-golden-blossom-memory-baby-book",
  golden_stargazer: "special-edition-golden-stargazer-memory-baby-book",
  // One Shopify product ("Pregnancy Memory Book") with both colourways as
  // variants — verified via the Admin API 2026-10-02.
  love_grows_desert_sand: "lucy-darling-pregnancy-journal",
  love_grows_moss_green: "lucy-darling-pregnancy-journal",
  little_years_boy: "the-little-years-toddler-boy-baby-book",
  little_years_girl: "the-little-years-toddler-girl-baby-book",
};

/** Product page + Judge.me reviews section. Contains no personal data. */
export type ReviewSource = "photos_10" | "photos_25" | "after_download";

export function getReviewUrl(themeId: string, source: ReviewSource = "after_download"): string | null {
  const handle = (REVIEW_PRODUCT_HANDLES as Record<string, string | undefined>)[themeId];
  if (!handle) return null;
  return `https://www.lucydarling.com/products/${handle}?utm_source=photo_lab&utm_medium=app&utm_campaign=review_prompt&utm_content=${source}#judgeme_product_reviews`;
}
