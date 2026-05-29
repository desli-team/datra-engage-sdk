# Datra Engage SDK

JavaScript/TypeScript client for Datra Engage in-app messages.

The SDK only resolves and tracks messages. It cannot apply promotions, redeem loyalty points, create orders, or mutate customer data.

## Install

```bash
npm install @datra/engage-sdk
```

## Usage

```ts
import { DatraEngage } from "@datra/engage-sdk";

const engage = new DatraEngage({
  baseUrl: "https://api.datra.uz",
  publicKey: "pk_live_xxx",
  customerExternalId: "customer_123",
  platform: "ios",
  appVersion: "1.5.0",
  locale: "ru",
});

const { messages } = await engage.screenViewed("home", {
  placement: "home_top_banner",
  context: {
    branchExternalId: "branch_1",
    cartTotal: 120000,
  },
});

for (const message of messages) {
  await engage.messageShown(message.decisionId);
}
```

## Tracking

```ts
await engage.messageClicked("decision_id", {
  idempotencyKey: "click-event-id",
});

await engage.messageDismissed("decision_id");
await engage.messageConverted("decision_id", {
  metadata: {
    orderExternalId: "order_123",
  },
});
```

## Identity Updates

```ts
engage.identify({
  customerExternalId: "customer_456",
  platform: "android",
  appVersion: "1.6.0",
  context: {
    branchExternalId: "branch_2",
  },
});
```

## API Contract

The SDK calls:

- `POST /api/v1/engage/messages/resolve`
- `POST /api/v1/engage/events`

Authorization uses the public SDK key in the `x-datra-public-key` header.
