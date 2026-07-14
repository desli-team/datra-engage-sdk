<p align="center">
  <a href="https://datra.uz">
    <img src="./assets/datra-logo.png" alt="Datra" width="72" />
  </a>
</p>

<h1 align="center">Datra Engage SDK</h1>

<p align="center">
  Official JavaScript and TypeScript SDK for personalized in-app messages, promotions, coupons and engagement mechanics powered by Datra.
</p>

<p align="center">
  <a href="https://datra.uz">Website</a>
  ·
  <a href="https://api.datra.uz/redoc">API documentation</a>
  ·
  <a href="https://www.npmjs.com/package/@datra/engage-sdk">npm package</a>
  ·
  <a href="https://github.com/desli-team/datra-engage-sdk">GitHub</a>
</p>

**Datra Engage SDK** helps web apps, mobile apps, React Native apps and embedded client experiences show personalized in-app messages powered by Datra.

Use it when marketing and product teams need to show the right message to the right customer at the right moment without hardcoding every campaign into the application.

Datra Engage is part of the Datra Customer Engagement Platform.

## Links

- Website: [datra.uz](https://datra.uz)
- API documentation: [api.datra.uz/redoc](https://api.datra.uz/redoc)
- npm: [@datra/engage-sdk](https://www.npmjs.com/package/@datra/engage-sdk)
- GitHub: [desli-team/datra-engage-sdk](https://github.com/desli-team/datra-engage-sdk)

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

## Supported message types

The SDK supports the same message types as Datra Engage API:

| Type | Typical use |
| --- | --- |
| `BANNER` | Home screen promo, category offer, campaign strip |
| `POPUP` | Important one-time offer or announcement |
| `BOTTOM_SHEET` | Cart, checkout or coupon reminder |
| `COUPON_CARD` | Active coupon, gift or personal offer |
| `INLINE_BLOCK` | Embedded block inside profile, checkout or loyalty screens |
| `CAROUSEL` | Multiple offers in one placement |
| `STORY` | Story-like marketing or gamification entry point |

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
- queue failed tracking events
- deduplicate UI tracking events

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
  resolveTimeoutMs: 2000,
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
    "type": "OPEN_PROMOTION",
    "promotionId": "promotion_123"
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
  queued?: boolean;
  deduped?: boolean;
}
```

---

## Action Contract

Messages can include an `action` object. The SDK does not execute actions automatically because each app owns its navigation.

Recommended action types:

```ts
"OPEN_SCREEN"
"OPEN_PROMOTION"
"OPEN_COUPON"
"OPEN_PRODUCT"
"OPEN_CART"
"OPEN_URL"
"OPEN_STORY"
"OPEN_MECHANIC"
```

Use the action handler helper to keep app navigation consistent:

```ts
import { createDatraEngageActionHandler } from "@datra/engage-sdk";

const handleDatraAction = createDatraEngageActionHandler({
  onOpenPromotion: async (promotionId) => {
    navigation.navigate("Promotion", { promotionId });
  },
  onOpenCoupon: async (couponId) => {
    navigation.navigate("Coupon", { couponId });
  },
  onOpenCart: async () => {
    navigation.navigate("Cart");
  },
  onUnhandledAction: async (action) => {
    console.warn("Unhandled Datra action", action);
  },
});
```

---

## Offline Queue and Dedupe

Safe tracking can queue temporary failures and flush them later.

```ts
import { DatraEngage, createWebStorageAdapter } from "@datra/engage-sdk";

const storage = createWebStorageAdapter(window.localStorage, "my-app:");

const engage = new DatraEngage({
  baseUrl: "https://api.datra.uz",
  publicKey: "pk_live_xxx",
  eventQueue: {
    enabled: true,
    storage,
  },
  dedupe: {
    enabled: true,
    storage,
  },
});

await engage.flushEventQueue();
await engage.messageShownSafe("decision_id");
```

For React Native, pass an adapter backed by your storage library, for example AsyncStorage:

```ts
const asyncStorageAdapter = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};
```

Dedupe is enabled by default for safe tracking. Event queue is opt-in so apps can choose where queued events are stored.

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

## React Native and Expo

```tsx
import { DatraEngage } from "@datra/engage-sdk";
import { DatraEngageProvider, useEngageMessages } from "@datra/engage-sdk/react";

const engage = new DatraEngage({
  baseUrl: "https://api.datra.uz",
  publicKey: "pk_live_xxx",
  platform: "ios",
  appVersion: "1.5.0",
  resolveTimeoutMs: 2000,
});

export function App() {
  return (
    <DatraEngageProvider client={engage}>
      <HomeScreen customerExternalId="customer_123" />
    </DatraEngageProvider>
  );
}

function HomeScreen({ customerExternalId }: { customerExternalId: string }) {
  const { messages, isLoading, refresh } = useEngageMessages("home", {
    placement: "home_top_banner",
    customerExternalId,
    trackShown: {
      idempotencyKeyPrefix: `home:${customerExternalId}`,
    },
  });

  if (isLoading || messages.length === 0) {
    return null;
  }

  return renderInAppMessage(messages[0], { refresh });
}
```

React is an optional peer dependency. The core SDK does not import React unless you use `@datra/engage-sdk/react`.

More examples:

- `examples/react-native-home-screen.tsx`
- `examples/web-home.ts`
- `examples/hoty-dogy-action-handler.ts`

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

Resolve requests fail open in mobile apps: the default resolve timeout is 2000 ms with no
retry. Event tracking uses a 3 second timeout, retries once, and can be persisted in the event queue.

```ts
const engage = new DatraEngage({
  baseUrl: "https://api.datra.uz",
  publicKey: "pk_live_xxx",
  resolveTimeoutMs: 2000,
  eventTimeoutMs: 3000,
  resolveRetries: 0,
  eventRetries: 1,
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

Use `screenViewedSafe` or `getMessagesSafe` when Engage must never block the host application.
Identical concurrent resolve calls are coalesced automatically, and a newer request for the same
customer/placement cancels an older stale request.

`await engage.getDiagnostics()` returns aggregate resolve/event/retry/timeout/single-flight and
queued-event counters plus per-placement resolve calls, network requests, outcomes and latency.
Diagnostics never include customer identifiers or public keys and are capped at 100 placement keys;
additional keys are aggregated under `__other__`.

```ts
const diagnostics = await engage.getDiagnostics();
console.log(diagnostics.placements.home_top_banner);
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

---

<p align="center">
  <a href="https://datra.uz">
    <img src="./assets/datra-logo.png" alt="Datra" width="44" />
  </a>
</p>

<p align="center">
  Built by <a href="https://datra.uz">Datra</a>. Read the full <a href="https://api.datra.uz/redoc">Datra API documentation</a>.
</p>
