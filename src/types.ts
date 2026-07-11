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
}

export interface ScreenViewedInput {
  placement?: string;
  customerExternalId?: string;
  platform?: string;
  appVersion?: string;
  locale?: string;
  context?: Record<string, unknown>;
  limit?: number;
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
