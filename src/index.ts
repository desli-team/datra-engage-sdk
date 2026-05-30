export * from "./types.js";

import type {
  DatraEngageConfig,
  DatraEngageIdentity,
  DatraEngageRetryConfig,
  EngageEventType,
  EngageFetch,
  EngageResolvedMessage,
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
  private readonly onError?: DatraEngageConfig["onError"];
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
    const decisionId = input.decisionId.trim();
    if (!decisionId) {
      throw new Error("decisionId is required");
    }

    return this.request<TrackEngageEventResponse>("/engage/events", {
      decisionId,
      eventType: input.eventType,
      customerExternalId: normalizeOptionalString(input.customerExternalId) ?? this.customerExternalId,
      idempotencyKey: normalizeOptionalString(input.idempotencyKey),
      metadata: input.metadata,
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
    try {
      const response = await this.trackEvent(input);
      return {
        accepted: response.accepted,
        response,
      };
    } catch (error) {
      return {
        accepted: false,
        error,
      };
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
