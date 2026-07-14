import {
  DatraEngage,
  createWebStorageAdapter,
  type EngageResolvedMessage,
} from "@datra/engage-sdk";

const engage = new DatraEngage({
  baseUrl: "https://api.datra.uz",
  publicKey: "pk_live_xxx",
  customerExternalId: "customer_123",
  platform: "web",
  appVersion: "1.5.0",
  locale: "ru",
  resolveTimeoutMs: 2000,
  eventQueue: {
    enabled: true,
    storage: createWebStorageAdapter(window.localStorage, "hoty-dogy:"),
  },
  dedupe: {
    enabled: true,
    storage: createWebStorageAdapter(window.localStorage, "hoty-dogy:"),
  },
});

export async function renderHomeBanner() {
  await engage.flushEventQueue();

  const { messages } = await engage.screenViewed("home", {
    placement: "home_top_banner",
    context: {
      branchExternalId: "branch_1",
    },
  });

  const banner = messages.find((message) => message.type === "BANNER");
  if (!banner) {
    return;
  }

  renderBanner(banner);
  await engage.messageShownSafe(banner.decisionId);
}

function renderBanner(message: EngageResolvedMessage) {
  const element = document.querySelector("[data-datra-placement='home_top_banner']");
  if (!element) {
    return;
  }

  element.innerHTML = `
    <button type="button">
      <strong>${escapeHtml(message.title)}</strong>
      ${message.body ? `<span>${escapeHtml(message.body)}</span>` : ""}
    </button>
  `;

  element.querySelector("button")?.addEventListener("click", async () => {
    await engage.messageClickedSafe(message.decisionId);
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;",
    };
    return entities[char] ?? char;
  });
}
