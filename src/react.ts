import * as React from "react";

import { DatraEngage, createDatraEngage, createDatraEngageActionHandler } from "./index.js";
import type {
  DatraEngageActionHandlers,
  DatraEngageConfig,
  EngageResolvedMessage,
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

export function useDatraEngageActionHandler(handlers: DatraEngageActionHandlers) {
  return React.useMemo(() => createDatraEngageActionHandler(handlers), [handlers]);
}

export { createDatraEngageActionHandler };

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
