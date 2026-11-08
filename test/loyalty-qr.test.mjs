import assert from "node:assert/strict";
import test from "node:test";

import {
  DatraEngage,
  DatraEngageError,
  LoyaltyQrRateLimitError,
  LoyaltyQrResponseError,
  LoyaltyQrUnavailableError,
  createLoyaltyQrSession,
  parseRetryAfterSec,
} from "../dist/index.js";

const TOKEN = `dq1_${"ab12".repeat(16)}`;
const TOKEN_2 = `dq1_${"cd34".repeat(16)}`;

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function qrBody(qr = TOKEN, refreshAfterSec = 45) {
  return { qr, expiresAt: "2026-11-07T10:01:00.000Z", refreshAfterSec };
}

function createSdk(fetchImpl, extra = {}) {
  return new DatraEngage({
    baseUrl: "https://hotydogy.datra.uz",
    publicKey: "pk_live_test",
    platform: "ios",
    appVersion: "1.7.0",
    fetchImpl,
    ...extra,
  });
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("getLoyaltyQr posts the wire contract body with the public key and returns a Date", async () => {
  const calls = [];
  const sdk = createSdk(async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(qrBody(), 200, { "cache-control": "no-store" });
  });

  const result = await sdk.getLoyaltyQr({ customerExternalId: " c-1 ", deviceId: "device-1" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hotydogy.datra.uz/api/v1/engage/loyalty/qr");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["x-datra-public-key"], "pk_live_test");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    customerExternalId: "c-1",
    intent: "EARN",
    deviceId: "device-1",
    appVersion: "1.7.0",
    platform: "ios",
  });
  assert.equal(result.qr, TOKEN);
  assert.equal(result.refreshAfterSec, 45);
  assert.ok(result.expiresAt instanceof Date);
  assert.equal(result.expiresAt.toISOString(), "2026-11-07T10:01:00.000Z");
});

test("getLoyaltyQr sends SPEND with maxSpendPoints and cuts long signals", async () => {
  const bodies = [];
  const sdk = createSdk(async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return jsonResponse(qrBody());
  }, { platform: "macos", appVersion: undefined });

  await sdk.getLoyaltyQr({
    customerExternalId: "c-1",
    intent: "SPEND",
    maxSpendPoints: 5000,
    deviceId: "d".repeat(200),
    appVersion: "v".repeat(40),
  });

  assert.deepEqual(bodies[0], {
    customerExternalId: "c-1",
    intent: "SPEND",
    maxSpendPoints: 5000,
    deviceId: "d".repeat(128),
    appVersion: "v".repeat(32),
  });
});

test("getLoyaltyQr rejects invalid input before any request", async () => {
  let calls = 0;
  const sdk = createSdk(async () => {
    calls += 1;
    return jsonResponse(qrBody());
  });

  await assert.rejects(sdk.getLoyaltyQr({ customerExternalId: "  " }), /customerExternalId is required/);
  await assert.rejects(sdk.getLoyaltyQr({ customerExternalId: "x".repeat(256) }), /at most 255/);
  await assert.rejects(sdk.getLoyaltyQr({ customerExternalId: "c-1", intent: "GIFT" }), /EARN or SPEND/);
  await assert.rejects(
    sdk.getLoyaltyQr({ customerExternalId: "c-1", maxSpendPoints: 10 }),
    /only allowed with intent SPEND/,
  );
  await assert.rejects(
    sdk.getLoyaltyQr({ customerExternalId: "c-1", intent: "SPEND", maxSpendPoints: 1.5 }),
    /positive integer/,
  );
  await assert.rejects(
    sdk.getLoyaltyQr({ customerExternalId: "c-1", platform: "windows" }),
    /ios, android or web/,
  );
  assert.equal(calls, 0);
});

test("getLoyaltyQr validates the response strictly without leaking the body", async () => {
  const invalidBodies = [
    [{ ...qrBody(), qr: TOKEN.toUpperCase().replace("DQ1_", "dq1_") }, "qr"],
    [{ ...qrBody(), qr: `dq2_${"a".repeat(64)}` }, "qr"],
    [{ ...qrBody(), qr: `${TOKEN}0` }, "qr"],
    [{ ...qrBody(), refreshAfterSec: 0 }, "refreshAfterSec"],
    [{ ...qrBody(), refreshAfterSec: 1.5 }, "refreshAfterSec"],
    [{ ...qrBody(), refreshAfterSec: "45" }, "refreshAfterSec"],
    [{ ...qrBody(), expiresAt: "soon" }, "expiresAt"],
    [{ ...qrBody(), expiresAt: undefined }, "expiresAt"],
    [[], "body"],
  ];

  for (const [body, field] of invalidBodies) {
    const sdk = createSdk(async () => jsonResponse(body));
    const error = await sdk.getLoyaltyQr({ customerExternalId: "c-1" }).then(
      () => assert.fail("expected rejection"),
      (caught) => caught,
    );
    assert.ok(error instanceof LoyaltyQrResponseError, field);
    assert.equal(error.body.field, field);
    assert.ok(!JSON.stringify({ message: error.message, body: error.body }).includes(TOKEN.slice(4, 20)));
  }
});

test("404 maps to LoyaltyQrUnavailableError", async () => {
  const sdk = createSdk(async () => jsonResponse({ code: "loyalty_qr_disabled" }, 404));

  const error = await sdk.getLoyaltyQr({ customerExternalId: "c-1" }).catch((caught) => caught);

  assert.ok(error instanceof LoyaltyQrUnavailableError);
  assert.ok(error instanceof DatraEngageError);
  assert.equal(error.status, 404);
  assert.deepEqual(error.body, { code: "loyalty_qr_disabled" });
});

test("429 carries Retry-After and later calls fail fast until it passes", async () => {
  let calls = 0;
  const sdk = createSdk(async () => {
    calls += 1;
    return jsonResponse({ code: "rate_limited" }, 429, { "retry-after": "30" });
  });

  const error = await sdk.getLoyaltyQr({ customerExternalId: "c-1" }).catch((caught) => caught);
  assert.ok(error instanceof LoyaltyQrRateLimitError);
  assert.equal(error.status, 429);
  assert.equal(error.retryAfterSec, 30);

  const local = await sdk.getLoyaltyQr({ customerExternalId: "c-1" }).catch((caught) => caught);
  assert.ok(local instanceof LoyaltyQrRateLimitError);
  assert.ok(local.retryAfterSec > 0 && local.retryAfterSec <= 30);
  assert.equal(calls, 1);

  // Another customer is not blocked.
  await sdk.getLoyaltyQr({ customerExternalId: "c-2" }).catch(() => undefined);
  assert.equal(calls, 2);
});

test("parseRetryAfterSec accepts seconds and HTTP dates and falls back to a minute", () => {
  const now = Date.parse("2026-11-07T10:00:00.000Z");
  assert.equal(parseRetryAfterSec("12", now), 12);
  assert.equal(parseRetryAfterSec("Sat, 07 Nov 2026 10:00:20 GMT", now), 20);
  assert.equal(parseRetryAfterSec(null, now), 60);
  assert.equal(parseRetryAfterSec("soon", now), 60);
  assert.equal(parseRetryAfterSec("0", now), 1);
  assert.equal(parseRetryAfterSec("999999", now), 3600);
});

test("getLoyaltyQr never retries, even with a global retry config", async () => {
  for (const status of [500, 503, 408]) {
    let calls = 0;
    const sdk = createSdk(async () => {
      calls += 1;
      return jsonResponse({ code: "unavailable" }, status);
    }, { retry: { retries: 3, retryDelayMs: 1 } });

    await assert.rejects(sdk.getLoyaltyQr({ customerExternalId: "c-1" }), DatraEngageError);
    assert.equal(calls, 1, `status ${status}`);
  }
});

test("getLoyaltyQr times out once with the dedicated timeout", async () => {
  let calls = 0;
  const sdk = createSdk((_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  }, { loyaltyQrTimeoutMs: 20, retry: 2 });

  const error = await sdk.getLoyaltyQr({ customerExternalId: "c-1" }).catch((caught) => caught);
  assert.equal(error.body.code, "TIMEOUT");
  assert.equal(error.body.timeoutMs, 20);
  assert.equal(calls, 1);
});

test("concurrent identical requests share one request and nothing is cached afterwards", async () => {
  let calls = 0;
  const sdk = createSdk(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return jsonResponse(qrBody(calls === 1 ? TOKEN : TOKEN_2));
  });

  const [first, second] = await Promise.all([
    sdk.getLoyaltyQr({ customerExternalId: "c-1" }),
    sdk.getLoyaltyQr({ customerExternalId: "c-1" }),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.qr, TOKEN);
  assert.equal(second.qr, TOKEN);

  const third = await sdk.getLoyaltyQr({ customerExternalId: "c-1" });
  assert.equal(calls, 2);
  assert.equal(third.qr, TOKEN_2);
});

test("the token never reaches storage, onError or the console", async () => {
  const written = [];
  const storage = {
    getItem: () => null,
    setItem: (key, value) => written.push(`${key}=${value}`),
    removeItem: () => undefined,
  };
  const reported = [];
  const printed = [];
  const original = {};
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    original[level] = console[level];
    console[level] = (...args) => printed.push(args.map(String).join(" "));
  }

  try {
    let call = 0;
    const sdk = createSdk(async () => {
      call += 1;
      if (call === 1) return jsonResponse(qrBody());
      if (call === 2) return jsonResponse({ ...qrBody(), refreshAfterSec: -1 });
      return jsonResponse({ code: "loyalty_qr_disabled" }, 404);
    }, {
      eventQueue: { enabled: true, storage },
      dedupe: { enabled: true, storage },
      onError: (error, context) => reported.push(JSON.stringify({
        message: error.message,
        body: error.body,
        context,
      })),
    });

    await sdk.getLoyaltyQr({ customerExternalId: "c-1" });
    await sdk.getLoyaltyQr({ customerExternalId: "c-1" }).catch(() => undefined);
    await sdk.getLoyaltyQr({ customerExternalId: "c-1" }).catch(() => undefined);
  } finally {
    for (const [level, fn] of Object.entries(original)) console[level] = fn;
  }

  assert.equal(reported.length, 2);
  const everything = [...written, ...reported, ...printed].join("\n");
  assert.ok(!everything.includes(TOKEN.slice(4)));
  assert.deepEqual(written, []);
  assert.deepEqual(printed, []);
});

function createFakeClock() {
  let current = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => current,
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { callback, at: current + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    pending: () => Array.from(timers.values()).map((timer) => timer.at - current),
    async advance(ms) {
      const target = current + ms;
      for (;;) {
        const due = Array.from(timers.entries())
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        current = due[1].at;
        due[1].callback();
        await flush();
      }
      current = target;
      await flush();
    },
  };
}

function createScriptedClient(responses) {
  const calls = [];
  return {
    calls,
    async getLoyaltyQr(input) {
      calls.push(input);
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const qr = (token = TOKEN, refreshAfterSec = 45) => ({
  qr: token,
  expiresAt: new Date("2026-11-07T10:01:00.000Z"),
  refreshAfterSec,
});

test("session refreshes after refreshAfterSec and stops after the idle timeout", async () => {
  const clock = createFakeClock();
  const client = createScriptedClient([qr(TOKEN), qr(TOKEN_2)]);
  const states = [];
  const session = createLoyaltyQrSession(client, { customerExternalId: "c-1" }, {
    ...clock,
    idleTimeoutMs: 180000,
    onChange: (state) => states.push(state),
  });

  session.start();
  await flush();
  assert.equal(client.calls.length, 1);
  assert.equal(session.getState().qr.qr, TOKEN);
  assert.equal(states[0].isLoading, true);

  await clock.advance(45000);
  assert.equal(client.calls.length, 2);
  assert.equal(session.getState().qr.qr, TOKEN_2);

  await clock.advance(135000);
  // 45 s, 90 s, 135 s refresh; the one due at 180 s finds the guest idle.
  assert.equal(client.calls.length, 4);
  assert.equal(session.getState().expired, true);
  assert.equal(session.getState().qr, undefined);
  assert.deepEqual(clock.pending(), []);

  session.refresh();
  await flush();
  assert.equal(client.calls.length, 5);
  assert.equal(session.getState().expired, false);
  assert.ok(session.getState().qr);
});

test("session touch keeps auto-refresh going", async () => {
  const clock = createFakeClock();
  const client = createScriptedClient([qr()]);
  const session = createLoyaltyQrSession(client, { customerExternalId: "c-1" }, {
    ...clock,
    idleTimeoutMs: 100000,
  });

  session.start();
  await flush();
  await clock.advance(90000);
  session.touch();
  await clock.advance(45000);
  assert.equal(session.getState().expired, false);
  assert.equal(client.calls.length, 4);
});

test("session stop drops the token and cancels timers; start fetches again", async () => {
  const clock = createFakeClock();
  const client = createScriptedClient([qr()]);
  const session = createLoyaltyQrSession(client, { customerExternalId: "c-1" }, clock);

  session.start();
  await flush();
  assert.ok(session.getState().qr);

  session.stop();
  assert.equal(session.getState().qr, undefined);
  assert.deepEqual(clock.pending(), []);
  await clock.advance(600000);
  assert.equal(client.calls.length, 1);

  session.start();
  await flush();
  assert.equal(client.calls.length, 2);
  assert.ok(session.getState().qr);
  session.destroy();
  assert.deepEqual(clock.pending(), []);
});

test("session stops on 404 and waits Retry-After on 429", async () => {
  const clock = createFakeClock();
  const unavailable = createScriptedClient([new LoyaltyQrUnavailableError({ code: "loyalty_qr_disabled" })]);
  const first = createLoyaltyQrSession(unavailable, { customerExternalId: "c-1" }, clock);
  first.start();
  await flush();
  assert.equal(first.getState().unavailable, true);
  assert.deepEqual(clock.pending(), []);

  const limited = createScriptedClient([new LoyaltyQrRateLimitError(20, {}), qr()]);
  const second = createLoyaltyQrSession(limited, { customerExternalId: "c-1" }, clock);
  second.start();
  await flush();
  assert.equal(second.getState().retryAfterSec, 20);
  assert.deepEqual(clock.pending(), [20000]);
  await clock.advance(20000);
  assert.equal(limited.calls.length, 2);
  assert.ok(second.getState().qr);
  assert.equal(second.getState().retryAfterSec, undefined);
});

test("session retries transient failures after a delay but not client errors", async () => {
  const clock = createFakeClock();
  const transient = createScriptedClient([new DatraEngageError("down", 503, {}), qr()]);
  const first = createLoyaltyQrSession(transient, { customerExternalId: "c-1" }, {
    ...clock,
    errorRetryDelayMs: 15000,
  });
  first.start();
  await flush();
  assert.ok(first.getState().error);
  assert.deepEqual(clock.pending(), [15000]);
  await clock.advance(15000);
  assert.ok(first.getState().qr);
  first.destroy();

  const forbidden = createScriptedClient([new DatraEngageError("forbidden", 403, {})]);
  const second = createLoyaltyQrSession(forbidden, { customerExternalId: "c-1" }, clock);
  second.start();
  await flush();
  assert.ok(second.getState().error);
  assert.deepEqual(clock.pending(), []);
});

test("session ignores refresh while a request is loading", async () => {
  const clock = createFakeClock();
  let resolve;
  const client = {
    calls: 0,
    getLoyaltyQr() {
      this.calls += 1;
      return new Promise((done) => {
        resolve = done;
      });
    },
  };
  const session = createLoyaltyQrSession(client, { customerExternalId: "c-1" }, clock);
  session.start();
  session.refresh();
  session.refresh();
  assert.equal(client.calls, 1);
  resolve(qr());
  await flush();
  assert.ok(session.getState().qr);
});

test("react subpath exports useLoyaltyQr", async () => {
  const reactSdk = await import("../dist/react.js");
  assert.equal(typeof reactSdk.useLoyaltyQr, "function");
  assert.equal(typeof reactSdk.createLoyaltyQrSession, "function");
});
