import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { profileProperties, syncProfileToKlaviyo } from "@/lib/klaviyo";

/**
 * A fake Klaviyo profiles API with the real semantics that matter here:
 * POST /profiles/ creates (201) or, for a known email, answers 409 with the
 * existing id; PATCH /profiles/{id}/ overwrites each property it is given —
 * INCLUDING null, which is how a blank re-save used to wipe a profile.
 */
type Profile = { id: string; email: string; properties: Record<string, unknown> };
let profiles: Map<string, Profile>;

beforeEach(() => {
  profiles = new Map();
  process.env.KLAVIYO_API_KEY = "test-key";
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

    if (url.endsWith("/profiles/") && init?.method === "POST") {
      const attrs = body.data.attributes;
      const existing = [...profiles.values()].find((p) => p.email === attrs.email);
      if (existing) {
        return json(409, { errors: [{ meta: { duplicate_profile_id: existing.id } }] });
      }
      const id = `p${profiles.size + 1}`;
      profiles.set(id, { id, email: attrs.email, properties: { ...attrs.properties } });
      return json(201, { data: { id } });
    }
    const patch = url.match(/\/profiles\/([^/]+)\/$/);
    if (patch && init?.method === "PATCH") {
      const p = profiles.get(patch[1])!;
      Object.assign(p.properties, body.data.attributes.properties ?? {});
      return json(200, { data: { id: p.id } });
    }
    return json(200, {});
  }) as typeof fetch;
});

const EMAIL = "parent@example.com";
const props = () => [...profiles.values()][0].properties;

test("a re-save with empty name and birthday keeps the profile's values", async () => {
  await syncProfileToKlaviyo({
    email: EMAIL, babyName: "Emma", babyBirthdate: "2026-09-01", bookTheme: "little_goose",
  });
  assert.equal(props().baby_name, "Emma");
  assert.equal(props().baby_birthdate, "2026-09-01");

  // Resume link / new device / second book: name and birthday left blank.
  for (const blank of [undefined, null, "", "   "]) {
    await syncProfileToKlaviyo({ email: EMAIL, babyName: blank, babyBirthdate: blank, bookTheme: "little_goose" });
    assert.equal(props().baby_name, "Emma", `baby_name wiped by ${JSON.stringify(blank)}`);
    assert.equal(props().baby_birthdate, "2026-09-01", `baby_birthdate wiped by ${JSON.stringify(blank)}`);
  }
});

test("a re-save with new values still updates them", async () => {
  await syncProfileToKlaviyo({ email: EMAIL, babyName: "Emma", babyBirthdate: "2026-09-01", bookTheme: "little_goose" });
  await syncProfileToKlaviyo({ email: EMAIL, babyName: "Emma Rose", babyBirthdate: "2026-09-02", bookTheme: "little_camper" });
  assert.equal(props().baby_name, "Emma Rose");
  assert.equal(props().baby_birthdate, "2026-09-02");
  assert.equal(props().book_theme, "little_camper");
});

test("a re-save without SMS doesn't reset a confirmed sms_consent", async () => {
  await syncProfileToKlaviyo({ email: EMAIL, babyName: "Emma", bookTheme: "little_goose" });
  assert.equal(props().sms_consent, false); // new profile starts false
  props().sms_consent = true; // as set after a confirmed SMS subscription
  await syncProfileToKlaviyo({ email: EMAIL, bookTheme: "little_goose", smsOptIn: false });
  assert.equal(props().sms_consent, true);
});

test("no property is ever sent as null", () => {
  const p = profileProperties({ email: EMAIL, babyName: null, babyBirthdate: "", bookTheme: undefined });
  assert.deepEqual(p, { photo_app_signup: true, source: "memories_app" });
  assert.ok(!Object.values(p).some((v) => v === null));
});
