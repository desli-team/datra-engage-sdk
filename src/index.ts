export * from "./types.js";

import type {
  DatraEngageConfig,
  DatraEngageIdentity,
  EngageEventType,
  EngageFetch,
  ResolveEngageMessagesResponse,
  ResolveMessagesInput,
  ScreenViewedInput,
  TrackEngageEventResponse,
  TrackEventInput,
  TrackEventOptions,
} from "./types.js";

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

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(this.buildUrl(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-datra-public-key": this.publicKey,
      },
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
