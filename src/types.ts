export type EngageMessageType =
  | "BANNER"
  | "POPUP"
  | "BOTTOM_SHEET"
  | "COUPON_CARD"
  | "INLINE_BLOCK"
  | "CAROUSEL"
  | "STORY";

export type EngageEventType = "SHOWN" | "CLICKED" | "DISMISSED" | "CONVERTED";

export type EngageActionType =
  | "NONE"
  | "OPEN_SCREEN"
  | "OPEN_PROMOTION"
  | "OPEN_COUPON"
  | "OPEN_PRODUCT"
  | "OPEN_CART"
  | "OPEN_URL"
  | "OPEN_STORY"
  | "OPEN_MECHANIC";

export interface EngageCta {
  text?: string;
  label?: string;
  [key: string]: unknown;
}

export interface EngageAction {
  type?: EngageActionType | string;
  screen?: string;
  promotionId?: string;
  couponId?: string;
  productId?: string;
  cartId?: string;
  url?: string;
  storyId?: string;
  mechanicId?: string;
  [key: string]: unknown;
}

export interface EngageResolvedMessage {
  decisionId: string;
  campaignId: string;
  placementId: string;
  placement: string;
  screen?: string | null;
  type: EngageMessageType;
  priority: number;
  title: string;
  body?: string | null;
  imageUrl?: string | null;
  cta?: EngageCta | null;
  action?: EngageAction | null;
  offer?: Record<string, unknown>;
  tracking?: Record<string, unknown>;
}

export interface DatraEngageActionHandlers {
  onOpenScreen?: (
    screen: string,
    action: EngageAction,
    message?: EngageResolvedMessage,
  ) => void | Promise<void>;
  onOpenPromotion?: (
    promotionId: string,
    action: EngageAction,
    message?: EngageResolvedMessage,
  ) => void | Promise<void>;
  onOpenCoupon?: (
    couponId: string,
    action: EngageAction,
    message?: EngageResolvedMessage,
  ) => void | Promise<void>;
  onOpenProduct?: (
    productId: string,
    action: EngageAction,
    message?: EngageResolvedMessage,
  ) => void | Promise<void>;
  onOpenCart?: (action: EngageAction, message?: EngageResolvedMessage) => void | Promise<void>;
  onOpenUrl?: (
    url: string,
    action: EngageAction,
    message?: EngageResolvedMessage,
  ) => void | Promise<void>;
  onOpenStory?: (
    storyId: string,
    action: EngageAction,
    message?: EngageResolvedMessage,
  ) => void | Promise<void>;
  onOpenMechanic?: (
    mechanicId: string,
    action: EngageAction,
    message?: EngageResolvedMessage,
  ) => void | Promise<void>;
  onUnhandledAction?: (action: EngageAction, message?: EngageResolvedMessage) => void | Promise<void>;
}

export type DatraEngageActionHandler = (
  action?: EngageAction | null,
  message?: EngageResolvedMessage,
) => Promise<void>;

export interface ResolveEngageMessagesResponse {
  messages: EngageResolvedMessage[];
}

export interface TrackEngageEventResponse {
  id: string;
  decisionId: string;
  eventType: EngageEventType;
  accepted: boolean;
  queued?: boolean;
}

export type EngageFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface DatraEngageRetryConfig {
  retries?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  retryStatuses?: number[];
}

export interface DatraEngageErrorContext {
  path: string;
  attempt: number;
  retryable: boolean;
}

export interface DatraEngageStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface DatraEngageEventQueueConfig {
  enabled?: boolean;
  storage?: DatraEngageStorage;
  storageKey?: string;
  maxEvents?: number;
  flushConcurrency?: number;
}

export interface DatraEngageDedupeConfig {
  enabled?: boolean;
  storage?: DatraEngageStorage;
  storageKey?: string;
  ttlMs?: number;
  maxKeys?: number;
}

export interface DatraEngageConfig {
  baseUrl: string;
  publicKey: string;
  apiPrefix?: string;
  customerExternalId?: string;
  platform?: string;
  appVersion?: string;
  locale?: string;
  defaultContext?: Record<string, unknown>;
  fetchImpl?: EngageFetch;
  timeoutMs?: number;
  retry?: DatraEngageRetryConfig | number;
  resolveTimeoutMs?: number;
  eventTimeoutMs?: number;
  resolveRetries?: number;
  eventRetries?: number;
  /** Timeout for `getLoyaltyQr`. Defaults to 5000 ms. Loyalty QR requests are never retried. */
  loyaltyQrTimeoutMs?: number;
  eventQueue?: boolean | DatraEngageEventQueueConfig;
  dedupe?: boolean | DatraEngageDedupeConfig;
  onError?: (error: unknown, context: DatraEngageErrorContext) => void;
}

export interface DatraEngageIdentity {
  customerExternalId?: string;
  platform?: string;
  appVersion?: string;
  locale?: string;
  context?: Record<string, unknown>;
}

export interface ResolveMessagesInput {
  placement: string;
  screen?: string;
  customerExternalId?: string;
  platform?: string;
  appVersion?: string;
  locale?: string;
  context?: Record<string, unknown>;
  limit?: number;
  signal?: AbortSignal;
}

export interface ScreenViewedInput {
  placement?: string;
  customerExternalId?: string;
  platform?: string;
  appVersion?: string;
  locale?: string;
  context?: Record<string, unknown>;
  limit?: number;
  signal?: AbortSignal;
}

export interface TrackEventInput {
  decisionId: string;
  eventType: EngageEventType;
  customerExternalId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface TrackEventOptions {
  customerExternalId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface TrackBatchEventOptions {
  customerExternalId?: string;
  idempotencyKeyPrefix?: string;
  metadata?: Record<string, unknown>;
}

export interface SafeTrackEventResult {
  accepted: boolean;
  response?: TrackEngageEventResponse;
  error?: unknown;
  queued?: boolean;
  deduped?: boolean;
}

export interface QueuedEngageEvent {
  id: string;
  input: TrackEventInput;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface FlushEngageEventQueueResult {
  attempted: number;
  sent: number;
  failed: number;
  remaining: number;
}

export interface DatraEngagePlacementDiagnostics {
  resolveCalls: number;
  networkRequests: number;
  successfulRequests: number;
  emptyResponses: number;
  timeouts: number;
  errors: number;
  cancellations: number;
  singleFlightHits: number;
  averageDurationMs: number;
  lastDurationMs: number;
  maxDurationMs: number;
}

export interface DatraEngageDiagnostics {
  resolveRequests: number;
  eventRequests: number;
  retries: number;
  timeouts: number;
  singleFlightHits: number;
  staleResolveCancellations: number;
  queuedEvents: number;
  placements: Record<string, DatraEngagePlacementDiagnostics>;
}

export type LoyaltyQrIntent = "EARN" | "SPEND";

export type LoyaltyQrPlatform = "ios" | "android" | "web";

export interface GetLoyaltyQrInput {
  /** The same external ID the brand sends to Datra for this customer (1..255 characters). */
  customerExternalId: string;
  /** Defaults to `EARN`. */
  intent?: LoyaltyQrIntent;
  /** Positive integer, only together with `intent: "SPEND"`. */
  maxSpendPoints?: number;
  /** Risk signal only. Longer values are cut to 128 characters. */
  deviceId?: string;
  /** Defaults to the client's `appVersion`. Longer values are cut to 32 characters. */
  appVersion?: string;
  /** Defaults to the client's `platform` when it is one of `ios`, `android`, `web`. */
  platform?: LoyaltyQrPlatform;
  signal?: AbortSignal;
}

/**
 * A one-time loyalty QR token. `qr` is a bearer secret: render it, never log, persist,
 * cache or send it to analytics or crash reporting.
 */
export interface LoyaltyQr {
  qr: string;
  expiresAt: Date;
  refreshAfterSec: number;
}

export interface LoyaltyQrSessionState {
  /** The token to render, or undefined while loading, idle-expired, unavailable or failed. */
  qr?: LoyaltyQr;
  isLoading: boolean;
  /** True after `idleTimeoutMs` without `refresh()` / `touch()`: auto-refresh stopped, ask the guest to tap. */
  expired: boolean;
  /** True after a 404: the feature is off for this tenant or key. Auto-refresh stops. */
  unavailable: boolean;
  error?: unknown;
  /** Seconds until the next request is allowed after a 429, otherwise undefined. */
  retryAfterSec?: number;
}

export interface LoyaltyQrSessionOptions {
  /** Stop auto-refresh after this long without interaction. Defaults to 180000 ms (3 minutes). */
  idleTimeoutMs?: number;
  /** Delay before retrying a transient failure (timeout, network, 5xx). Defaults to 15000 ms. */
  errorRetryDelayMs?: number;
  /** Called on every state change. */
  onChange?: (state: LoyaltyQrSessionState) => void;
  /** Test seams. */
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}
