# Datra Engage SDK

**Datra Engage SDK** helps apps show personalized in-app messages, promotions, coupons and engagement mechanics powered by Datra.

It is designed for mobile apps, web apps and embedded client experiences where marketing and product teams need to show the right message to the right customer at the right moment.

Datra Engage is part of the Datra Customer Engagement Platform.

---

## What is Datra Engage?

Datra Engage is the delivery layer between your app and Datra.

It helps your application receive and render:

- banners
- popups
- coupon cards
- bottom sheets
- stories
- in-app messages linked to push campaigns
- personalized campaign messages
- gamification entry points

Your app keeps full control over the UI.

Datra decides **what should be shown**.  
Your app decides **how it should look**.

---

## What this SDK does

The SDK can:

- identify a customer
- resolve messages for a screen or placement
- send screen view events
- track message impressions
- track clicks
- track dismiss events
- track conversions
- work safely in non-blocking UI flows
- retry temporary failed requests

---

## What this SDK does not do

For security reasons, this SDK does not:

- apply promotions
- redeem loyalty points
- create orders
- change customer balances
- mutate customer data
- confirm discounts
- validate final checkout logic

All sensitive operations must happen on your backend through Datra Core.

Frontend shows the offer.  
Backend confirms the offer.

---

## Installation

```bash
npm install @datra/engage-sdk
```

---

## Quick Start

```ts
import { DatraEngage } from "@datra/engage-sdk";

const engage = new DatraEngage({
  baseUrl: "https://api.datra.uz",
  publicKey: "pk_live_xxx",
  customerExternalId: "customer_123",
  platform: "ios",
  appVersion: "1.5.0",
  locale: "ru",
  defaultContext: {
    branchExternalId: "branch_1",
  },
});

const { messages } = await engage.screenViewed("home", {
  placement: "home_top_banner",
  context: {
    cartTotal: 120000,
  },
});

await engage.trackShown(messages, {
  idempotencyKeyPrefix: "home",
});
```

---

## Basic Concept

Datra Engage works around three ideas:

### 1. Screen

Where the customer is now.

Examples:

```ts
"home"
"cart"
"checkout"
"profile"
"order_status"
```

### 2. Placement

The exact place where a message can appear.

Examples:

```ts
"home_top_banner"
"cart_bottom_sheet"
"checkout_coupon_card"
"profile_reward_block"
```

### 3. Message

The campaign content returned by Datra.

Examples:

```ts
"BANNER"
"POPUP"
"COUPON_CARD"
"BOTTOM_SHEET"
"STORY"
```

---

## Render Messages

Datra Engage returns structured data.  
Your app renders it using your own native components.

```ts
for (const message of messages) {
  if (message.type === "BANNER") {
    renderBanner({
      title: message.title,
      body: message.body,
      imageUrl: message.imageUrl,
      cta: message.cta,
      onPress: async () => {
        await engage.messageClickedSafe(message.decisionId);
        handleDatraAction(message.action);
      },
    });
  }
}
```

Example message:

```json
{
  "decisionId": "decision_123",
  "type": "BANNER",
  "title": "Получите подарок",
  "body": "Сделайте заказ от 100 000 сум и получите напиток бесплатно",
  "imageUrl": "https://cdn.datra.uz/campaigns/free-drink.png",
  "cta": {
    "text": "Заказать"
  },
  "action": {
    "type": "OPEN_OFFER",
    "offerId": "offer_123"
  }
}
```

---

## Tracking

Tracking helps Datra measure campaign performance.

You can track:

- shown
- clicked
- dismissed
- converted

### Strict tracking

Use strict tracking when your app needs to know about failures.

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

### Safe tracking

Use safe tracking for non-blocking UI events.

Safe methods never throw.

```ts
await engage.messageShownSafe("decision_id");
await engage.messageClickedSafe("decision_id");
await engage.messageDismissedSafe("decision_id");
```

Safe methods return:

```ts
{
  accepted: boolean;
  response?: unknown;
  error?: unknown;
}
```

---

## Identity Updates

Use `identify` when the active customer changes.

`identify` updates the SDK identity locally and uses it for subsequent resolve and tracking calls.

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

---

## React Native Example

```tsx
import { useEffect, useState } from "react";
import { DatraEngage, type EngageResolvedMessage } from "@datra/engage-sdk";

const engage = new DatraEngage({
  baseUrl: "https://api.datra.uz",
  publicKey: "pk_live_xxx",
  platform: "ios",
  appVersion: "1.5.0",
});

export function HomeScreen({
  customerExternalId,
}: {
  customerExternalId: string;
}) {
  const [messages, setMessages] = useState<EngageResolvedMessage[]>([]);

  useEffect(() => {
    engage.identify({ customerExternalId });

    let mounted = true;

    engage
      .screenViewed("home", {
        placement: "home_top_banner",
      })
      .then(async (response) => {
        if (!mounted) return;

        setMessages(response.messages);

        await engage.trackShown(response.messages, {
          idempotencyKeyPrefix: "home",
        });
      })
      .catch(() => {
        if (mounted) setMessages([]);
      });

    return () => {
      mounted = false;
    };
  }, [customerExternalId]);

  return <>{messages.map((message) => renderInAppMessage(message))}</>;
}
```

---

## Example Flow

A customer opens the app.

```ts
const { messages } = await engage.screenViewed("home");
```

Datra returns a personalized campaign.

```ts
renderInAppMessage(messages[0]);
```

The app tracks that it was shown.

```ts
await engage.messageShownSafe(messages[0].decisionId);
```

The customer clicks the message.

```ts
await engage.messageClickedSafe(messages[0].decisionId);
```

The app opens the offer, product, coupon or checkout screen.

```ts
handleDatraAction(messages[0].action);
```

The backend confirms the promotion through Datra Core.

---

## Recommended Integration Pattern

Datra Engage should be non-blocking.

If Datra Engage is unavailable, your app should continue working normally.

Recommended behavior:

- app opens normally
- catalog works normally
- cart works normally
- checkout works normally
- only marketing messages are hidden

Example:

```ts
try {
  const { messages } = await engage.screenViewed("home");
  showMessages(messages);
} catch {
  showMessages([]);
}
```

---

## Timeout and Retry

Requests time out after 5 seconds by default and retry once on temporary failures.

```ts
const engage = new DatraEngage({
  baseUrl: "https://api.datra.uz",
  publicKey: "pk_live_xxx",
  timeoutMs: 3000,
  retry: {
    retries: 2,
    retryDelayMs: 200,
    maxRetryDelayMs: 1000,
  },
  onError: (error, context) => {
    console.warn("Datra Engage request failed", {
      path: context.path,
      attempt: context.attempt,
      retryable: context.retryable,
      error,
    });
  },
});
```

Disable retries:

```ts
const engage = new DatraEngage({
  baseUrl: "https://api.datra.uz",
  publicKey: "pk_live_xxx",
  retry: 0,
});
```

---

## API Contract

The SDK calls:

```http
POST /api/v1/engage/messages/resolve
POST /api/v1/engage/events
```

Authorization uses the public SDK key:

```http
x-datra-public-key: pk_live_xxx
```

By default, the SDK adds `/api/v1` to `baseUrl`. You can override this with `apiPrefix`.

---

## Security Model

Use a public SDK key in frontend applications.

```ts
publicKey: "pk_live_xxx"
```

Never use a secret key inside a mobile app or browser.

Sensitive actions must be handled by your backend:

- order creation
- promotion application
- coupon redemption
- loyalty point redemption
- bonus balance changes

---

## Package Scripts

```bash
npm run build
npm run typecheck
npm test
```

---

## Brand Principle

Datra Engage is not just a message delivery SDK.

It is a bridge between customer data and real customer action.

Use it to turn app screens into personalized engagement moments.
