import { test } from "node:test";
import assert from "node:assert/strict";
import { EmailSendError, sendEmailWith, type SendEmailDeps } from "@/lib/email";
import {
  buildEmailSendRow,
  hashRecipient,
  isInternalRecipient,
  recordEmailSend,
  type EmailSendInput,
  type EmailSendRow,
} from "@/lib/email-sends";

const CUSTOMER = "Parent@Example.com";
const PARAMS = { to: CUSTOMER, subject: "Your photo book is saved", html: "<p>resume/secret-token</p>" };
const META = { route: "magic-link" as const, sessionId: "11111111-1111-1111-1111-111111111111" };

function fakeDeps(send: SendEmailDeps["send"], calls: string[] = []) {
  const recorded: EmailSendInput[] = [];
  const deps: SendEmailDeps = {
    send: send
      ? async (p) => {
          calls.push("send");
          return send(p);
        }
      : null,
    record: async (input) => {
      calls.push("record");
      recorded.push(input);
      return true;
    },
  };
  return { deps, recorded };
}

test("a successful send is recorded as sent, with Resend's id, AFTER the send", async () => {
  const calls: string[] = [];
  const { deps, recorded } = fakeDeps(async () => ({ data: { id: "re_123" }, error: null }), calls);
  const data = await sendEmailWith(deps, PARAMS, META);
  assert.deepEqual(data, { id: "re_123" });
  assert.deepEqual(calls, ["send", "record"]);
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], { route: "magic-link", outcome: "sent", sessionId: META.sessionId, resendId: "re_123", to: CUSTOMER });
});

test("a Resend rejection is recorded as send-failed with the provider's error name, then re-thrown", async () => {
  const { deps, recorded } = fakeDeps(async () => ({
    data: null,
    error: { name: "validation_error", message: "The lucydarling.com domain is not verified", statusCode: 403 },
  }));
  await assert.rejects(sendEmailWith(deps, PARAMS, META), (err: unknown) => {
    assert.ok(err instanceof EmailSendError);
    assert.equal(err.providerStatus, 403);
    return true;
  });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].outcome, "send-failed");
  assert.equal(recorded[0].errorCode, "validation_error");
  assert.equal(recorded[0].resendId, undefined);
});

test("a missing RESEND_API_KEY is recorded as send-failed (missing_api_key)", async () => {
  const { deps, recorded } = fakeDeps(null);
  await assert.rejects(sendEmailWith(deps, PARAMS, META), EmailSendError);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].outcome, "send-failed");
  assert.equal(recorded[0].errorCode, "missing_api_key");
});

test("a network exception from the SDK is recorded as send-failed and re-thrown", async () => {
  const { deps, recorded } = fakeDeps(async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(sendEmailWith(deps, PARAMS, META), TypeError);
  assert.equal(recorded[0].outcome, "send-failed");
  assert.equal(recorded[0].errorCode, "TypeError");
});

test("a failing insert never blocks the email: the send still returns its id", async () => {
  const errors: string[] = [];
  const origError = console.error;
  console.error = (msg: string) => errors.push(String(msg));
  try {
    for (const insert of [
      async () => ({ error: { message: "relation email_sends does not exist" } }),
      async () => {
        throw new Error("connection reset");
      },
    ]) {
      const deps: SendEmailDeps = {
        send: async () => ({ data: { id: "re_456" }, error: null }),
        record: (input) => recordEmailSend(input, insert),
      };
      assert.deepEqual(await sendEmailWith(deps, PARAMS, META), { id: "re_456" });
    }
  } finally {
    console.error = origError;
  }
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => e.startsWith("[email-sends] insert failed route=magic-link outcome=sent")));
});

test("a failing insert on a failed send still surfaces the SEND error, not the insert error", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const deps: SendEmailDeps = {
      send: async () => ({ data: null, error: { name: "rate_limit_exceeded", message: "Too many requests", statusCode: 429 } }),
      record: (input) => recordEmailSend(input, async () => ({ error: { message: "db down" } })),
    };
    await assert.rejects(sendEmailWith(deps, PARAMS, META), (err: unknown) => err instanceof EmailSendError && err.providerName === "rate_limit_exceeded");
  } finally {
    console.error = origError;
  }
});

test("a hung insert is abandoned after the timeout", async () => {
  const origError = console.error;
  const errors: string[] = [];
  console.error = (msg: string) => errors.push(String(msg));
  try {
    const started = Date.now();
    const ok = await recordEmailSend({ route: "alert", outcome: "sent", to: "kevin@lucydarling.com" }, () => new Promise(() => {}), 50);
    assert.equal(ok, false);
    assert.ok(Date.now() - started < 1000);
    assert.match(errors[0], /timed out after 50ms/);
  } finally {
    console.error = origError;
  }
});

test("recordEmailSend inserts one row and reports success", async () => {
  const rows: EmailSendRow[] = [];
  const ok = await recordEmailSend(
    { route: "my-books-email", outcome: "lookup-miss", to: CUSTOMER },
    async (row) => {
      rows.push(row);
      return { error: null };
    }
  );
  assert.equal(ok, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "lookup-miss");
  assert.equal(rows[0].session_id, null);
});

test("a row never holds the address, body or token: only a hash and the internal flag", () => {
  const row = buildEmailSendRow({ route: "magic-link", outcome: "sent", sessionId: META.sessionId, resendId: "re_1", to: CUSTOMER });
  const json = JSON.stringify(row);
  assert.ok(!json.toLowerCase().includes("parent@example.com"));
  assert.ok(!json.includes("secret-token"));
  assert.equal(row.recipient_hash, hashRecipient("parent@example.com"));
  assert.equal(row.recipient_hash, hashRecipient("  PARENT@example.COM "));
  assert.match(row.recipient_hash!, /^[0-9a-f]{64}$/);
  assert.equal(row.internal_recipient, false);
});

test("@lucydarling.com recipients (tests, Kevin's alerts) are flagged internal", () => {
  assert.equal(isInternalRecipient("kevin+e2e@lucydarling.com"), true);
  assert.equal(isInternalRecipient("Kevin@LucyDarling.com "), true);
  assert.equal(isInternalRecipient("someone@lucydarling.com.evil.net"), false);
  assert.equal(isInternalRecipient("parent@gmail.com"), false);
  assert.equal(buildEmailSendRow({ route: "alert", outcome: "sent", to: "kevin@lucydarling.com" }).internal_recipient, true);
  assert.equal(buildEmailSendRow({ route: "magic-link", outcome: "lookup-miss" }).recipient_hash, null);
});
