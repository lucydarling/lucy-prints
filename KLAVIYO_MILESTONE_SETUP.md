# Klaviyo Milestone Reminder Flow — Setup Guide

This guide walks you through setting up the monthly milestone email + SMS reminder system for the Lucy Darling Photo App (memories.lucydarling.com).

**What it does:** When a parent signs up and enters their baby's birth date, Klaviyo automatically sends them a reminder each month (months 1–12) prompting them to take their milestone photo and upload it to their book.

---

## Step 1: Add your Klaviyo API key to Vercel

1. Go to [Klaviyo → Settings → API Keys](https://www.klaviyo.com/settings/account/api-keys)
2. Click **Create Private API Key** → give it a name like "Photo App"
3. Set scope to **Full Access** (or at minimum: Profiles read/write, Events write, Lists read/write, Subscriptions write)
4. Copy the key
5. In your Vercel project settings (lucy-prints), go to **Environment Variables** and add:
   - `KLAVIYO_API_KEY` = your private key
   - `KLAVIYO_PHOTO_APP_LIST_ID` = (you'll get this in Step 2)
   - `KLAVIYO_SMS_LIST_ID` = (you'll get this in Step 2)

Also add these same keys to `.env.local` for local development.

---

## Step 2: Create the lists in Klaviyo

### Email list
1. Go to **Lists & Segments** → **Create List**
2. Name it: **Photo App Sign-Ups**
3. Copy the list ID (from the URL or list settings)
4. Paste it as `KLAVIYO_PHOTO_APP_LIST_ID` in your env vars

### SMS list (if using SMS)
1. Go to **Lists & Segments** → **Create List**
2. Name it: **Photo App SMS**
3. Copy the list ID
4. Paste it as `KLAVIYO_SMS_LIST_ID` in your env vars

> You can use the same list for both email and SMS if you prefer — just set both env vars to the same list ID.

---

## Step 3: Build the milestone reminder flow

This flow fires once per sign-up and sends 12 monthly reminder messages timed to the baby's actual birth date.

### 3a. Create the flow

1. Go to **Flows** → **Create Flow** → **Create from Scratch**
2. Name it: **Monthly Milestone Reminders — Photo App**
3. **Trigger:** Metric → select **Photo App Signup**
4. Click **Done**

### 3b. Set flow filters

In the flow trigger settings, add a **Flow Filter**:
- `Properties > baby_birthdate` **is set** (not empty)

This ensures the flow only runs when we have a valid birth date to calculate from.

### 3c. Build the 12 milestone steps

For each month (1–12), add a pair of blocks: **Time Delay** → **Email** (+ optional **SMS**).

**Pattern for each month:**

```
[Time Delay] Wait until: baby_birthdate + N months
[Email]      Month N milestone reminder
[SMS]        Month N milestone reminder (conditional on sms_consent = true)
```

**To add a time delay based on the birthdate:**
1. Click **+** → **Time Delay**
2. Choose **Wait until a specific date**
3. Set the date to: `Event Properties > baby_birthdate` + N months
   - Klaviyo calls this a "Date Relative Delay" — select the `baby_birthdate` event property and add N months offset

> **Note:** Klaviyo's date-relative delays are available on Growth and above plans. If your plan doesn't support this, use an absolute day delay instead (30 days for month 1, 60 for month 2, etc.).

**Fallback if date-relative delays aren't available:**
Use fixed delays: 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 365 days after the flow trigger.

---

## Step 4: Email templates (one per month)

Each monthly email should follow this structure. Customize subject line and body per month.

### Subject line examples
- Month 1: `{{event.properties.baby_name|default:"Your baby"}} is 1 month old today 🎉`
- Month 3: `3 months already — don't forget the milestone photo!`
- Month 6: `Halfway through the first year — capture month 6!`
- Month 12: `One whole year. Don't miss the last milestone photo.`

### Email body template

```
Hi there,

[Baby's name] is [N] month(s) old today — time for the monthly milestone photo!

This is one of the 12 monthly photos in your Lucy Darling memory book.
Snap it now while they're this age, then upload it to your book at:

👉 [CTA Button: Add My Month N Photo] → link to memories.lucydarling.com

These are the moments you'll want preserved. Don't let this one slip by.

– The Lucy Darling team
```

**Personalization tokens (Klaviyo syntax):**
- `{{ event.properties.baby_name | default: "Your baby" }}` — baby's name
- `{{ event.properties.baby_birthdate }}` — birth date
- `{{ event.properties.book_theme }}` — book theme (for personalized imagery)

---

## Step 5: SMS templates (optional, for opted-in users)

For each SMS step, add a **Conditional Split** before the SMS block:
- Condition: `Profile Properties > sms_consent` **equals** `true`
- If YES → send SMS
- If NO → skip

**SMS character limit:** ~160 characters per segment. Keep it short.

### SMS examples
- Month 1: `[Name] is 1 month old today! Add your milestone photo to your memory book: memories.lucydarling.com/resume/{{ event.properties.session_token }}`
- Month 6: `Half a year already! Don't forget month 6 in [Name]'s book: memories.lucydarling.com`
- Month 12: `One year!! Add the final monthly milestone photo to [Name]'s book: memories.lucydarling.com`

> **SMS compliance:** Klaviyo handles opt-out (STOP) automatically. Make sure your Klaviyo account has a verified sending number before enabling SMS flows.

---

## Step 6: Activate the flow

1. Review all 12 email (and optional SMS) steps
2. Set each step from **Draft** to **Live**
3. Set the flow status to **Live**

---

## How it all connects

```
User signs up at memories.lucydarling.com
         │
         ▼
App creates session in Supabase (email, baby_name, baby_birthdate, phone, sms_opt_in)
         │
         ▼
sessions/route.ts calls syncProfileToKlaviyo() → upserts Klaviyo profile
         │                with: baby_name, baby_birthdate, book_theme, sms_consent
         │
         ▼
If baby_birthdate is present → trackPhotoAppSignup() fires "Photo App Signup" event
         │
         ▼
Klaviyo flow triggers on "Photo App Signup" metric
         │
         ├─ Month 1: Wait until baby_birthdate + 1 month → send email (+ SMS if opted in)
         ├─ Month 2: Wait until baby_birthdate + 2 months → send email (+ SMS if opted in)
         ├─ ...
         └─ Month 12: Wait until baby_birthdate + 12 months → send email (+ SMS if opted in)
```

**If the parent adds their birthdate later** (via the app's baby info form after initial sign-up), the PATCH route fires `trackPhotoAppSignup()` at that point, starting the flow from wherever the baby currently is in their first year. Klaviyo will skip any delays that are already in the past and pick up from the next upcoming milestone.

---

## Troubleshooting

**"Photo App Signup" event not appearing in Klaviyo**
- Check that `KLAVIYO_API_KEY` is set correctly in your environment
- Confirm the baby_birthdate is set in the session (the event won't fire without it)
- Check Vercel function logs for `[Klaviyo]` error messages

**Profile created but not in the list**
- Confirm `KLAVIYO_PHOTO_APP_LIST_ID` is set to the correct list ID
- The list subscription is a separate API call — check logs for subscription errors

**SMS not sending**
- Confirm `KLAVIYO_SMS_LIST_ID` is set
- Confirm the Klaviyo account has SMS enabled (requires a sending number setup)
- Check that `sms_consent = true` on the profile
- Verify the phone number is stored in E.164 format (the `formatPhone()` function handles US numbers automatically)

**Flow not firing for existing sign-ups**
- The flow only triggers when a new "Photo App Signup" event is fired
- For existing sessions (already in the database before this integration was added), you can backfill by running a one-time script to fire the event for all sessions that have a `baby_birthdate`

---

## Backfill script (for existing sessions)

If you already have sessions in Supabase before this integration was deployed, run this once to fire the signup event for all existing sessions with a birth date:

```typescript
// Run once via: npx ts-node scripts/backfill-klaviyo.ts
import { createClient } from "@supabase/supabase-js";
import { syncProfileToKlaviyo, trackPhotoAppSignup } from "../src/lib/klaviyo";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function backfill() {
  const { data: sessions } = await supabase
    .from("sessions")
    .select("token, email, baby_name, baby_birthdate, phone, sms_opt_in, book_theme")
    .not("baby_birthdate", "is", null)
    .eq("status", "active");

  if (!sessions) return;
  console.log(`Backfilling ${sessions.length} sessions...`);

  for (const s of sessions) {
    await syncProfileToKlaviyo({
      email: s.email,
      babyName: s.baby_name,
      babyBirthdate: s.baby_birthdate,
      phone: s.phone,
      smsOptIn: s.sms_opt_in,
      bookTheme: s.book_theme,
    });

    await trackPhotoAppSignup({
      email: s.email,
      babyName: s.baby_name,
      babyBirthdate: s.baby_birthdate,
      phone: s.phone,
      smsOptIn: s.sms_opt_in,
      bookTheme: s.book_theme,
      sessionToken: s.token,
    });

    console.log(`  ✓ ${s.email}`);
    await new Promise((r) => setTimeout(r, 200)); // rate limit
  }

  console.log("Done.");
}

backfill().catch(console.error);
```
