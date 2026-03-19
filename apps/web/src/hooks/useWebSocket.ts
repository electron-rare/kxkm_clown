import { useEffect, useRef, useState, useCallback } from "react";

export interface UseWebSocketOptions {
  url: string;
  onMessage?: (data: unknown) => void;
  reconnectInterval?: number;
  enabled?: boolean;
}

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface UseWebSocketReturn {
  connected: boolean;
  connectionStatus: ConnectionStatus;
  reconnectAttempts: number;
  send: (data: unknown) => void;
  lastMessage: unknown | null;
  disconnect: () => void;
}

const INITIAL_DELAY = 1000;
const MAX_DELAY = 30_000;
const MAX_ATTEMPTS = 20;

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const { url, onMessage, reconnectInterval = INITIAL_DELAY, enabled = true } = options;

  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastMessage, setLastMessage] = useState<unknown | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(reconnectInterval);
  const attemptsRef = useRef(0);
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

  // Use a ref-based connect to break the circular dependency with scheduleReconnect
  const connectFnRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current || manualDisconnect.current) return;
    if (attemptsRef.current >= MAX_ATTEMPTS) {
      if (mountedRef.current) {
        setConnectionStatus("disconnected");
      }
      return;
    }
    if (mountedRef.current) {
      setConnectionStatus("reconnecting");
      setReconnectAttempts(attemptsRef.current);
    }
    reconnectTimer.current = setTimeout(() => {
      attemptsRef.current++;
      if (mountedRef.current) {
        setReconnectAttempts(attemptsRef.current);
      }
      connectFnRef.current();
    }, backoffRef.current);
    backoffRef.current = Math.min(backoffRef.current * 2, MAX_DELAY);
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current || manualDisconnect.current) return;
    closeSocket();

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      // Reset backoff on successful connection
      backoffRef.current = reconnectInterval;
      attemptsRef.current = 0;
      setConnected(true);
      setConnectionStatus("connected");
      setReconnectAttempts(0);
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
        scheduleReconnect();
      } else {
        setConnectionStatus("disconnected");
      }
    };
  }, [url, reconnectInterval, closeSocket, scheduleReconnect]);

  // Keep connectFnRef in sync
  useEffect(() => {
    connectFnRef.current = connect;
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const disconnect = useCallback(() => {
    manualDisconnect.current = true;
    closeSocket();
    setConnectionStatus("disconnected");
    setReconnectAttempts(0);
  }, [closeSocket]);

  // Connect / disconnect based on enabled flag
  useEffect(() => {
    mountedRef.current = true;
    manualDisconnect.current = false;

    if (enabled) {
      backoffRef.current = reconnectInterval;
      attemptsRef.current = 0;
      setReconnectAttempts(0);
      connect();
    } else {
      closeSocket();
      setConnectionStatus("disconnected");
    }

    return () => {
      mountedRef.current = false;
      closeSocket();
    };
  }, [enabled, url, connect, closeSocket, reconnectInterval]);

  return { connected, connectionStatus, reconnectAttempts, send, lastMessage, disconnect };
}
