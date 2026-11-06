export * from "./types.js";

import type {
  DatraEngageConfig,
  DatraEngageDedupeConfig,
  DatraEngageDiagnostics,
  DatraEngagePlacementDiagnostics,
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
  GetLoyaltyQrInput,
  LoyaltyQr,
  LoyaltyQrPlatform,
  LoyaltyQrSessionOptions,
  LoyaltyQrSessionState,
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

const DEFAULT_RESOLVE_TIMEOUT_MS = 2000;
const DEFAULT_EVENT_TIMEOUT_MS = 3000;
const DEFAULT_RETRY_CONFIG: Required<DatraEngageRetryConfig> = {
  retries: 1,
  retryDelayMs: 250,
  maxRetryDelayMs: 1500,
  retryStatuses: [408, 429, 500, 502, 503, 504],
};
const DEFAULT_EVENT_QUEUE_STORAGE_KEY = "datra:engage:event-queue";
const DEFAULT_EVENT_QUEUE_MAX_EVENTS = 100;
const DEFAULT_EVENT_QUEUE_FLUSH_CONCURRENCY = 3;
const DEFAULT_DEDUPE_STORAGE_KEY = "datra:engage:dedupe";
const DEFAULT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEDUPE_MAX_KEYS = 500;
const MAX_PLACEMENT_DIAGNOSTICS = 100;
const DEFAULT_LOYALTY_QR_TIMEOUT_MS = 5000;
// Datra limits issuance to 6 requests per minute per customer. A retry could only burn that budget, so the QR
// request is sent exactly once; callers decide when to ask again (see createLoyaltyQrSession).
const LOYALTY_QR_RETRY_CONFIG: Required<DatraEngageRetryConfig> = {
  ...DEFAULT_RETRY_CONFIG,
  retries: 0,
};
const LOYALTY_QR_PATH = "/engage/loyalty/qr";
const LOYALTY_QR_TOKEN_PATTERN = /^dq1_[0-9a-f]{64}$/;
const LOYALTY_QR_PLATFORMS: readonly LoyaltyQrPlatform[] = ["ios", "android", "web"];
const LOYALTY_QR_DEFAULT_RETRY_AFTER_SEC = 60;
const LOYALTY_QR_MAX_RETRY_AFTER_SEC = 3600;
const DEFAULT_LOYALTY_QR_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_LOYALTY_QR_ERROR_RETRY_DELAY_MS = 15000;
const OTHER_PLACEMENT_DIAGNOSTICS_KEY = "__other__";

type NormalizedEventQueueConfig = {
  enabled: boolean;
  storage: DatraEngageStorage;
  storageKey: string;
  maxEvents: number;
  flushConcurrency: number;
};

type NormalizedDedupeConfig = {
  enabled: boolean;
  storage: DatraEngageStorage;
  storageKey: string;
  ttlMs: number;
  maxKeys: number;
};

type EngageRequestOptions<T = unknown> = {
  timeoutMs: number;
  retryConfig: Required<DatraEngageRetryConfig>;
  signal?: AbortSignal;
  /** Builds a typed error for a non-2xx response; falls back to DatraEngageError. */
  mapErrorResponse?: (response: Response, body: unknown) => Error | undefined;
  /** Validates and converts a 2xx body. Throwing here fails the request without exposing the body. */
  parse?: (body: unknown, status: number) => T;
};

type MutablePlacementDiagnostics = Omit<
  DatraEngagePlacementDiagnostics,
  "averageDurationMs"
> & {
  completedRequests: number;
  totalDurationMs: number;
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

/** The tenant or app key has loyalty QR switched off (HTTP 404). Hide or disable the QR entry point. */
export class LoyaltyQrUnavailableError extends DatraEngageError {
  constructor(body: unknown) {
    super("Datra loyalty QR is not available", 404, body);
    this.name = "LoyaltyQrUnavailableError";
  }
}

/** Too many QR requests for this customer (HTTP 429). Do not ask again before `retryAfterSec`. */
export class LoyaltyQrRateLimitError extends DatraEngageError {
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number, body: unknown) {
    super(`Datra loyalty QR rate limited, retry after ${retryAfterSec} s`, 429, body);
    this.name = "LoyaltyQrRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

/** The QR response did not match the contract. The body is deliberately not attached: it may hold a token. */
export class LoyaltyQrResponseError extends DatraEngageError {
  constructor(field: string, status: number) {
    super(`Datra loyalty QR response is invalid (${field})`, status, {
      code: "INVALID_LOYALTY_QR_RESPONSE",
      field,
    });
    this.name = "LoyaltyQrResponseError";
  }
}

export class DatraEngage {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly publicKey: string;
  private readonly fetchImpl: EngageFetch;
  private readonly resolveTimeoutMs: number;
  private readonly eventTimeoutMs: number;
  private readonly loyaltyQrTimeoutMs: number;
  private readonly resolveRetryConfig: Required<DatraEngageRetryConfig>;
  private readonly eventRetryConfig: Required<DatraEngageRetryConfig>;
  private readonly eventQueueConfig: NormalizedEventQueueConfig;
  private readonly dedupeConfig: NormalizedDedupeConfig;
  private readonly onError?: DatraEngageConfig["onError"];
  private readonly inFlightDedupeKeys = new Set<string>();
  private readonly inFlightResolves = new Map<
    string,
    { signature: string; controller: AbortController; promise: Promise<ResolveEngageMessagesResponse> }
  >();
  // In-flight QR requests only, so a double tap or a re-render does not issue two tokens. Entries are removed as
  // soon as the request settles: tokens are never cached.
  private readonly inFlightLoyaltyQr = new Map<string, Promise<LoyaltyQr>>();
  // customerExternalId -> epoch ms before which Datra asked us not to request a QR again (Retry-After).
  private readonly loyaltyQrBlockedUntil = new Map<string, number>();
  private flushPromise?: Promise<FlushEngageEventQueueResult>;
  private readonly diagnostics = {
    resolveRequests: 0,
    eventRequests: 0,
    retries: 0,
    timeouts: 0,
    singleFlightHits: 0,
    staleResolveCancellations: 0,
  };
  private readonly placementDiagnostics = new Map<string, MutablePlacementDiagnostics>();
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
    this.resolveTimeoutMs = normalizePositiveNumber(
      config.resolveTimeoutMs ?? config.timeoutMs,
      DEFAULT_RESOLVE_TIMEOUT_MS,
    );
    this.eventTimeoutMs = normalizePositiveNumber(
      config.eventTimeoutMs ?? config.timeoutMs,
      DEFAULT_EVENT_TIMEOUT_MS,
    );
    this.loyaltyQrTimeoutMs = normalizePositiveNumber(
      config.loyaltyQrTimeoutMs,
      DEFAULT_LOYALTY_QR_TIMEOUT_MS,
    );
    this.resolveRetryConfig = normalizeRetryConfig(
      config.resolveRetries ?? config.retry ?? 0,
    );
    this.eventRetryConfig = normalizeRetryConfig(
      config.eventRetries ?? config.retry ?? 1,
    );
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
      const nextCustomerExternalId = normalizeOptionalString(identity.customerExternalId);
      if (nextCustomerExternalId !== this.customerExternalId) this.cancelPendingResolves();
      this.customerExternalId = nextCustomerExternalId;
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
    const nextCustomerExternalId = normalizeOptionalString(customerExternalId);
    if (nextCustomerExternalId !== this.customerExternalId) this.cancelPendingResolves();
    this.customerExternalId = nextCustomerExternalId;
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
    this.diagnostics.resolveRequests += 1;
    const placement = input.placement.trim();
    if (!placement) {
      throw new Error("placement is required");
    }
    const placementDiagnostics = this.getPlacementDiagnostics(placement);
    placementDiagnostics.resolveCalls += 1;

    const body = {
      customerExternalId: normalizeOptionalString(input.customerExternalId) ?? this.customerExternalId,
      placement,
      screen: normalizeOptionalString(input.screen),
      platform: normalizeOptionalString(input.platform) ?? this.platform,
      appVersion: normalizeOptionalString(input.appVersion) ?? this.appVersion,
      locale: normalizeOptionalString(input.locale) ?? this.locale,
      context: mergeContext(this.defaultContext, input.context),
      limit: input.limit,
    };
    const scope = [body.customerExternalId ?? "anonymous", placement, body.screen ?? "*"].join(":");
    // Object insertion order must not turn the same eligibility context into
    // competing network requests. This is common when a screen rebuilds its
    // context from independent state sources.
    const signature = stableStringify(stripUndefined(body));
    const existing = this.inFlightResolves.get(scope);
    if (existing?.signature === signature) {
      this.diagnostics.singleFlightHits += 1;
      placementDiagnostics.singleFlightHits += 1;
      return awaitWithCallerAbort(existing.promise, input.signal);
    }
    if (existing) {
      this.diagnostics.staleResolveCancellations += 1;
      existing.controller.abort();
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    placementDiagnostics.networkRequests += 1;
    const promise = this.request<ResolveEngageMessagesResponse>(
      "/engage/messages/resolve",
      body,
      {
        timeoutMs: this.resolveTimeoutMs,
        retryConfig: this.resolveRetryConfig,
        signal: controller.signal,
      },
    )
      .then((response) => {
        placementDiagnostics.successfulRequests += 1;
        if (response.messages.length === 0) {
          placementDiagnostics.emptyResponses += 1;
        }
        return response;
      })
      .catch((error: unknown) => {
        const errorCode = getDatraEngageErrorCode(error);
        if (errorCode === "TIMEOUT") {
          placementDiagnostics.timeouts += 1;
        } else if (errorCode === "ABORTED") {
          placementDiagnostics.cancellations += 1;
        } else {
          placementDiagnostics.errors += 1;
        }
        throw error;
      })
      .finally(() => {
        const durationMs = Math.max(0, Date.now() - startedAt);
        placementDiagnostics.completedRequests += 1;
        placementDiagnostics.totalDurationMs += durationMs;
        placementDiagnostics.lastDurationMs = durationMs;
        placementDiagnostics.maxDurationMs = Math.max(
          placementDiagnostics.maxDurationMs,
          durationMs,
        );
        if (this.inFlightResolves.get(scope)?.promise === promise) {
          this.inFlightResolves.delete(scope);
        }
      });
    this.inFlightResolves.set(scope, { signature, controller, promise });
    // A component unmounting must not cancel the shared request for another
    // component rendering the same placement. Stale *payloads* still cancel
    // the underlying request above.
    return awaitWithCallerAbort(promise, input.signal);
  }

  async getMessagesSafe(input: ResolveMessagesInput): Promise<ResolveEngageMessagesResponse> {
    try {
      return await this.getMessages(input);
    } catch {
      return { messages: [] };
    }
  }

  async screenViewedSafe(
    screen: string,
    input: ScreenViewedInput = {},
  ): Promise<ResolveEngageMessagesResponse> {
    const normalizedScreen = screen.trim();
    if (!normalizedScreen) throw new Error("screen is required");
    return this.getMessagesSafe({
      ...input,
      screen: normalizedScreen,
      placement: input.placement ?? normalizedScreen,
    });
  }

  cancelPendingResolves(): void {
    for (const resolve of this.inFlightResolves.values()) resolve.controller.abort();
    this.inFlightResolves.clear();
  }

  /**
   * Issues a one-time loyalty QR token for the customer (`POST /engage/loyalty/qr`).
   *
   * The returned `qr` is a bearer secret valid for about a minute: render it, ask again after `refreshAfterSec`,
   * and never log, persist or send it to analytics. The request is never retried; concurrent identical calls share
   * one request. A 404 rejects with LoyaltyQrUnavailableError, a 429 with LoyaltyQrRateLimitError, after which
   * calls for the same customer fail fast until Retry-After has passed.
   */
  async getLoyaltyQr(input: GetLoyaltyQrInput): Promise<LoyaltyQr> {
    const body = this.normalizeLoyaltyQrInput(input);
    const customerExternalId = body.customerExternalId;
    const now = Date.now();
    const blockedUntil = this.loyaltyQrBlockedUntil.get(customerExternalId);
    if (blockedUntil !== undefined) {
      if (blockedUntil > now) {
        throw new LoyaltyQrRateLimitError(Math.max(1, Math.ceil((blockedUntil - now) / 1000)), {
          code: "RATE_LIMITED",
          local: true,
        });
      }
      this.loyaltyQrBlockedUntil.delete(customerExternalId);
    }

    const flightKey = stableStringify(body);
    const existing = this.inFlightLoyaltyQr.get(flightKey);
    if (existing) return awaitWithCallerAbort(existing, input.signal);

    const promise = this.request<LoyaltyQr>(LOYALTY_QR_PATH, body, {
      timeoutMs: this.loyaltyQrTimeoutMs,
      retryConfig: LOYALTY_QR_RETRY_CONFIG,
      mapErrorResponse: mapLoyaltyQrErrorResponse,
      parse: parseLoyaltyQrResponse,
    })
      .catch((error: unknown) => {
        if (error instanceof LoyaltyQrRateLimitError) {
          this.blockLoyaltyQr(customerExternalId, error.retryAfterSec);
        }
        throw error;
      })
      .finally(() => {
        if (this.inFlightLoyaltyQr.get(flightKey) === promise) this.inFlightLoyaltyQr.delete(flightKey);
      });
    this.inFlightLoyaltyQr.set(flightKey, promise);
    // A caller abort (screen closed) only detaches that caller; the shared request still settles once.
    return awaitWithCallerAbort(promise, input.signal);
  }

  private blockLoyaltyQr(customerExternalId: string, retryAfterSec: number) {
    const now = Date.now();
    for (const [key, until] of this.loyaltyQrBlockedUntil) {
      if (until <= now) this.loyaltyQrBlockedUntil.delete(key);
    }
    this.loyaltyQrBlockedUntil.set(customerExternalId, now + retryAfterSec * 1000);
  }

  private normalizeLoyaltyQrInput(input: GetLoyaltyQrInput) {
    const customerExternalId =
      typeof input?.customerExternalId === "string" ? input.customerExternalId.trim() : "";
    if (!customerExternalId) {
      throw new Error("customerExternalId is required");
    }
    if (customerExternalId.length > 255) {
      throw new Error("customerExternalId must be at most 255 characters");
    }

    const intent = input.intent ?? "EARN";
    if (intent !== "EARN" && intent !== "SPEND") {
      throw new Error("intent must be EARN or SPEND");
    }

    const maxSpendPoints = input.maxSpendPoints;
    if (maxSpendPoints !== undefined) {
      if (intent !== "SPEND") {
        throw new Error("maxSpendPoints is only allowed with intent SPEND");
      }
      if (!Number.isSafeInteger(maxSpendPoints) || maxSpendPoints <= 0) {
        throw new Error("maxSpendPoints must be a positive integer");
      }
    }

    let platform: LoyaltyQrPlatform | undefined;
    if (input.platform !== undefined) {
      if (!LOYALTY_QR_PLATFORMS.includes(input.platform)) {
        throw new Error("platform must be ios, android or web");
      }
      platform = input.platform;
    } else {
      const defaultPlatform = this.platform?.toLowerCase() as LoyaltyQrPlatform | undefined;
      platform = defaultPlatform && LOYALTY_QR_PLATFORMS.includes(defaultPlatform) ? defaultPlatform : undefined;
    }

    return {
      customerExternalId,
      intent,
      maxSpendPoints,
      deviceId: truncate(normalizeOptionalString(input.deviceId), 128),
      appVersion: truncate(normalizeOptionalString(input.appVersion) ?? this.appVersion, 32),
      platform,
    };
  }

  async trackEvent(input: TrackEventInput): Promise<TrackEngageEventResponse> {
    this.diagnostics.eventRequests += 1;
    const normalized = this.normalizeTrackEventInput(input);

    return this.request<TrackEngageEventResponse>(
      "/engage/events",
      {
        decisionId: normalized.decisionId,
        eventType: normalized.eventType,
        customerExternalId: normalized.customerExternalId,
        idempotencyKey: normalized.idempotencyKey,
        metadata: normalized.metadata,
      },
      { timeoutMs: this.eventTimeoutMs, retryConfig: this.eventRetryConfig },
    );
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

  flushEventQueue(): Promise<FlushEngageEventQueueResult> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushEventQueueOnce().finally(() => {
      this.flushPromise = undefined;
    });
    return this.flushPromise;
  }

  private async flushEventQueueOnce(): Promise<FlushEngageEventQueueResult> {
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

    for (let index = 0; index < queued.length; index += this.eventQueueConfig.flushConcurrency) {
      const batch = queued.slice(index, index + this.eventQueueConfig.flushConcurrency);
      const results = await Promise.all(batch.map(async (item) => {
        try {
          await this.trackEvent(item.input);
          await this.markDedupeKey(createEventDedupeKey(this.normalizeTrackEventInput(item.input)));
          return { sent: true as const };
        } catch (error) {
          return { sent: false as const, item, error };
        }
      }));
      for (const result of results) {
        if (result.sent) {
          sent += 1;
          continue;
        }
        failed += 1;
        if (isRetryableError(result.error, this.eventRetryConfig.retryStatuses)) {
          remaining.push({
            ...result.item,
            attempts: result.item.attempts + 1,
            lastError: stringifyError(result.error),
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

  async getDiagnostics(): Promise<DatraEngageDiagnostics> {
    const placements = Object.fromEntries(
      Array.from(this.placementDiagnostics.entries()).map(([placement, diagnostics]) => [
        placement,
        {
          resolveCalls: diagnostics.resolveCalls,
          networkRequests: diagnostics.networkRequests,
          successfulRequests: diagnostics.successfulRequests,
          emptyResponses: diagnostics.emptyResponses,
          timeouts: diagnostics.timeouts,
          errors: diagnostics.errors,
          cancellations: diagnostics.cancellations,
          singleFlightHits: diagnostics.singleFlightHits,
          averageDurationMs:
            diagnostics.completedRequests > 0
              ? Math.round(diagnostics.totalDurationMs / diagnostics.completedRequests)
              : 0,
          lastDurationMs: diagnostics.lastDurationMs,
          maxDurationMs: diagnostics.maxDurationMs,
        },
      ]),
    );

    return {
      ...this.diagnostics,
      queuedEvents: await this.getQueuedEventCount(),
      placements,
    };
  }

  private getPlacementDiagnostics(placement: string): MutablePlacementDiagnostics {
    const existing = this.placementDiagnostics.get(placement);
    if (existing) {
      return existing;
    }

    const diagnosticsKey =
      this.placementDiagnostics.size < MAX_PLACEMENT_DIAGNOSTICS
        ? placement
        : OTHER_PLACEMENT_DIAGNOSTICS_KEY;
    const overflowDiagnostics = this.placementDiagnostics.get(diagnosticsKey);
    if (overflowDiagnostics) {
      return overflowDiagnostics;
    }

    const diagnostics: MutablePlacementDiagnostics = {
      resolveCalls: 0,
      networkRequests: 0,
      successfulRequests: 0,
      emptyResponses: 0,
      timeouts: 0,
      errors: 0,
      cancellations: 0,
      singleFlightHits: 0,
      completedRequests: 0,
      totalDurationMs: 0,
      lastDurationMs: 0,
      maxDurationMs: 0,
    };
    this.placementDiagnostics.set(diagnosticsKey, diagnostics);
    return diagnostics;
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
    if (!this.eventQueueConfig.enabled || !isRetryableError(error, this.eventRetryConfig.retryStatuses)) {
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

  private async request<T>(
    path: string,
    body: Record<string, unknown>,
    options: EngageRequestOptions<T>,
  ): Promise<T> {
    let lastError: unknown;
    const maxAttempts = options.retryConfig.retries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.sendOnce<T>(path, body, options);
      } catch (error) {
        lastError = error;
        const retryable = isRetryableError(error, options.retryConfig.retryStatuses);
        this.onError?.(error, {
          path,
          attempt,
          retryable,
        });

        if (!retryable || attempt >= maxAttempts) {
          throw error;
        }

        this.diagnostics.retries += 1;
        await sleep(getRetryDelay(attempt, options.retryConfig));
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Datra Engage request failed");
  }

  private async sendOnce<T>(
    path: string,
    body: Record<string, unknown>,
    options: EngageRequestOptions<T>,
  ): Promise<T> {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const detachSignal = controller ? forwardAbort(options.signal, controller) : () => undefined;
    let timedOut = false;
    const timeout = controller
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, options.timeoutMs)
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
        throw options.mapErrorResponse?.(response, responseBody) ?? new DatraEngageError(
          resolveErrorMessage(responseBody, response.status),
          response.status,
          responseBody,
        );
      }

      return options.parse ? options.parse(responseBody, response.status) : responseBody as T;
    } catch (error) {
      if (isAbortError(error)) {
        if (timedOut) {
          this.diagnostics.timeouts += 1;
          throw new DatraEngageError("Datra Engage request timed out", 0, {
            code: "TIMEOUT",
            timeoutMs: options.timeoutMs,
          });
        }
        throw new DatraEngageError("Datra Engage request cancelled", 0, {
          code: "ABORTED",
        });
      }
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      detachSignal();
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
      flushConcurrency: DEFAULT_EVENT_QUEUE_FLUSH_CONCURRENCY,
    };
  }

  const config = typeof value === "object" ? value : {};
  return {
    enabled: config.enabled ?? value === true,
    storage: config.storage ?? createMemoryStorageAdapter(),
    storageKey: config.storageKey?.trim() || DEFAULT_EVENT_QUEUE_STORAGE_KEY,
    maxEvents: normalizePositiveNumber(config.maxEvents, DEFAULT_EVENT_QUEUE_MAX_EVENTS),
    flushConcurrency: Math.max(
      1,
      Math.min(
        Math.floor(
          normalizePositiveNumber(
            config.flushConcurrency,
            DEFAULT_EVENT_QUEUE_FLUSH_CONCURRENCY,
          ),
        ),
        20,
      ),
    ),
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
    return getDatraEngageErrorCode(error) !== "ABORTED" &&
      (error.status === 0 || retryStatuses.includes(error.status));
  }
  return true;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) =>
      `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function awaitWithCallerAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createCallerAbortError());

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(createCallerAbortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function createCallerAbortError() {
  return new DatraEngageError("Datra Engage request cancelled", 0, {
    code: "ABORTED",
  });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function getDatraEngageErrorCode(error: unknown): string | undefined {
  if (!(error instanceof DatraEngageError)) {
    return undefined;
  }
  if (!error.body || typeof error.body !== "object" || Array.isArray(error.body)) {
    return undefined;
  }
  const code = (error.body as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function forwardAbort(source: AbortSignal | undefined, target: AbortController) {
  if (!source) return () => undefined;
  const abort = () => target.abort();
  if (source.aborted) {
    target.abort();
    return () => undefined;
  }
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

function truncate(value: string | undefined, maxLength: number) {
  return value === undefined ? undefined : value.slice(0, maxLength);
}

function mapLoyaltyQrErrorResponse(response: Response, body: unknown): Error | undefined {
  if (response.status === 404) return new LoyaltyQrUnavailableError(body);
  if (response.status === 429) {
    return new LoyaltyQrRateLimitError(parseRetryAfterSec(response.headers?.get?.("retry-after") ?? null), body);
  }
  return undefined;
}

export function parseRetryAfterSec(value: string | null, now = Date.now()): number {
  const trimmed = value?.trim();
  let seconds = LOYALTY_QR_DEFAULT_RETRY_AFTER_SEC;
  if (trimmed && /^\d+$/.test(trimmed)) {
    seconds = Number(trimmed);
  } else if (trimmed) {
    const date = Date.parse(trimmed);
    if (!Number.isNaN(date)) seconds = Math.ceil((date - now) / 1000);
  }
  return Math.min(LOYALTY_QR_MAX_RETRY_AFTER_SEC, Math.max(1, seconds));
}

function parseLoyaltyQrResponse(body: unknown, status: number): LoyaltyQr {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new LoyaltyQrResponseError("body", status);
  }
  const { qr, expiresAt, refreshAfterSec } = body as Record<string, unknown>;
  if (typeof qr !== "string" || !LOYALTY_QR_TOKEN_PATTERN.test(qr)) {
    throw new LoyaltyQrResponseError("qr", status);
  }
  if (typeof refreshAfterSec !== "number" || !Number.isSafeInteger(refreshAfterSec) || refreshAfterSec <= 0) {
    throw new LoyaltyQrResponseError("refreshAfterSec", status);
  }
  const expiresAtDate = typeof expiresAt === "string" && expiresAt.trim() ? new Date(expiresAt) : undefined;
  if (!expiresAtDate || Number.isNaN(expiresAtDate.getTime())) {
    throw new LoyaltyQrResponseError("expiresAt", status);
  }
  return { qr, expiresAt: expiresAtDate, refreshAfterSec };
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

export interface LoyaltyQrSession {
  getState(): LoyaltyQrSessionState;
  /** The QR is on screen and the app is in the foreground: fetch now and keep it fresh. Restarts the idle clock. */
  start(): void;
  /** The QR left the screen or the app went to the background: stop timers and forget the token. */
  stop(): void;
  /** The guest asked for a new QR (e.g. tapped «refresh»): restarts the idle clock and fetches unless one is loading. */
  refresh(): void;
  /** The guest interacted with the screen: restarts the idle clock without a request. */
  touch(): void;
  /** stop() and no further onChange calls. */
  destroy(): void;
}

/**
 * Keeps one loyalty QR fresh while it is visible: asks again after `refreshAfterSec`, stops after
 * `idleTimeoutMs` without interaction (`expired`), stops for good on 404 (`unavailable`), waits Retry-After on 429
 * and `errorRetryDelayMs` after a transient failure. The token lives only in the returned state.
 */
export function createLoyaltyQrSession(
  client: Pick<DatraEngage, "getLoyaltyQr">,
  input: Omit<GetLoyaltyQrInput, "signal">,
  options: LoyaltyQrSessionOptions = {},
): LoyaltyQrSession {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const idleTimeoutMs = normalizePositiveNumber(options.idleTimeoutMs, DEFAULT_LOYALTY_QR_IDLE_TIMEOUT_MS);
  const errorRetryDelayMs = normalizePositiveNumber(
    options.errorRetryDelayMs,
    DEFAULT_LOYALTY_QR_ERROR_RETRY_DELAY_MS,
  );
  const requestInput: Omit<GetLoyaltyQrInput, "signal"> = { ...input };

  let state: LoyaltyQrSessionState = { isLoading: false, expired: false, unavailable: false };
  let active = false;
  let destroyed = false;
  let lastInteractionAt = now();
  let timer: unknown;
  let generation = 0;
  let controller: AbortController | undefined;

  const setState = (patch: Partial<LoyaltyQrSessionState>) => {
    state = { ...state, ...patch };
    if (!destroyed) options.onChange?.(state);
  };

  const clearScheduled = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  const schedule = (ms: number) => {
    clearScheduled();
    timer = setTimer(() => {
      timer = undefined;
      tick();
    }, ms);
  };

  const isIdle = () => now() - lastInteractionAt >= idleTimeoutMs;

  const tick = () => {
    if (!active || destroyed) return;
    if (isIdle()) {
      setState({ qr: undefined, isLoading: false, expired: true });
      return;
    }
    void fetchQr();
  };

  const fetchQr = async () => {
    if (!active || destroyed || state.isLoading) return;
    clearScheduled();
    const requestGeneration = ++generation;
    controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    // The previous token stays on screen until the new one arrives: Datra keeps it valid a few seconds after
    // replacing it, so the picture never goes blank mid-scan.
    setState({ isLoading: true, error: undefined });
    try {
      const qr = await client.getLoyaltyQr({ ...requestInput, signal: controller?.signal });
      if (requestGeneration !== generation || !active || destroyed) return;
      setState({ qr, isLoading: false, error: undefined, retryAfterSec: undefined, unavailable: false });
      schedule(qr.refreshAfterSec * 1000);
    } catch (error) {
      if (requestGeneration !== generation || !active || destroyed) return;
      if (error instanceof LoyaltyQrUnavailableError) {
        setState({ qr: undefined, isLoading: false, error, unavailable: true, retryAfterSec: undefined });
        return;
      }
      if (error instanceof LoyaltyQrRateLimitError) {
        setState({ qr: undefined, isLoading: false, error, retryAfterSec: error.retryAfterSec });
        schedule(error.retryAfterSec * 1000);
        return;
      }
      setState({ qr: undefined, isLoading: false, error, retryAfterSec: undefined });
      if (isTransientLoyaltyQrError(error)) schedule(errorRetryDelayMs);
    }
  };

  const halt = () => {
    clearScheduled();
    generation += 1;
    controller?.abort();
    controller = undefined;
  };

  return {
    getState: () => state,
    start() {
      if (destroyed) return;
      const wasActive = active;
      active = true;
      lastInteractionAt = now();
      if (wasActive) return;
      if (state.expired) setState({ expired: false });
      if (!state.unavailable) void fetchQr();
    },
    stop() {
      if (!active) return;
      active = false;
      halt();
      setState({ qr: undefined, isLoading: false, retryAfterSec: undefined });
    },
    refresh() {
      if (destroyed) return;
      lastInteractionAt = now();
      if (!active || state.isLoading) return;
      setState({ expired: false, unavailable: false });
      void fetchQr();
    },
    touch() {
      lastInteractionAt = now();
    },
    destroy() {
      active = false;
      halt();
      destroyed = true;
      state = { isLoading: false, expired: false, unavailable: false };
    },
  };
}

function isTransientLoyaltyQrError(error: unknown) {
  if (!(error instanceof DatraEngageError)) return true;
  if (getDatraEngageErrorCode(error) === "ABORTED") return false;
  return error.status === 0 || error.status === 408 || error.status >= 500;
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
