import { useCallback, useEffect, useState } from "react";
import { api, type SessionData } from "../api";

const NICK_KEY = "kxkm-nick";
const EMAIL_KEY = "kxkm-email";

function readStorage(key: string): string | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in private mode / tests.
  }
}

function removeStorage(key: string): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
  } catch {
    // Ignore storage failures in private mode / tests.
  }
}

export function useAppSession() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [nick, setNickState] = useState<string | null>(() => readStorage(NICK_KEY));
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let alive = true;

    api.getSession()
      .then((current) => {
        if (alive) setSession(current);
      })
      .catch(() => {
        if (alive) setSession(null);
      })
      .finally(() => {
        if (alive) setCheckingSession(false);
      });

    return () => {
      alive = false;
    };
  }, [nick]);

  const setNick = useCallback((username: string, email?: string) => {
    setNickState(username);
    writeStorage(NICK_KEY, username);
    if (email) writeStorage(EMAIL_KEY, email);
    else removeStorage(EMAIL_KEY);
  }, []);

  const clearSessionState = useCallback(() => {
    setSession(null);
    setNickState(null);
    removeStorage(NICK_KEY);
    removeStorage(EMAIL_KEY);
  }, []);

  return {
    session,
    setSession,
    nick,
    setNick,
    clearSessionState,
    checkingSession,
  };
}
