export type EngageMessageType =
  | "BANNER"
  | "POPUP"
  | "BOTTOM_SHEET"
  | "COUPON_CARD"
  | "INLINE_BLOCK"
  | "CAROUSEL"
  | "STORY";

export type EngageEventType = "SHOWN" | "CLICKED" | "DISMISSED" | "CONVERTED";

export interface EngageCta {
  text?: string;
  [key: string]: unknown;
}

export interface EngageAction {
  type?: string;
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
}
