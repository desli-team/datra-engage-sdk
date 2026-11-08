import * as React from "react";

import {
  DatraEngage,
  createDatraEngage,
  createDatraEngageActionHandler,
  createLoyaltyQrSession,
  type LoyaltyQrSession,
} from "./index.js";
import type {
  DatraEngageActionHandlers,
  DatraEngageConfig,
  EngageResolvedMessage,
  GetLoyaltyQrInput,
  LoyaltyQrSessionState,
  ResolveEngageMessagesResponse,
  ScreenViewedInput,
  TrackBatchEventOptions,
} from "./types.js";

export interface DatraEngageProviderProps {
  client?: DatraEngage;
  config?: DatraEngageConfig;
  children?: React.ReactNode;
}

export interface UseEngageMessagesOptions extends ScreenViewedInput {
  enabled?: boolean;
  trackShown?: boolean | TrackBatchEventOptions;
}

export interface UseEngageMessagesResult {
  messages: EngageResolvedMessage[];
  response?: ResolveEngageMessagesResponse;
  isLoading: boolean;
  error?: unknown;
  refresh: () => Promise<ResolveEngageMessagesResponse | undefined>;
}

const DatraEngageContext = React.createContext<DatraEngage | null>(null);

export function DatraEngageProvider({
  client,
  config,
  children,
}: DatraEngageProviderProps) {
  const clientRef = React.useRef<DatraEngage | null>(null);

  if (!clientRef.current) {
    if (client) {
      clientRef.current = client;
    } else if (config) {
      clientRef.current = createDatraEngage(config);
    } else {
      throw new Error("DatraEngageProvider requires either client or config.");
    }
  }

  return React.createElement(
    DatraEngageContext.Provider,
    { value: clientRef.current },
    children,
  );
}

export function useDatraEngage() {
  const client = React.useContext(DatraEngageContext);
  if (!client) {
    throw new Error("useDatraEngage must be used inside DatraEngageProvider.");
  }

  return client;
}

export function useEngageMessages(
  screen: string,
  options: UseEngageMessagesOptions = {},
): UseEngageMessagesResult {
  const client = useDatraEngage();
  const {
    enabled = true,
    trackShown = false,
    placement,
    customerExternalId,
    platform,
    appVersion,
    locale,
    context,
    limit,
  } = options;
  const contextKey = stableStringify(context);
  const trackShownKey = stableStringify(trackShown);
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const [state, setState] = React.useState<{
    messages: EngageResolvedMessage[];
    response?: ResolveEngageMessagesResponse;
    isLoading: boolean;
    error?: unknown;
  }>({
    messages: [],
    isLoading: false,
  });

  const refresh = React.useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!enabled) {
      if (mountedRef.current) {
        setState((current) => ({
          ...current,
          isLoading: false,
        }));
      }
      return undefined;
    }

    if (mountedRef.current) {
      setState((current) => ({
        ...current,
        isLoading: true,
        error: undefined,
      }));
    }

    try {
      const response = await client.screenViewedSafe(screen, {
        placement,
        customerExternalId,
        platform,
        appVersion,
        locale,
        context,
        limit,
      });

      if (trackShown) {
        const trackOptions = typeof trackShown === "object"
          ? trackShown
          : {
              idempotencyKeyPrefix: placement ?? screen,
            };
        void client.trackShown(response.messages, trackOptions).catch(() => undefined);
      }

      if (mountedRef.current && requestId === requestIdRef.current) {
        setState({
          messages: response.messages,
          response,
          isLoading: false,
        });
      }
      return response;
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setState({
          messages: [],
          isLoading: false,
          error,
        });
      }
      return undefined;
    }
  }, [
    appVersion,
    client,
    contextKey,
    customerExternalId,
    enabled,
    limit,
    locale,
    placement,
    platform,
    screen,
    trackShownKey,
  ]);

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh();

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return {
    ...state,
    refresh,
  };
}

export interface UseLoyaltyQrOptions {
  /** Defaults to the DatraEngageProvider client. */
  client?: DatraEngage | null;
  /**
   * Whether the QR is actually visible: screen focused and app in the foreground. While false nothing is requested
   * and the token is dropped. Defaults to true.
   */
  active?: boolean;
  /** Stop auto-refresh after this long without refresh()/touch(). Defaults to 3 minutes. */
  idleTimeoutMs?: number;
  /** Delay before retrying a transient failure. Defaults to 15 s. */
  errorRetryDelayMs?: number;
}

export interface UseLoyaltyQrResult extends LoyaltyQrSessionState {
  /** Ask for a new QR now (the «tap to refresh» action). Restarts the idle clock. */
  refresh: () => void;
  /** Record an interaction so auto-refresh keeps going, without a request. */
  touch: () => void;
}

const INITIAL_LOYALTY_QR_STATE: LoyaltyQrSessionState = {
  isLoading: false,
  expired: false,
  unavailable: false,
};

/**
 * Shows a fresh one-time loyalty QR while `active`. Pass `null` as input to stay idle (e.g. signed out).
 * The token is kept only in component state; never log it or send it to analytics.
 */
export function useLoyaltyQr(
  input: Omit<GetLoyaltyQrInput, "signal"> | null | undefined,
  options: UseLoyaltyQrOptions = {},
): UseLoyaltyQrResult {
  const contextClient = React.useContext(DatraEngageContext);
  const client = options.client === undefined ? contextClient : options.client;
  const { active = true, idleTimeoutMs, errorRetryDelayMs } = options;
  const inputKey = input ? stableStringify(input) : "";
  const inputRef = React.useRef(input);
  inputRef.current = input;
  const sessionRef = React.useRef<LoyaltyQrSession | null>(null);
  const [state, setState] = React.useState<LoyaltyQrSessionState>(INITIAL_LOYALTY_QR_STATE);

  React.useEffect(() => {
    const sessionInput = inputRef.current;
    if (!client || !sessionInput) {
      setState(INITIAL_LOYALTY_QR_STATE);
      return undefined;
    }

    const session = createLoyaltyQrSession(client, sessionInput, {
      idleTimeoutMs,
      errorRetryDelayMs,
      onChange: setState,
    });
    sessionRef.current = session;
    setState(session.getState());

    return () => {
      session.destroy();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [client, errorRetryDelayMs, idleTimeoutMs, inputKey]);

  React.useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (active) session.start();
    else session.stop();
  }, [active, client, errorRetryDelayMs, idleTimeoutMs, inputKey]);

  const refresh = React.useCallback(() => sessionRef.current?.refresh(), []);
  const touch = React.useCallback(() => sessionRef.current?.touch(), []);

  return { ...state, refresh, touch };
}

export function useDatraEngageActionHandler(handlers: DatraEngageActionHandlers) {
  return React.useMemo(() => createDatraEngageActionHandler(handlers), [handlers]);
}

export { createDatraEngageActionHandler, createLoyaltyQrSession };

function stableStringify(value: unknown) {
  if (value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
