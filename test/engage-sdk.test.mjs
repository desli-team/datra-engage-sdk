import assert from "node:assert/strict";
import test from "node:test";

import { DatraEngage, DatraEngageError } from "../dist/index.js";

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
