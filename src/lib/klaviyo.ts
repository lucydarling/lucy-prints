/**
 * Klaviyo integration for Lucy Darling Photo App (memories.lucydarling.com)
 *
 * Syncs sign-up sessions to Klaviyo profiles so the milestone reminder
 * flow (email + SMS) can fire on the baby's monthly birthdays.
 *
 * Requires: KLAVIYO_API_KEY in .env.local (private API key from
 * Klaviyo → Settings → API Keys → Create Private API Key)
 */

const KLAVIYO_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

function klaviyoHeaders() {
  return {
    Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_API_KEY}`,
    revision: KLAVIYO_REVISION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface KlaviyoSessionData {
  email: string;
  babyName?: string | null;
  babyBirthdate?: string | null; // "YYYY-MM-DD"
  phone?: string | null;
  smsOptIn?: boolean;
  bookTheme?: string | null;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Formats a phone number to E.164 (e.g. "+15555551234").
 * Strips everything except digits, then prepends +1 if 10 digits (US).
 * Returns null if the phone can't be normalized.
 */
function formatPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 7) return `+${digits}`; // international — pass through
  return null;
}

// ─────────────────────────────────────────────
// Core: upsert profile
// ─────────────────────────────────────────────

/**
 * Creates or updates a Klaviyo profile for a photo app sign-up.
 * Call this any time a session is created or key fields (baby_birthdate,
 * phone, sms_opt_in) are updated.
 *
 * Returns the Klaviyo profile ID on success, null on failure.
 * All errors are caught — never throws. Safe to fire-and-forget.
 */
export async function syncProfileToKlaviyo(
  data: KlaviyoSessionData
): Promise<string | null> {
  if (!process.env.KLAVIYO_API_KEY) {
    console.warn("[Klaviyo] KLAVIYO_API_KEY not set — skipping profile sync");
    return null;
  }

  try {
    const attributes: Record<string, unknown> = {
      email: data.email.toLowerCase().trim(),
      properties: {
        baby_name: data.babyName ?? null,
        baby_birthdate: data.babyBirthdate ?? null,
        book_theme: data.bookTheme ?? null,
        photo_app_signup: true,
        sms_consent: data.smsOptIn ?? false,
        source: "memories_app",
      },
    };

    // Add phone if present and valid
    const formattedPhone = data.phone ? formatPhone(data.phone) : null;
    if (formattedPhone) {
      attributes.phone_number = formattedPhone;
    }

    const res = await fetch(`${KLAVIYO_BASE}/profiles/`, {
      method: "POST",
      headers: klaviyoHeaders(),
      body: JSON.stringify({
        data: {
          type: "profile",
          attributes,
        },
      }),
    });

    // 201 = created, 200 = updated (Klaviyo upserts automatically)
    if (res.status === 201 || res.status === 200) {
      const json = await res.json();
      const profileId: string = json?.data?.id;

      // Subscribe to SMS if opted in and phone is valid
      if (data.smsOptIn && formattedPhone) {
        await subscribeToSms(data.email, formattedPhone);
      }

      return profileId ?? null;
    }

    // 409 = duplicate — Klaviyo returns the existing profile ID
    if (res.status === 409) {
      const json = await res.json();
      const profileId: string =
        json?.errors?.[0]?.meta?.duplicate_profile_id ?? null;

      if (profileId) {
        // Patch the existing profile with updated properties
        await patchProfile(profileId, attributes);

        if (data.smsOptIn && formattedPhone) {
          await subscribeToSms(data.email, formattedPhone);
        }
      }

      return profileId ?? null;
    }

    const errorText = await res.text().catch(() => "");
    console.error(`[Klaviyo] Profile sync failed (${res.status}):`, errorText);
    return null;
  } catch (err) {
    console.error("[Klaviyo] Profile sync error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────
// Patch existing profile
// ─────────────────────────────────────────────

async function patchProfile(
  profileId: string,
  attributes: Record<string, unknown>
): Promise<void> {
  try {
    const res = await fetch(`${KLAVIYO_BASE}/profiles/${profileId}/`, {
      method: "PATCH",
      headers: klaviyoHeaders(),
      body: JSON.stringify({
        data: {
          type: "profile",
          id: profileId,
          attributes,
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error(`[Klaviyo] Profile patch failed (${res.status}):`, errorText);
    }
  } catch (err) {
    console.error("[Klaviyo] Profile patch error:", err);
  }
}

// ─────────────────────────────────────────────
// SMS consent subscription
// ─────────────────────────────────────────────

/**
 * Subscribes a profile to SMS marketing in Klaviyo.
 * Requires the Klaviyo account to have SMS enabled.
 */
async function subscribeToSms(email: string, phoneNumber: string): Promise<void> {
  try {
    const listId = process.env.KLAVIYO_SMS_LIST_ID;
    if (!listId) {
      console.warn("[Klaviyo] KLAVIYO_SMS_LIST_ID not set — skipping SMS subscription");
      return;
    }

    const res = await fetch(
      `${KLAVIYO_BASE}/profile-subscription-bulk-create-jobs/`,
      {
        method: "POST",
        headers: klaviyoHeaders(),
        body: JSON.stringify({
          data: {
            type: "profile-subscription-bulk-create-job",
            attributes: {
              profiles: {
                data: [
                  {
                    type: "profile",
                    attributes: {
                      email: email.toLowerCase().trim(),
                      phone_number: phoneNumber,
                      subscriptions: {
                        sms: {
                          marketing: {
                            consent: "SUBSCRIBED",
                          },
                        },
                      },
                    },
                  },
                ],
              },
              historical_import: false,
            },
            relationships: {
              list: {
                data: {
                  type: "list",
                  id: listId,
                },
              },
            },
          },
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error(`[Klaviyo] SMS subscription failed (${res.status}):`, errorText);
    }
  } catch (err) {
    console.error("[Klaviyo] SMS subscription error:", err);
  }
}

// ─────────────────────────────────────────────
// Email list subscription
// ─────────────────────────────────────────────

/**
 * Subscribes a profile to the photo app email list in Klaviyo.
 * This also adds them to the milestone reminder flow.
 */
export async function subscribeToEmailList(email: string): Promise<void> {
  try {
    const listId = process.env.KLAVIYO_PHOTO_APP_LIST_ID;
    if (!listId) {
      console.warn("[Klaviyo] KLAVIYO_PHOTO_APP_LIST_ID not set — skipping email list subscription");
      return;
    }

    const res = await fetch(
      `${KLAVIYO_BASE}/profile-subscription-bulk-create-jobs/`,
      {
        method: "POST",
        headers: klaviyoHeaders(),
        body: JSON.stringify({
          data: {
            type: "profile-subscription-bulk-create-job",
            attributes: {
              profiles: {
                data: [
                  {
                    type: "profile",
                    attributes: {
                      email: email.toLowerCase().trim(),
                      subscriptions: {
                        email: {
                          marketing: {
                            consent: "SUBSCRIBED",
                          },
                        },
                      },
                    },
                  },
                ],
              },
              historical_import: false,
            },
            relationships: {
              list: {
                data: {
                  type: "list",
                  id: listId,
                },
              },
            },
          },
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error(`[Klaviyo] Email list subscription failed (${res.status}):`, errorText);
    }
  } catch (err) {
    console.error("[Klaviyo] Email list subscription error:", err);
  }
}

// ─────────────────────────────────────────────
// Track sign-up event (triggers the milestone flow)
// ─────────────────────────────────────────────

/**
 * Fires a "Photo App Signup" event in Klaviyo.
 * This event is the trigger for the monthly milestone reminder flow.
 * Should be called once per session — when the session is first created
 * with a baby birthdate.
 *
 * All errors are caught — never throws.
 */
export async function trackPhotoAppSignup(
  data: KlaviyoSessionData & { sessionToken: string }
): Promise<void> {
  if (!process.env.KLAVIYO_API_KEY) {
    console.warn("[Klaviyo] KLAVIYO_API_KEY not set — skipping event track");
    return;
  }

  if (!data.babyBirthdate) {
    // Don't fire the event until we have a birthdate — it's required for
    // the milestone flow's date-based delays.
    return;
  }

  try {
    const res = await fetch(`${KLAVIYO_BASE}/events/`, {
      method: "POST",
      headers: klaviyoHeaders(),
      body: JSON.stringify({
        data: {
          type: "event",
          attributes: {
            metric: {
              data: {
                type: "metric",
                attributes: {
                  name: "Photo App Signup",
                },
              },
            },
            profile: {
              data: {
                type: "profile",
                attributes: {
                  email: data.email.toLowerCase().trim(),
                },
              },
            },
            properties: {
              baby_name: data.babyName ?? null,
              baby_birthdate: data.babyBirthdate,
              book_theme: data.bookTheme ?? null,
              sms_opt_in: data.smsOptIn ?? false,
              session_token: data.sessionToken,
              source: "memories_app",
            },
            time: new Date().toISOString(),
          },
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error(`[Klaviyo] Event track failed (${res.status}):`, errorText);
    }
  } catch (err) {
    console.error("[Klaviyo] Event track error:", err);
  }
}
