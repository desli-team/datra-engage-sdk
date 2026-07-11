export * from "./types.js";

import type {
  DatraEngageConfig,
  DatraEngageDedupeConfig,
  DatraEngageIdentity,
  DatraEngageEventQueueConfig,
  DatraEngageRetryConfig,
  DatraEngageStorage,
  DatraEngageActionHandlers,
  DatraEngageActionHandler,
  EngageAction,
  EngageEventType,
  EngageFetch,
  EngageResolvedMessage,
  FlushEngageEventQueueResult,
  QueuedEngageEvent,
  ResolveEngageMessagesResponse,
  ResolveMessagesInput,
  SafeTrackEventResult,
  ScreenViewedInput,
  TrackBatchEventOptions,
  TrackEngageEventResponse,
  TrackEventInput,
  TrackEventOptions,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_CONFIG: Required<DatraEngageRetryConfig> = {
  retries: 1,
  retryDelayMs: 250,
  maxRetryDelayMs: 1500,
  retryStatuses: [408, 429, 500, 502, 503, 504],
};
const DEFAULT_EVENT_QUEUE_STORAGE_KEY = "datra:engage:event-queue";
const DEFAULT_EVENT_QUEUE_MAX_EVENTS = 100;
const DEFAULT_DEDUPE_STORAGE_KEY = "datra:engage:dedupe";
const DEFAULT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEDUPE_MAX_KEYS = 500;

type NormalizedEventQueueConfig = {
  enabled: boolean;
  storage: DatraEngageStorage;
  storageKey: string;
  maxEvents: number;
};

type NormalizedDedupeConfig = {
  enabled: boolean;
  storage: DatraEngageStorage;
  storageKey: string;
  ttlMs: number;
  maxKeys: number;
};

export class DatraEngageError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "DatraEngageError";
    this.status = status;
    this.body = body;
  }
}

export class DatraEngage {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly publicKey: string;
  private readonly fetchImpl: EngageFetch;
  private readonly timeoutMs: number;
  private readonly retryConfig: Required<DatraEngageRetryConfig>;
  private readonly eventQueueConfig: NormalizedEventQueueConfig;
  private readonly dedupeConfig: NormalizedDedupeConfig;
  private readonly onError?: DatraEngageConfig["onError"];
  private readonly inFlightDedupeKeys = new Set<string>();
  private customerExternalId?: string;
  private platform?: string;
  private appVersion?: string;
  private locale?: string;
  private defaultContext: Record<string, unknown>;

  constructor(config: DatraEngageConfig) {
    if (!config.baseUrl?.trim()) {
      throw new Error("DatraEngage baseUrl is required");
    }
    if (!config.publicKey?.trim()) {
      throw new Error("DatraEngage publicKey is required");
    }

    const fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) {
      throw new Error("DatraEngage requires fetch. Pass fetchImpl in this runtime.");
    }

    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    this.apiPrefix = normalizeApiPrefix(config.apiPrefix ?? "/api/v1");
    this.publicKey = config.publicKey.trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = normalizePositiveNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.retryConfig = normalizeRetryConfig(config.retry);
    this.eventQueueConfig = normalizeEventQueueConfig(config.eventQueue);
    this.dedupeConfig = normalizeDedupeConfig(config.dedupe);
    this.onError = config.onError;
    this.customerExternalId = normalizeOptionalString(config.customerExternalId);
    this.platform = normalizeOptionalString(config.platform);
    this.appVersion = normalizeOptionalString(config.appVersion);
    this.locale = normalizeOptionalString(config.locale);
    this.defaultContext = config.defaultContext ?? {};
  }

  identify(identity: DatraEngageIdentity) {
    if ("customerExternalId" in identity) {
      this.customerExternalId = normalizeOptionalString(identity.customerExternalId);
    }
    if ("platform" in identity) {
      this.platform = normalizeOptionalString(identity.platform);
    }
    if ("appVersion" in identity) {
      this.appVersion = normalizeOptionalString(identity.appVersion);
    }
    if ("locale" in identity) {
      this.locale = normalizeOptionalString(identity.locale);
    }
    if (identity.context) {
      this.defaultContext = {
        ...this.defaultContext,
        ...identity.context,
      };
    }
  }

  setCustomerExternalId(customerExternalId?: string) {
    this.customerExternalId = normalizeOptionalString(customerExternalId);
  }

  async screenViewed(screen: string, input: ScreenViewedInput = {}) {
    const normalizedScreen = screen.trim();
    if (!normalizedScreen) {
      throw new Error("screen is required");
    }

    return this.getMessages({
      ...input,
      screen: normalizedScreen,
      placement: input.placement ?? normalizedScreen,
    });
  }

  async getMessages(input: ResolveMessagesInput): Promise<ResolveEngageMessagesResponse> {
    const placement = input.placement.trim();
    if (!placement) {
      throw new Error("placement is required");
    }

    return this.request<ResolveEngageMessagesResponse>("/engage/messages/resolve", {
      customerExternalId: normalizeOptionalString(input.customerExternalId) ?? this.customerExternalId,
      placement,
      screen: normalizeOptionalString(input.screen),
      platform: normalizeOptionalString(input.platform) ?? this.platform,
      appVersion: normalizeOptionalString(input.appVersion) ?? this.appVersion,
      locale: normalizeOptionalString(input.locale) ?? this.locale,
      context: mergeContext(this.defaultContext, input.context),
      limit: input.limit,
    });
  }

  async trackEvent(input: TrackEventInput): Promise<TrackEngageEventResponse> {
    const normalized = this.normalizeTrackEventInput(input);

    return this.request<TrackEngageEventResponse>("/engage/events", {
      decisionId: normalized.decisionId,
      eventType: normalized.eventType,
      customerExternalId: normalized.customerExternalId,
      idempotencyKey: normalized.idempotencyKey,
      metadata: normalized.metadata,
    });
  }

  messageShown(decisionId: string, options?: TrackEventOptions) {
    return this.trackMessageEvent(decisionId, "SHOWN", options);
  }

  messageClicked(decisionId: string, options?: TrackEventOptions) {
    return this.trackMessageEvent(decisionId, "CLICKED", options);
  }

  messageDismissed(decisionId: string, options?: TrackEventOptions) {
    return this.trackMessageEvent(decisionId, "DISMISSED", options);
  }

  messageConverted(decisionId: string, options?: TrackEventOptions) {
    return this.trackMessageEvent(decisionId, "CONVERTED", options);
  }

  async trackEventSafe(input: TrackEventInput): Promise<SafeTrackEventResult> {
    const normalized = this.normalizeTrackEventInput(input);
    const dedupeKey = createEventDedupeKey(normalized);

    if (this.inFlightDedupeKeys.has(dedupeKey) || await this.hasDedupeKey(dedupeKey)) {
      return {
        accepted: true,
        deduped: true,
      };
    }

    this.inFlightDedupeKeys.add(dedupeKey);
    try {
      const response = await this.trackEvent(normalized);
      await this.markDedupeKey(dedupeKey);
      return {
        accepted: response.accepted,
        response,
      };
    } catch (error) {
      const queued = await this.queueTrackEventIfRetryable(normalized, error);
      return {
        accepted: false,
        error,
        queued,
      };
    } finally {
      this.inFlightDedupeKeys.delete(dedupeKey);
    }
  }

  messageShownSafe(decisionId: string, options?: TrackEventOptions) {
    return this.trackMessageEventSafe(decisionId, "SHOWN", options);
  }

  messageClickedSafe(decisionId: string, options?: TrackEventOptions) {
    return this.trackMessageEventSafe(decisionId, "CLICKED", options);
  }

  messageDismissedSafe(decisionId: string, options?: TrackEventOptions) {
    return this.trackMessageEventSafe(decisionId, "DISMISSED", options);
  }

  messageConvertedSafe(decisionId: string, options?: TrackEventOptions) {
    return this.trackMessageEventSafe(decisionId, "CONVERTED", options);
  }

  async trackShown(
    messages: Iterable<Pick<EngageResolvedMessage, "decisionId">>,
    options: TrackBatchEventOptions = {},
  ) {
    const results: SafeTrackEventResult[] = [];
    for (const message of messages) {
      results.push(await this.messageShownSafe(message.decisionId, {
        customerExternalId: options.customerExternalId,
        idempotencyKey: options.idempotencyKeyPrefix
          ? `${options.idempotencyKeyPrefix}:shown:${message.decisionId}`
          : undefined,
        metadata: options.metadata,
      }));
    }
    return results;
  }

  async flushEventQueue(): Promise<FlushEngageEventQueueResult> {
    if (!this.eventQueueConfig.enabled) {
      return {
        attempted: 0,
        sent: 0,
        failed: 0,
        remaining: 0,
      };
    }

    const queued = await this.readQueuedEvents();
    const remaining: QueuedEngageEvent[] = [];
    let sent = 0;
    let failed = 0;

    for (const item of queued) {
      try {
        await this.trackEvent(item.input);
        await this.markDedupeKey(createEventDedupeKey(this.normalizeTrackEventInput(item.input)));
        sent += 1;
      } catch (error) {
        failed += 1;
        if (isRetryableError(error, this.retryConfig.retryStatuses)) {
          remaining.push({
            ...item,
            attempts: item.attempts + 1,
            lastError: stringifyError(error),
          });
        }
      }
    }

    await this.writeQueuedEvents(remaining);

    return {
      attempted: queued.length,
      sent,
      failed,
      remaining: remaining.length,
    };
  }

  async getQueuedEventCount() {
    if (!this.eventQueueConfig.enabled) {
      return 0;
    }

    const queued = await this.readQueuedEvents();
    return queued.length;
  }

  async clearEventQueue() {
    if (!this.eventQueueConfig.enabled) {
      return;
    }

    await this.eventQueueConfig.storage.removeItem(this.eventQueueConfig.storageKey);
  }

  private trackMessageEvent(
    decisionId: string,
    eventType: EngageEventType,
    options: TrackEventOptions = {},
  ) {
    return this.trackEvent({
      decisionId,
      eventType,
      customerExternalId: options.customerExternalId,
      idempotencyKey: options.idempotencyKey,
      metadata: options.metadata,
    });
  }

  private trackMessageEventSafe(
    decisionId: string,
    eventType: EngageEventType,
    options: TrackEventOptions = {},
  ) {
    return this.trackEventSafe({
      decisionId,
      eventType,
      customerExternalId: options.customerExternalId,
      idempotencyKey: options.idempotencyKey,
      metadata: options.metadata,
    });
  }

  private normalizeTrackEventInput(input: TrackEventInput): TrackEventInput {
    const decisionId = input.decisionId.trim();
    if (!decisionId) {
      throw new Error("decisionId is required");
    }

    return {
      decisionId,
      eventType: input.eventType,
      customerExternalId: normalizeOptionalString(input.customerExternalId) ?? this.customerExternalId,
      idempotencyKey: normalizeOptionalString(input.idempotencyKey)
        ?? createDefaultIdempotencyKey(decisionId, input.eventType),
      metadata: input.metadata,
    };
  }

  private async queueTrackEventIfRetryable(input: TrackEventInput, error: unknown) {
    if (!this.eventQueueConfig.enabled || !isRetryableError(error, this.retryConfig.retryStatuses)) {
      return false;
    }

    try {
      const queued = await this.readQueuedEvents();
      const idempotencyKey = normalizeOptionalString(input.idempotencyKey);
      if (idempotencyKey && queued.some((item) => item.input.idempotencyKey === idempotencyKey)) {
        return true;
      }

      queued.push({
        id: createQueueEventId(),
        input,
        createdAt: new Date().toISOString(),
        attempts: 0,
        lastError: stringifyError(error),
      });

      await this.writeQueuedEvents(queued.slice(-this.eventQueueConfig.maxEvents));
      return true;
    } catch (queueError) {
      this.onError?.(queueError, {
        path: "/engage/events/queue",
        attempt: 1,
        retryable: false,
      });
      return false;
    }
  }

  private async readQueuedEvents(): Promise<QueuedEngageEvent[]> {
    try {
      const raw = await this.eventQueueConfig.storage.getItem(this.eventQueueConfig.storageKey);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(isQueuedEngageEvent);
    } catch {
      return [];
    }
  }

  private async writeQueuedEvents(events: QueuedEngageEvent[]) {
    await this.eventQueueConfig.storage.setItem(
      this.eventQueueConfig.storageKey,
      JSON.stringify(events),
    );
  }

  private async hasDedupeKey(key: string) {
    if (!this.dedupeConfig.enabled) {
      return false;
    }

    const entries = await this.readDedupeEntries();
    const createdAt = entries[key];
    if (!createdAt) {
      return false;
    }

    if (Date.now() - createdAt > this.dedupeConfig.ttlMs) {
      delete entries[key];
      await this.writeDedupeEntries(entries);
      return false;
    }

    return true;
  }

  private async markDedupeKey(key: string) {
    if (!this.dedupeConfig.enabled) {
      return;
    }

    const entries = await this.readDedupeEntries();
    entries[key] = Date.now();
    await this.writeDedupeEntries(trimDedupeEntries(entries, this.dedupeConfig.maxKeys));
  }

  private async readDedupeEntries(): Promise<Record<string, number>> {
    try {
      const raw = await this.dedupeConfig.storage.getItem(this.dedupeConfig.storageKey);
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, number] =>
          typeof entry[0] === "string" && typeof entry[1] === "number",
        ),
      );
    } catch {
      return {};
    }
  }

  private async writeDedupeEntries(entries: Record<string, number>) {
    await this.dedupeConfig.storage.setItem(
      this.dedupeConfig.storageKey,
      JSON.stringify(entries),
    );
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let lastError: unknown;
    const maxAttempts = this.retryConfig.retries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.sendOnce<T>(path, body);
      } catch (error) {
        lastError = error;
        const retryable = isRetryableError(error, this.retryConfig.retryStatuses);
        this.onError?.(error, {
          path,
          attempt,
          retryable,
        });

        if (!retryable || attempt >= maxAttempts) {
          throw error;
        }

        await sleep(getRetryDelay(attempt, this.retryConfig));
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Datra Engage request failed");
  }

  private async sendOnce<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : undefined;

    try {
      const response = await this.fetchImpl(this.buildUrl(path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-datra-public-key": this.publicKey,
        },
        signal: controller?.signal,
        body: JSON.stringify(stripUndefined(body)),
      });
      const responseBody = await readResponseBody(response);

      if (!response.ok) {
        throw new DatraEngageError(
          resolveErrorMessage(responseBody, response.status),
          response.status,
          responseBody,
        );
      }

      return responseBody as T;
    } catch (error) {
      if (isAbortError(error)) {
        throw new DatraEngageError("Datra Engage request timed out", 0, {
          code: "TIMEOUT",
          timeoutMs: this.timeoutMs,
        });
      }
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private buildUrl(path: string) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    if (this.apiPrefix && this.baseUrl.endsWith(this.apiPrefix)) {
      return `${this.baseUrl}${normalizedPath}`;
    }
    return `${this.baseUrl}${this.apiPrefix}${normalizedPath}`;
  }
}

function normalizeApiPrefix(value: string) {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

function normalizePositiveNumber(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeRetryConfig(value: DatraEngageRetryConfig | number | undefined) {
  if (typeof value === "number") {
    return {
      ...DEFAULT_RETRY_CONFIG,
      retries: Math.max(0, Math.floor(value)),
    };
  }

  return {
    retries: Math.max(0, Math.floor(value?.retries ?? DEFAULT_RETRY_CONFIG.retries)),
    retryDelayMs: normalizePositiveNumber(value?.retryDelayMs, DEFAULT_RETRY_CONFIG.retryDelayMs),
    maxRetryDelayMs: normalizePositiveNumber(value?.maxRetryDelayMs, DEFAULT_RETRY_CONFIG.maxRetryDelayMs),
    retryStatuses: value?.retryStatuses?.length ? value.retryStatuses : DEFAULT_RETRY_CONFIG.retryStatuses,
  };
}

function normalizeEventQueueConfig(
  value: boolean | DatraEngageEventQueueConfig | undefined,
): NormalizedEventQueueConfig {
  if (value === false) {
    return {
      enabled: false,
      storage: createMemoryStorageAdapter(),
      storageKey: DEFAULT_EVENT_QUEUE_STORAGE_KEY,
      maxEvents: DEFAULT_EVENT_QUEUE_MAX_EVENTS,
    };
  }

  const config = typeof value === "object" ? value : {};
  return {
    enabled: config.enabled ?? value === true,
    storage: config.storage ?? createMemoryStorageAdapter(),
    storageKey: config.storageKey?.trim() || DEFAULT_EVENT_QUEUE_STORAGE_KEY,
    maxEvents: normalizePositiveNumber(config.maxEvents, DEFAULT_EVENT_QUEUE_MAX_EVENTS),
  };
}

function normalizeDedupeConfig(
  value: boolean | DatraEngageDedupeConfig | undefined,
): NormalizedDedupeConfig {
  if (value === false) {
    return {
      enabled: false,
      storage: createMemoryStorageAdapter(),
      storageKey: DEFAULT_DEDUPE_STORAGE_KEY,
      ttlMs: DEFAULT_DEDUPE_TTL_MS,
      maxKeys: DEFAULT_DEDUPE_MAX_KEYS,
    };
  }

  const config = typeof value === "object" ? value : {};
  return {
    enabled: config.enabled ?? true,
    storage: config.storage ?? createMemoryStorageAdapter(),
    storageKey: config.storageKey?.trim() || DEFAULT_DEDUPE_STORAGE_KEY,
    ttlMs: normalizePositiveNumber(config.ttlMs, DEFAULT_DEDUPE_TTL_MS),
    maxKeys: normalizePositiveNumber(config.maxKeys, DEFAULT_DEDUPE_MAX_KEYS),
  };
}

function normalizeOptionalString(value?: string) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function mergeContext(
  defaultContext: Record<string, unknown>,
  requestContext?: Record<string, unknown>,
) {
  const merged = {
    ...defaultContext,
    ...(requestContext ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function stripUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function createDefaultIdempotencyKey(decisionId: string, eventType: EngageEventType) {
  return `datra:${eventType.toLowerCase()}:${decisionId}`;
}

function createEventDedupeKey(input: TrackEventInput) {
  return input.idempotencyKey
    ? `idempotency:${input.idempotencyKey}`
    : `${input.eventType}:${input.decisionId}`;
}

function createQueueEventId() {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function isQueuedEngageEvent(value: unknown): value is QueuedEngageEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as QueuedEngageEvent;
  return (
    typeof item.id === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.attempts === "number" &&
    Boolean(item.input) &&
    typeof item.input.decisionId === "string" &&
    typeof item.input.eventType === "string"
  );
}

function trimDedupeEntries(entries: Record<string, number>, maxKeys: number) {
  const sorted = Object.entries(entries).sort((left, right) => right[1] - left[1]);
  return Object.fromEntries(sorted.slice(0, maxKeys));
}

function stringifyError(error: unknown) {
  if (error instanceof DatraEngageError) {
    return `${error.name}: ${error.message}`;
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

function isRetryableError(error: unknown, retryStatuses: number[]) {
  if (error instanceof DatraEngageError) {
    return error.status === 0 || retryStatuses.includes(error.status);
  }
  return true;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function getRetryDelay(attempt: number, config: Required<DatraEngageRetryConfig>) {
  const delay = config.retryDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, config.maxRetryDelayMs);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function resolveErrorMessage(body: unknown, status: number) {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return `Datra Engage request failed with status ${status}`;
}

export function createDatraEngage(config: DatraEngageConfig) {
  return new DatraEngage(config);
}

export function createDatraEngageActionHandler(
  handlers: DatraEngageActionHandlers,
): DatraEngageActionHandler {
  return async (action?: EngageAction | null, message?: EngageResolvedMessage) => {
    if (!action || !action.type || action.type === "NONE") {
      return;
    }

    const type = String(action.type).toUpperCase();
    if (type === "OPEN_SCREEN" && action.screen) {
      await handlers.onOpenScreen?.(String(action.screen), action, message);
      return;
    }

    if (type === "OPEN_PROMOTION" && action.promotionId) {
      await handlers.onOpenPromotion?.(String(action.promotionId), action, message);
      return;
    }

    if (type === "OPEN_COUPON" && action.couponId) {
      await handlers.onOpenCoupon?.(String(action.couponId), action, message);
      return;
    }

    if (type === "OPEN_PRODUCT" && action.productId) {
      await handlers.onOpenProduct?.(String(action.productId), action, message);
      return;
    }

    if (type === "OPEN_CART") {
      await handlers.onOpenCart?.(action, message);
      return;
    }

    if (type === "OPEN_URL" && action.url) {
      await handlers.onOpenUrl?.(String(action.url), action, message);
      return;
    }

    if (type === "OPEN_STORY" && action.storyId) {
      await handlers.onOpenStory?.(String(action.storyId), action, message);
      return;
    }

    if (type === "OPEN_MECHANIC" && action.mechanicId) {
      await handlers.onOpenMechanic?.(String(action.mechanicId), action, message);
      return;
    }

    await handlers.onUnhandledAction?.(action, message);
  };
}

export function createMemoryStorageAdapter(
  initialValues: Record<string, string> = {},
): DatraEngageStorage {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

export function createWebStorageAdapter(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined =
    typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : undefined,
  keyPrefix = "",
): DatraEngageStorage {
  if (!storage) {
    throw new Error("Web storage is not available in this runtime.");
  }

  const normalizeKey = (key: string) => `${keyPrefix}${key}`;
  return {
    getItem(key) {
      return storage.getItem(normalizeKey(key));
    },
    setItem(key, value) {
      storage.setItem(normalizeKey(key), value);
    },
    removeItem(key) {
      storage.removeItem(normalizeKey(key));
    },
  };
}
