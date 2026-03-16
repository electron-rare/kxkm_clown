import { useEffect, useRef, useState, useCallback } from "react";

export interface UseWebSocketOptions {
  url: string;
  onMessage?: (data: unknown) => void;
  reconnectInterval?: number;
  enabled?: boolean;
}

export interface UseWebSocketReturn {
  connected: boolean;
  send: (data: unknown) => void;
  lastMessage: unknown | null;
  disconnect: () => void;
}

const MAX_RECONNECT_INTERVAL = 30_000;

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const { url, onMessage, reconnectInterval = 3000, enabled = true } = options;

  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<unknown | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(reconnectInterval);
  const onMessageRef = useRef(onMessage);
  const mountedRef = useRef(true);
  const manualDisconnect = useRef(false);

  // Keep onMessage ref current without triggering reconnects
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const clearReconnect = useCallback(() => {
    if (reconnectTimer.current !== null) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    clearReconnect();
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    if (mountedRef.current) {
      setConnected(false);
    }
  }, [clearReconnect]);

  const connect = useCallback(() => {
    if (!mountedRef.current || manualDisconnect.current) return;
    closeSocket();

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // Schedule reconnect on construction failure
      reconnectTimer.current = setTimeout(() => {
        backoffRef.current = Math.min(
          backoffRef.current * 2,
          MAX_RECONNECT_INTERVAL
        );
        connect();
      }, backoffRef.current);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      backoffRef.current = reconnectInterval;
      setConnected(true);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        parsed = event.data;
      }
      setLastMessage(parsed);
      onMessageRef.current?.(parsed);
    };

    ws.onerror = () => {
      // onclose will fire after onerror, reconnect handled there
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      wsRef.current = null;
      if (!manualDisconnect.current) {
        reconnectTimer.current = setTimeout(() => {
          backoffRef.current = Math.min(
            backoffRef.current * 2,
            MAX_RECONNECT_INTERVAL
          );
          connect();
        }, backoffRef.current);
      }
    };
  }, [url, reconnectInterval, closeSocket]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const disconnect = useCallback(() => {
    manualDisconnect.current = true;
    closeSocket();
  }, [closeSocket]);

  // Connect / disconnect based on enabled flag
  useEffect(() => {
    mountedRef.current = true;
    manualDisconnect.current = false;

    if (enabled) {
      backoffRef.current = reconnectInterval;
      connect();
    } else {
      closeSocket();
    }

    return () => {
      mountedRef.current = false;
      closeSocket();
    };
  }, [enabled, url, connect, closeSocket, reconnectInterval]);

  return { connected, send, lastMessage, disconnect };
}
