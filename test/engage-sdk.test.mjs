import assert from "node:assert/strict";
import test from "node:test";

import {
  DatraEngage,
  DatraEngageError,
  createDatraEngageActionHandler,
  createMemoryStorageAdapter,
} from "../dist/index.js";

function createJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

test("getMessages sends public key and merges identity/context", async () => {
  const calls = [];
  const sdk = new DatraEngage({
    baseUrl: "https://api.datra.uz",
    publicKey: "pk_live_test",
    customerExternalId: "customer_1",
    platform: "ios",
    appVersion: "1.2.3",
    defaultContext: { branchExternalId: "branch_1" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return createJsonResponse({
        messages: [
          {
            decisionId: "decision_1",
            campaignId: "campaign_1",
            placementId: "placement_1",
            placement: "home_top_banner",
            type: "BANNER",
            priority: 10,
            title: "Free Cola",
          },
        ],
      });
    },
  });

  const result = await sdk.getMessages({
    placement: "home_top_banner",
    screen: "home",
    context: { cartTotal: 120000 },
  });

  assert.equal(result.messages[0].decisionId, "decision_1");
  assert.equal(calls[0].url, "https://api.datra.uz/api/v1/engage/messages/resolve");
  assert.equal(calls[0].init.headers["x-datra-public-key"], "pk_live_test");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    customerExternalId: "customer_1",
    placement: "home_top_banner",
    screen: "home",
    platform: "ios",
    appVersion: "1.2.3",
    context: {
      branchExternalId: "branch_1",
      cartTotal: 120000,
    },
  });
});

test("screenViewed uses screen as default placement", async () => {
  const bodies = [];
  const sdk = new DatraEngage({
    baseUrl: "https://api.datra.uz/api/v1",
    publicKey: "pk_live_test",
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return createJsonResponse({ messages: [] });
    },
  });

  await sdk.screenViewed("checkout");

  assert.equal(bodies[0].screen, "checkout");
  assert.equal(bodies[0].placement, "checkout");
});

test("tracking helpers send expected event payload", async () => {
  const calls = [];
  const sdk = new DatraEngage({
    baseUrl: "https://api.datra.uz",
    publicKey: "pk_live_test",
    customerExternalId: "customer_1",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return createJsonResponse({
        id: "event_1",
        decisionId: "decision_1",
        eventType: "CLICKED",
        accepted: true,
      });
    },
  });

  const result = await sdk.messageClicked("decision_1", {
    idempotencyKey: "click_1",
    metadata: { source: "banner" },
  });

  assert.equal(result.accepted, true);
  assert.equal(calls[0].url, "https://api.datra.uz/api/v1/engage/events");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    decisionId: "decision_1",
    eventType: "CLICKED",
    customerExternalId: "customer_1",
    idempotencyKey: "click_1",
    metadata: { source: "banner" },
  });
});

test("tracking helpers add default idempotency keys", async () => {
  const bodies = [];
  const sdk = new DatraEngage({
    baseUrl: "https://api.datra.uz",
    publicKey: "pk_live_test",
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return createJsonResponse({
        id: "event_1",
        decisionId: "decision_1",
        eventType: "SHOWN",
        accepted: true,
      });
    },
  });

  await sdk.messageShown("decision_1");

  assert.equal(bodies[0].idempotencyKey, "datra:shown:decision_1");
});

test("request errors include status and response body", async () => {
  const sdk = new DatraEngage({
    baseUrl: "https://api.datra.uz",
    publicKey: "pk_live_test",
    fetchImpl: async () => createJsonResponse({ message: "Invalid public key" }, 401),
  });

  await assert.rejects(
    () => sdk.getMessages({ placement: "home" }),
    (error) => {
      assert.equal(error instanceof DatraEngageError, true);
      assert.equal(error.status, 401);
      assert.deepEqual(error.body, { message: "Invalid public key" });
      return true;
    },
  );
});

test("request timeout throws DatraEngageError", async () => {
  const sdk = new DatraEngage({
    baseUrl: "https://api.datra.uz",
    publicKey: "pk_live_test",
    retry: 0,
    timeoutMs: 1,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });

  await assert.rejects(
    () => sdk.getMessages({ placement: "home" }),
    (error) => {
      assert.equal(error instanceof DatraEngageError, true);
      assert.equal(error.status, 0);
      assert.deepEqual(error.body, {
        code: "TIMEOUT",
        timeoutMs: 1,
      });
      return true;
    },
  );
});

test("retries retryable response statuses", async () => {
  let calls = 0;
  const sdk = new DatraEngage({
    baseUrl: "https://api.datra.uz",
    publicKey: "pk_live_test",
    retry: {
      retries: 2,
      retryDelayMs: 1,
    },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return createJsonResponse({ message: "temporary" }, 503);
      }
      return createJsonResponse({ messages: [] });
    },
  });

  const result = await sdk.getMessages({ placement: "home" });

  assert.deepEqual(result, { messages: [] });
  assert.equal(calls, 2);
});

test("safe tracking keeps app flow alive on errors", async () => {
  const errors = [];
  const sdk = new DatraEngage({
    baseUrl: "https://api.datra.uz",
    publicKey: "pk_live_test",
    retry: 0,
    onError: (error, context) => errors.push({ error, context }),
    fetchImpl: async () => createJsonResponse({ message: "server down" }, 500),
  });

  const result = await sdk.messageShownSafe("decision_1");

  assert.equal(result.accepted, false);
  assert.equal(result.error instanceof DatraEngageError, true);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].context.path, "/engage/events");
  assert.equal(errors[0].context.retryable, true);
});

test("safe tracking deduplicates repeated UI events", async () => {
  let calls = 0;
  const sdk = new DatraEngage({
    baseUrl: "https://api.datra.uz",
    publicKey: "pk_live_test",
    fetchImpl: async () => {
      calls += 1;
      return createJsonResponse({
        id: "event_1",
        decisionId: "decision_1",
        eventType: "SHOWN",
        accepted: true,
      });
    },
  });

  const first = await sdk.messageShownSafe("decision_1");
  const second = await sdk.messageShownSafe("decision_1");

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(second.deduped, true);
  assert.equal(calls, 1);
});

test("safe tracking can queue retryable failures and flush later", async () => {
  let online = false;
  const bodies = [];
  const storage = createMemoryStorageAdapter();
  const sdk = new DatraEngage({
    baseUrl: "https://api.datra.uz",
    publicKey: "pk_live_test",
    retry: 0,
    eventQueue: {
      enabled: true,
      storage,
    },
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (!online) {
        return createJsonResponse({ message: "temporary" }, 503);
      }

      return createJsonResponse({
        id: "event_1",
        decisionId: "decision_1",
        eventType: "CLICKED",
        accepted: true,
      });
    },
  });

  const queued = await sdk.messageClickedSafe("decision_1");

  assert.equal(queued.accepted, false);
  assert.equal(queued.queued, true);
  assert.equal(await sdk.getQueuedEventCount(), 1);

  online = true;
  const flushed = await sdk.flushEventQueue();

  assert.deepEqual(flushed, {
    attempted: 1,
    sent: 1,
    failed: 0,
    remaining: 0,
  });
  assert.equal(await sdk.getQueuedEventCount(), 0);
  assert.deepEqual(bodies.map((body) => body.idempotencyKey), [
    "datra:clicked:decision_1",
    "datra:clicked:decision_1",
  ]);
});

test("trackShown marks every resolved message with safe calls", async () => {
  const bodies = [];
  const sdk = new DatraEngage({
    baseUrl: "https://api.datra.uz",
    publicKey: "pk_live_test",
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return createJsonResponse({
        id: `event_${bodies.length}`,
        decisionId: `decision_${bodies.length}`,
        eventType: "SHOWN",
        accepted: true,
      });
    },
  });

  const result = await sdk.trackShown([
    { decisionId: "decision_1" },
    { decisionId: "decision_2" },
  ], {
    idempotencyKeyPrefix: "home",
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].accepted, true);
  assert.deepEqual(bodies.map((body) => body.decisionId), ["decision_1", "decision_2"]);
  assert.deepEqual(bodies.map((body) => body.idempotencyKey), [
    "home:shown:decision_1",
    "home:shown:decision_2",
  ]);
});

test("action handler dispatches typed Datra actions", async () => {
  const calls = [];
  const handler = createDatraEngageActionHandler({
    onOpenPromotion: async (promotionId) => {
      calls.push(["promotion", promotionId]);
    },
    onOpenCart: async () => {
      calls.push(["cart"]);
    },
    onUnhandledAction: async (action) => {
      calls.push(["unhandled", action.type]);
    },
  });

  await handler({ type: "OPEN_PROMOTION", promotionId: "promotion_1" });
  await handler({ type: "OPEN_CART" });
  await handler({ type: "OPEN_UNKNOWN" });

  assert.deepEqual(calls, [
    ["promotion", "promotion_1"],
    ["cart"],
    ["unhandled", "OPEN_UNKNOWN"],
  ]);
});

test("react subpath exports integration helpers", async () => {
  const reactSdk = await import("../dist/react.js");

  assert.equal(typeof reactSdk.DatraEngageProvider, "function");
  assert.equal(typeof reactSdk.useDatraEngage, "function");
  assert.equal(typeof reactSdk.useEngageMessages, "function");
  assert.equal(typeof reactSdk.useDatraEngageActionHandler, "function");
  assert.equal(typeof reactSdk.createDatraEngageActionHandler, "function");
});
