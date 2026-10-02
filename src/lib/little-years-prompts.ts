import type { BookPrompt, SlotPrompts } from "@/lib/book-prompts";

// Type-only import: book-prompts.ts imports this file's data.

/**
 * Text prompts for The Little Years toddler book (Book Details mode). The
 * same set repeats for Ages One to Five; labels are copied from the printed
 * book. Note keys stay per slot key, so each age keeps its own answers.
 */

const AGES = ["One", "Two", "Three", "Four", "Five"] as const;

const short = (key: string, label: string): BookPrompt => ({ key, label, type: "short" });
const long = (key: string, label: string): BookPrompt => ({ key, label, type: "long" });

const BIRTHDAY: BookPrompt[] = [
  long("who_was_there", "Who was there"),
  short("theme", "Theme"),
  long("you_loved", "You loved"),
  long("presents", "Presents"),
];

// The Boy and Girl books differ in one box: Boy has "Thing to wear", Girl
// has "Game" (checked against the print files for all five ages, 2026-10-02).
const favoriteThings = (third: BookPrompt): BookPrompt[] => [
  short("music", "Music"),
  short("friends", "Friends"),
  third,
  short("food", "Food"),
  short("color", "Color"),
  short("show", "Show"),
  short("book", "Book"),
  short("play_place", "Play place"),
  short("toy", "Toy"),
];

const INTERVIEW: BookPrompt[] = [
  short("grow_up", "When I grow up I want to be"),
  short("thankful", "I am thankful for"),
  short("family_thing", "My favorite thing to do with my family is"),
  short("travel", "Someday I would like to travel to"),
  short("happy", "What makes me happy is"),
  short("favorite_place", "My favorite place to go is"),
  short("buy", "Someday I would like to buy"),
  short("about_me", "My favorite thing about me is"),
  short("play", "I love to play"),
];

const QUOTE: BookPrompt[] = [long("quote", "Quote"), short("date", "Date")];

/** Most quotes a parent can add per age. */
export const LITTLE_YEARS_MAX_QUOTES = 20;

function buildPrompts(favorites: BookPrompt[]): SlotPrompts[] {
  return [
  {
    slotKey: "ly_story",
    section: "ly_intro",
    prompts: [short("story_of", "This is the story of")],
  },
  ...AGES.flatMap((_word, i): SlotPrompts[] => {
    const a = `ly_a${i + 1}`;
    return [
      { slotKey: `${a}_birthday_1`, section: `${a}_birthday`, prompts: BIRTHDAY },
      {
        slotKey: `${a}_favorites`,
        section: `${a}_grown`,
        prompts: favorites,
        standalone: true,
        standaloneLabel: "Favorite Things",
        afterSection: `${a}_grown`,
      },
      {
        slotKey: `${a}_interview`,
        section: `${a}_grown`,
        prompts: INTERVIEW,
        standalone: true,
        standaloneLabel: "An Interview With You",
        afterSection: `${a}_grown`,
      },
      {
        slotKey: `${a}_quotes`,
        section: `${a}_snapshots`,
        prompts: QUOTE,
        repeat: LITTLE_YEARS_MAX_QUOTES,
        standalone: true,
        standaloneLabel: "Your Cutest Quotes",
        afterSection: `${a}_snapshots`,
      },
    ];
  }),
];
}

/** The Boy book's prompts (and the default for The Little Years). */
export const LITTLE_YEARS_PROMPTS = buildPrompts(
  favoriteThings(short("thing_to_wear", "Thing to wear"))
);

/** The Girl book's prompts. */
export const LITTLE_YEARS_GIRL_PROMPTS = buildPrompts(favoriteThings(short("game", "Game")));
