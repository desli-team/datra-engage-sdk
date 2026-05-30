# Datra Engage SDK

JavaScript/TypeScript client for Datra Engage in-app messages.

The SDK only resolves and tracks messages. It cannot apply promotions, redeem loyalty points, create orders, or mutate customer data. Promotion validation must still happen on the application backend through Datra Core.

## Install

```bash
npm install @datra/engage-sdk
```

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

## Render Messages

Datra Engage returns structured data. The app decides how to render it in its own native UI.

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

## Tracking

Use strict tracking when the app should know about a failure:

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

Use safe tracking for non-blocking UI events. Safe methods never throw and return `{ accepted, response?, error? }`.

```ts
await engage.messageShownSafe("decision_id");
await engage.messageClickedSafe("decision_id");
await engage.messageDismissedSafe("decision_id");
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

## Timeout And Retry

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

You can also pass a number for simple retry configuration:

```ts
const engage = new DatraEngage({
  baseUrl: "https://api.datra.uz",
  publicKey: "pk_live_xxx",
  retry: 0,
});
```

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

export function HomeScreen({ customerExternalId }: { customerExternalId: string }) {
  const [messages, setMessages] = useState<EngageResolvedMessage[]>([]);

  useEffect(() => {
    engage.identify({ customerExternalId });

    let mounted = true;
    engage
      .screenViewed("home")
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

## API Contract

The SDK calls:

- `POST /api/v1/engage/messages/resolve`
- `POST /api/v1/engage/events`

Authorization uses the public SDK key in the `x-datra-public-key` header.

## Package Scripts

```bash
npm run build
npm run typecheck
npm test
```
