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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Real Klaviyo marketing-consent values for a channel, as returned by
 * GET /api/profiles/?additional-fields[profile]=subscriptions. "UNKNOWN"
 * is our own sentinel for "couldn't determine" (e.g. lookup failed).
 */
export type ConsentStatus =
  | "SUBSCRIBED"
  | "PENDING"
  | "UNSUBSCRIBED"
  | "NEVER_SUBSCRIBED"
  | "NOT_ATTEMPTED"
  | "UNKNOWN";

export interface SubscribeResult {
  success: boolean;
  consentStatus: ConsentStatus;
  error?: string;
}

export interface KlaviyoSyncResult {
  profileId: string | null;
  smsSubscribed: boolean;
  smsConsentStatus: ConsentStatus;
  smsError?: string;
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

/**
 * Fetches a profile's real current marketing-consent value for a channel,
 * along with whether Klaviyo will actually deliver to it. A profile can
 * show consent "SUBSCRIBED" from a stale/unrelated past event while being
 * globally suppressed (bounce, spam complaint, manual suppression) — in
 * that case `can_receive` is false and it is NOT a real active subscriber,
 * regardless of what the consent enum alone says.
 * Returns null if the profile can't be found or the lookup fails.
 */
async function fetchProfileConsent(
  email: string,
  channel: "email" | "sms"
): Promise<{ consent: ConsentStatus; canReceive: boolean } | null> {
  try {
    const filter = `equals(email,"${email.toLowerCase().trim()}")`;
    const url = `${KLAVIYO_BASE}/profiles/?filter=${encodeURIComponent(filter)}&additional-fields[profile]=subscriptions`;
    const res = await fetch(url, { headers: klaviyoHeaders() });
    if (!res.ok) return null;

    const json = await res.json();
    const marketing = json?.data?.[0]?.attributes?.subscriptions?.[channel]?.marketing;
    const consent = marketing?.consent;
    if (
      consent === "SUBSCRIBED" ||
      consent === "PENDING" ||
      consent === "UNSUBSCRIBED" ||
      consent === "NEVER_SUBSCRIBED"
    ) {
      const canReceive: boolean =
        channel === "email"
          ? Boolean(marketing?.can_receive_email_marketing)
          : Boolean(marketing?.can_receive_sms_marketing);
      return { consent, canReceive };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Polls a profile's real subscription state for a channel, up to ~10s with
 * exponential backoff, after enqueueing a bulk-subscribe job.
 *
 * The enqueue endpoint (profile-subscription-bulk-create-jobs) returns 202
 * with an empty body and NO job id or Location header — Klaviyo gives no
 * way to poll that job directly, and a non-2xx enqueue response (bad list
 * ID, revoked scope, malformed payload) IS returned synchronously and is
 * handled by the caller before this ever runs. What this function confirms
 * is the real downstream state, instead of trusting "202 accepted" as if it
 * meant "subscribed".
 *
 * Success requires BOTH consent === "SUBSCRIBED" AND can_receive_*_marketing
 * === true — a suppressed profile (bounce, spam complaint, manual
 * suppression) can show a stale "SUBSCRIBED" consent from an unrelated past
 * event while being unable to actually receive anything, and that must not
 * be reported as a real subscriber.
 *
 * Verified live: for a double opt-in list, Klaviyo sends the confirmation
 * email/SMS immediately, but the profile's `consent` field can stay
 * "NEVER_SUBSCRIBED" for well over a minute afterward before flipping to
 * "PENDING" — the read API lags the real action. So a NEVER_SUBSCRIBED
 * result at the end of this short poll is NOT treated as an error; it's
 * reported as-is (success: false) so callers see the real, current Klaviyo
 * state without us fabricating a false "failed" verdict. `last_sync_error`
 * is reserved for cases where we couldn't even determine the profile's
 * state (lookup itself failed).
 */
async function pollProfileConsent(
  email: string,
  channel: "email" | "sms",
  maxWaitMs = 10000
): Promise<SubscribeResult> {
  const start = Date.now();
  let delay = 1000;
  let lastConsent: ConsentStatus = "UNKNOWN";

  while (Date.now() - start < maxWaitMs) {
    await sleep(delay);

    const result = await fetchProfileConsent(email, channel);
    if (result) {
      lastConsent = result.consent;
      if (result.consent === "SUBSCRIBED") {
        return result.canReceive
          ? { success: true, consentStatus: result.consent }
          : {
              success: false,
              consentStatus: result.consent,
              error: `Profile shows consent SUBSCRIBED but is suppressed (can_receive_${channel}_marketing is false)`,
            };
      }
      if (result.consent === "PENDING" || result.consent === "UNSUBSCRIBED") {
        return { success: false, consentStatus: result.consent };
      }
      // NEVER_SUBSCRIBED — Klaviyo's read API can lag the real action by
      // more than this poll window (verified live); keep polling briefly,
      // but don't treat this as an error below.
    }

    delay = Math.min(delay * 2, 3000);
  }

  // lastConsent === "UNKNOWN" here means every lookup attempt failed — we
  // genuinely couldn't verify anything, which IS a real sync error. A
  // lastConsent of "NEVER_SUBSCRIBED" just means Klaviyo hasn't reflected
  // the change in the read API yet within our window; that's expected async
  // lag, not a failure, so it is reported as-is with no error attached.
  return {
    success: false,
    consentStatus: lastConsent,
    error:
      lastConsent === "UNKNOWN"
        ? `Could not verify ${channel} subscription status within ${maxWaitMs}ms (profile lookup failed)`
        : undefined,
  };
}

// ─────────────────────────────────────────────
// Core: upsert profile
// ─────────────────────────────────────────────

/**
 * Creates or updates a Klaviyo profile for a photo app sign-up, and — if
 * SMS opt-in was requested — attempts the real SMS subscription and
 * confirms it completed before reporting success.
 *
 * The `sms_consent` profile property is only ever written `true` after a
 * confirmed subscription; otherwise it is written `false`. It is never
 * set from opt-in intent alone.
 *
 * Never throws — all errors are captured in the returned result.
 */
export async function syncProfileToKlaviyo(
  data: KlaviyoSessionData
): Promise<KlaviyoSyncResult> {
  if (!process.env.KLAVIYO_API_KEY) {
    console.warn("[Klaviyo] KLAVIYO_API_KEY not set — skipping profile sync");
    return {
      profileId: null,
      smsSubscribed: false,
      smsConsentStatus: "UNKNOWN",
      smsError: "KLAVIYO_API_KEY not set",
    };
  }

  const formattedPhone = data.phone ? formatPhone(data.phone) : null;
  const willAttemptSms = Boolean(data.smsOptIn && formattedPhone);

  // Baseline properties — sms_consent starts false and is only flipped to
  // true after subscribeToSms() confirms the job actually completed.
  const attributes: Record<string, unknown> = {
    email: data.email.toLowerCase().trim(),
    properties: {
      baby_name: data.babyName ?? null,
      baby_birthdate: data.babyBirthdate ?? null,
      book_theme: data.bookTheme ?? null,
      photo_app_signup: true,
      sms_consent: false,
      source: "memories_app",
    },
  };

  if (formattedPhone) {
    attributes.phone_number = formattedPhone;
  }

  try {
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

    let profileId: string | null = null;

    // 201 = created, 200 = updated (Klaviyo upserts automatically)
    if (res.status === 201 || res.status === 200) {
      const json = await res.json();
      profileId = json?.data?.id ?? null;
    } else if (res.status === 409) {
      // 409 = duplicate — Klaviyo returns the existing profile ID
      const json = await res.json();
      profileId = json?.errors?.[0]?.meta?.duplicate_profile_id ?? null;
      if (profileId) {
        await patchProfile(profileId, attributes);
      }
    } else {
      const errorText = await res.text().catch(() => "");
      console.error(`[Klaviyo] Profile sync failed (${res.status}):`, errorText);
      return {
        profileId: null,
        smsSubscribed: false,
        smsConsentStatus: "UNKNOWN",
        smsError: `Profile sync failed (${res.status}): ${errorText}`,
      };
    }

    if (!willAttemptSms) {
      return { profileId, smsSubscribed: false, smsConsentStatus: "NOT_ATTEMPTED" };
    }

    const smsResult = await subscribeToSms(data.email, formattedPhone as string);

    // Only now do we know the real outcome — flip the property if confirmed.
    if (smsResult.success && profileId) {
      await patchProfile(profileId, {
        properties: { sms_consent: true },
      });
    }

    return {
      profileId,
      smsSubscribed: smsResult.success,
      smsConsentStatus: smsResult.consentStatus,
      smsError: smsResult.error,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Klaviyo] Profile sync error:", msg);
    return { profileId: null, smsSubscribed: false, smsConsentStatus: "UNKNOWN", smsError: msg };
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
 * Subscribes a profile to SMS marketing in Klaviyo, then re-fetches the
 * profile's real consent state to confirm the outcome rather than trusting
 * the enqueue response.
 */
async function subscribeToSms(
  email: string,
  phoneNumber: string
): Promise<SubscribeResult> {
  try {
    const listId = process.env.KLAVIYO_SMS_LIST_ID;
    if (!listId) {
      const msg = "KLAVIYO_SMS_LIST_ID not set";
      console.warn(`[Klaviyo] ${msg} — skipping SMS subscription`);
      return { success: false, consentStatus: "UNKNOWN", error: msg };
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
      const msg = `SMS subscription enqueue failed (${res.status}): ${errorText}`;
      console.error(`[Klaviyo] ${msg}`);
      return { success: false, consentStatus: "UNKNOWN", error: msg };
    }

    return await pollProfileConsent(email, "sms");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Klaviyo] SMS subscription error:", msg);
    return { success: false, consentStatus: "UNKNOWN", error: msg };
  }
}

// ─────────────────────────────────────────────
// Email list subscription
// ─────────────────────────────────────────────

/**
 * Subscribes a profile to the photo app email list in Klaviyo, then
 * re-fetches the profile's real consent state to confirm the outcome
 * rather than trusting the enqueue response.
 */
export async function subscribeToEmailList(email: string): Promise<SubscribeResult> {
  try {
    const listId = process.env.KLAVIYO_PHOTO_APP_LIST_ID;
    if (!listId) {
      const msg = "KLAVIYO_PHOTO_APP_LIST_ID not set";
      console.warn(`[Klaviyo] ${msg} — skipping email list subscription`);
      return { success: false, consentStatus: "UNKNOWN", error: msg };
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
      const msg = `Email list subscription enqueue failed (${res.status}): ${errorText}`;
      console.error(`[Klaviyo] ${msg}`);
      return { success: false, consentStatus: "UNKNOWN", error: msg };
    }

    return await pollProfileConsent(email, "email");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Klaviyo] Email list subscription error:", msg);
    return { success: false, consentStatus: "UNKNOWN", error: msg };
  }
}

// ─────────────────────────────────────────────
// Sync status persistence helper
// ─────────────────────────────────────────────

export interface KlaviyoSyncStatus {
  sms_subscribed: boolean;
  sms_consent_status: ConsentStatus;
  email_subscribed: boolean;
  email_consent_status: ConsentStatus;
  last_sync_error: string | null;
  last_synced_at: string;
}

/**
 * Combines the profile/SMS sync result and the email list subscribe result
 * into a single record so callers can persist real outcomes (not just
 * enqueue responses) to a queryable column instead of only console.error.
 *
 * `*_subscribed` is true only when Klaviyo confirms SUBSCRIBED. PENDING
 * (double opt-in confirmation sent, awaiting the customer) and UNSUBSCRIBED
 * are real, non-error terminal states — they are NOT folded into
 * last_sync_error, which is reserved for cases where the attempt had no
 * visible effect at all or the API call itself failed.
 */
export function buildSyncStatus(
  klaviyoResult: KlaviyoSyncResult,
  emailResult: SubscribeResult
): KlaviyoSyncStatus {
  return {
    sms_subscribed: klaviyoResult.smsSubscribed,
    sms_consent_status: klaviyoResult.smsConsentStatus,
    email_subscribed: emailResult.success,
    email_consent_status: emailResult.consentStatus,
    last_sync_error:
      [klaviyoResult.smsError, emailResult.error].filter(Boolean).join(" | ") || null,
    last_synced_at: new Date().toISOString(),
  };
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
