import { useState, useEffect, useRef, useCallback } from "react";
import { getPersonaColor } from "@kxkm/ui";
import { useWebSocket } from "./useWebSocket";
import type { UseWebSocketReturn } from "./useWebSocket";
import { useMinitelSounds } from "./useMinitelSounds";
import { resolveWebSocketUrl } from "../lib/websocket-url";
import type { ChatMsg, PersonaColor } from "../components/chat-types";

const MAX_MESSAGES = 500;
const MAX_HISTORY = 100;
let msgIdCounter = 0;

function buildWsUrl(): string {
  const base = resolveWebSocketUrl();
  const nick = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("kxkm-nick") : null;
  if (!nick) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}nick=${encodeURIComponent(nick)}`;
}

function findLastChunkIndex(messages: ChatMsg[], nick: string): number {
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx];
    if (message.type === "chunk" && message.nick === nick) {
      return idx;
    }
  }
  return -1;
}

export interface UseChatStateReturn {
  messages: ChatMsg[];
  users: string[];
  channel: string;
  input: string;
  setInput: (value: string) => void;
  personaColors: PersonaColor;
  sidebarCollapsed: { personas: boolean; users: boolean };
  toggleSidebar: (section: "personas" | "users") => void;
  typingPersona: string | null;
  ws: UseWebSocketReturn;
  sounds: ReturnType<typeof useMinitelSounds>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  getNickColor: (nick: string) => string | undefined;
  handleSend: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export function useChatState(): UseChatStateReturn {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [channel, setChannel] = useState("#general");
  const [input, setInput] = useState("");
  const [personaColors, setPersonaColors] = useState<PersonaColor>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState({ personas: true, users: true });
  const [typingPersona, setTypingPersona] = useState<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef("");
  const keyPressCountRef = useRef(0);
  const ullaTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [tabIndex, setTabIndex] = useState(-1);
  const [tabPrefix, setTabPrefix] = useState("");

  const sounds = useMinitelSounds();

  // Clean up /ulla timeouts on unmount
  useEffect(() => {
    return () => {
      ullaTimersRef.current.forEach((id) => clearTimeout(id));
      ullaTimersRef.current = [];
    };
  }, []);

  const handleMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

    const type = msg.type as ChatMsg["type"];

    switch (type) {
      case "persona":
        if (typeof msg.nick === "string") {
          const color = typeof msg.color === "string" && /^#[0-9a-fA-F]{3,8}$|^[a-z]{3,20}$/i.test(msg.color)
            ? msg.color
            : getPersonaColor(msg.nick);
          setPersonaColors((prev) => ({ ...prev, [msg.nick as string]: color }));
        }
        return;

      case "userlist":
        if (Array.isArray(msg.users)) {
          setUsers(msg.users as string[]);
        }
        return;

      case "channelInfo":
        if (typeof msg.channel === "string") {
          setChannel(msg.channel as string);
        }
        return;

      case "uploadCapability":
        return;

      case "image": {
        const chatMsg: ChatMsg = {
          id: ++msgIdCounter,
          type: "image",
          nick: typeof msg.nick === "string" ? msg.nick : undefined,
          text: typeof msg.text === "string" ? msg.text : undefined,
          imageData: typeof msg.imageData === "string" ? msg.imageData : undefined,
          imageMime: typeof msg.imageMime === "string" ? msg.imageMime : undefined,
          seq: typeof msg.seq === "number" ? msg.seq : undefined,
          timestamp: Date.now(),
        };
        setMessages((prev) => {
          const next = [...prev, chatMsg];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
        return;
      }

      case "music": {
        const chatMsg: ChatMsg = {
          id: ++msgIdCounter,
          type: "music",
          nick: typeof msg.nick === "string" ? msg.nick : undefined,
          text: typeof msg.text === "string" ? msg.text : undefined,
          audioData: typeof msg.audioData === "string" ? msg.audioData : undefined,
          audioMime: typeof msg.audioMime === "string" ? msg.audioMime : undefined,
          seq: typeof msg.seq === "number" ? msg.seq : undefined,
          timestamp: Date.now(),
        };
        setMessages((prev) => {
          const next = [...prev, chatMsg];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
        return;
      }

      case "audio": {
        if (typeof msg.data === "string" && typeof msg.mimeType === "string") {
          const chatMsg: ChatMsg = {
            id: ++msgIdCounter,
            type: "audio",
            nick: typeof msg.nick === "string" ? msg.nick : undefined,
            text: "\u266A message vocal",
            audioData: msg.data as string,
            audioMime: msg.mimeType as string,
            seq: typeof msg.seq === "number" ? msg.seq : undefined,
            timestamp: Date.now(),
          };
          setMessages((prev) => {
            const next = [...prev, chatMsg];
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
          });
        }
        return;
      }

      case "chunk": {
        // Streaming chunk from persona — append to existing or create new message
        const chunkNick = typeof msg.nick === "string" ? msg.nick : "???";
        const chunkText = typeof msg.text === "string" ? msg.text : "";
        const chunkColor = typeof msg.color === "string" ? msg.color : undefined;
        const chunkSeq = typeof msg.seq === "number" ? msg.seq : undefined;
        setMessages((prev) => {
          // Find the last message from this nick that is a chunk (still streaming)
          const lastIdx = prev.length - 1;
          const last = lastIdx >= 0 ? prev[lastIdx] : null;
          if (last && last.type === "chunk" && last.nick === chunkNick) {
            // Append to existing chunk message
            const updated = [...prev];
            updated[lastIdx] = { ...last, text: (last.text || "") + chunkText, seq: chunkSeq ?? last.seq };
            return updated;
          }
          // New streaming message
          const next = [...prev, {
            id: ++msgIdCounter,
            type: "chunk" as ChatMsg["type"],
            nick: chunkNick,
            text: chunkText,
            color: chunkColor,
            seq: chunkSeq,
            timestamp: Date.now(),
          }];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
        return;
      }

      default: {
        // Intercept typing indicators
        // Server-side /clear: reset messages
        if (type === "system" && msg.text === "__clear__") {
          setMessages([]);
          return;
        }

        // Theme switcher: detect __theme__ prefix
        if (type === "system" && typeof msg.text === "string" && msg.text.startsWith("__theme__")) {
          const theme = msg.text.slice(9);
          document.documentElement.setAttribute("data-theme", theme);
          return;
        }

        if (type === "system" && typeof msg.text === "string") {
          const typingMatch = msg.text.match(/^(.+) est en train d'ecrire/);
          if (typingMatch) {
            setTypingPersona(typingMatch[1]);
            if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
            typingTimerRef.current = setTimeout(() => setTypingPersona(null), 8000);
            return;
          }
        }

        const incomingSeq = typeof msg.seq === "number" ? msg.seq : undefined;
        const chatMsg: ChatMsg = {
          id: ++msgIdCounter,
          type,
          nick: typeof msg.nick === "string" ? msg.nick : undefined,
          text: typeof msg.text === "string" ? msg.text : undefined,
          color: typeof msg.color === "string" ? msg.color : undefined,
          channel: typeof msg.channel === "string" ? msg.channel : undefined,
          seq: incomingSeq,
          timestamp: Date.now(),
        };
        setMessages((prev) => {
          // If this is a final message from a persona, replace the last chunk from same nick
          if (type === "message" && chatMsg.nick) {
            const lastChunkIdx = findLastChunkIndex(prev, chatMsg.nick);
            if (lastChunkIdx >= 0) {
              const updated = [...prev];
              updated[lastChunkIdx] = { ...chatMsg, id: prev[lastChunkIdx].id };
              return updated;
            }
          }
          const next = [...prev, chatMsg];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });

        if (type === "message" && chatMsg.nick) {
          setTypingPersona(null);
        }

        if (type === "message" && chatMsg.nick && personaColors[chatMsg.nick]) {
          sounds.receive();
        }

        // Check if current user is mentioned
        if (type === "message" && chatMsg.text) {
          const currentNick = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("kxkm-nick") : null;
          if (currentNick && chatMsg.text.toLowerCase().includes(`@${currentNick.toLowerCase()}`)) {
            sounds.receive(); // play notification sound on @mention
          }
        }

        if (type === "join" && chatMsg.nick) {
          setUsers((prev) =>
            prev.includes(chatMsg.nick!) ? prev : [...prev, chatMsg.nick!]
          );
        } else if (type === "part" && chatMsg.nick) {
          setUsers((prev) => prev.filter((u) => u !== chatMsg.nick));
        }
      }
    }
  }, [sounds, personaColors]);

  const [wsUrl] = useState(buildWsUrl);

  const ws = useWebSocket({
    url: wsUrl,
    onMessage: handleMessage,
    enabled: true,
  });

  // Track whether user has scrolled up
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    function onScroll() {
      if (!container) return;
      const atBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 40;
      autoScrollRef.current = atBottom;
    }

    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (autoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Ref to always have current handleSend in the global keydown handler
  const handleSendRef = useRef<() => void>(() => {});

  // Global F-key handler
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "F1":
          e.preventDefault();
          window.location.hash = "#/";
          break;
        case "F2":
          e.preventDefault();
          messagesContainerRef.current?.scrollBy({ top: 300, behavior: "smooth" });
          break;
        case "F3":
          e.preventDefault();
          history.back();
          break;
        case "F4":
          e.preventDefault();
          setInput("");
          break;
        case "F5":
          e.preventDefault();
          handleSendRef.current();
          break;
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Refs for stable useCallback closures
  const inputRef = useRef(input);
  inputRef.current = input;
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;
  const usersRef = useRef(users);
  usersRef.current = users;
  const personaColorsRef = useRef(personaColors);
  personaColorsRef.current = personaColors;
  const tabIndexRef = useRef(tabIndex);
  tabIndexRef.current = tabIndex;
  const tabPrefixRef = useRef(tabPrefix);
  tabPrefixRef.current = tabPrefix;

  const handleSend = useCallback(() => {
    const trimmed = inputRef.current.trim();
    if (!trimmed || !wsRef.current.connected) return;

    // Push to history
    historyRef.current.unshift(trimmed);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.pop();
    historyIndexRef.current = -1;
    savedInputRef.current = "";

    // /ulla easter egg
    if (trimmed.toLowerCase() === "/ulla") {
      const ullaMessages = [
        "\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557",
        "\u2551     3615 ULLA \u2014 MESSAGERIE       \u2551",
        "\u2551                                   \u2551",
        "\u2551  Salut beau gosse... \uD83D\uDE18           \u2551",
        "\u2551  Tu cherches quoi ce soir ?       \u2551",
        "\u2551  Tape 1 pour RENCONTRE            \u2551",
        "\u2551  Tape 2 pour DIALOGUE             \u2551",
        "\u2551  Tape 3 pour MYSTERE              \u2551",
        "\u2551                                   \u2551",
        "\u2551  0,34\u20AC/min \u2014 ah non, c'est       \u2551",
        "\u2551  gratuit ici, c'est du LOCAL \uD83C\uDFF4\u200D\u2620\uFE0F  \u2551",
        "\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D",
      ];
      ullaTimersRef.current.forEach((id) => clearTimeout(id));
      ullaTimersRef.current = [];
      ullaMessages.forEach((line, i) => {
        const timerId = setTimeout(() => {
          setMessages(prev => [...prev, {
            id: ++msgIdCounter,
            type: "system",
            text: line,
            timestamp: Date.now(),
          }]);
        }, i * 200);
        ullaTimersRef.current.push(timerId);
      });
      setInput("");
      return;
    }

    soundsRef.current.send();

    if (trimmed.startsWith("/")) {
      wsRef.current.send({ type: "command", text: trimmed });
    } else {
      wsRef.current.send({ type: "message", text: trimmed });
    }
    setInput("");
  }, []); // stable — reads from refs

  // Keep handleSendRef in sync
  useEffect(() => { handleSendRef.current = handleSend; });

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Debounced Minitel keyPress sound (every 3rd key)
    if (e.key.length === 1) {
      keyPressCountRef.current++;
      if (keyPressCountRef.current % 3 === 0) {
        soundsRef.current.keyPress();
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    // Tab completion for nicks and slash commands
    if (e.key === "Tab") {
      e.preventDefault();
      const text = inputRef.current;

      // Slash command completion
      if (text.startsWith("/") && !text.includes(" ")) {
        const slashCommands = ["/help", "/clear", "/nick", "/join", "/channels", "/msg", "/web", "/imagine", "/compose", "/comp", "/layer", "/mix", "/status", "/model", "/persona", "/context", "/responders", "/who", "/personas", "/export", "/memory", "/models", "/reload", "/topic", "/dm", "/pin", "/stats", "/ban", "/unban", "/mute", "/unmute", "/dice", "/roll", "/flip", "/changelog", "/version", "/whisper", "/w", "/history", "/search", "/react", "/invite", "/time", "/date", "/session", "/theme", "/fortune", "/speed", "/voice", "/fx", "/noise"];
        const prefix = tabPrefixRef.current || text;
        const matches = slashCommands.filter((c) => c.startsWith(prefix.toLowerCase()));
        if (matches.length === 0) return;
        const nextIdx = (tabIndexRef.current + 1) % matches.length;
        setInput(matches[nextIdx] + " ");
        setTabIndex(nextIdx);
        if (!tabPrefixRef.current) setTabPrefix(prefix);
        return;
      }

      // Nick completion
      const words = text.split(" ");
      const lastWord = words[words.length - 1];

      // @mention completion (persona names)
      if (lastWord.startsWith("@")) {
        const prefix = tabPrefixRef.current || lastWord.slice(1); // remove @
        const allPersonas = Object.keys(personaColorsRef.current);
        const matches = allPersonas.filter(p => p.toLowerCase().startsWith(prefix.toLowerCase()));
        if (matches.length === 0) return;
        const nextIdx = (tabIndexRef.current + 1) % matches.length;
        words[words.length - 1] = "@" + matches[nextIdx] + " ";
        setInput(words.join(" "));
        setTabIndex(nextIdx);
        if (!tabPrefixRef.current) setTabPrefix(prefix);
        return;
      }

      const prefix = tabPrefixRef.current || lastWord;
      const matches = usersRef.current.filter((u) =>
        u.toLowerCase().startsWith(prefix.toLowerCase()),
      );
      if (matches.length === 0) return;
      const nextIdx = (tabIndexRef.current + 1) % matches.length;
      words[words.length - 1] = matches[nextIdx] + (words.length === 1 ? ": " : " ");
      setInput(words.join(" "));
      setTabIndex(nextIdx);
      if (!tabPrefixRef.current) setTabPrefix(prefix);
      return;
    }

    // ArrowUp — navigate back through message history
    if (e.key === "ArrowUp") {
      const history = historyRef.current;
      if (history.length === 0) return;
      e.preventDefault();
      if (historyIndexRef.current < history.length - 1) {
        if (historyIndexRef.current === -1) savedInputRef.current = inputRef.current;
        historyIndexRef.current++;
        setInput(history[historyIndexRef.current]);
      }
      return;
    }

    // ArrowDown — navigate forward through message history
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
        setInput(historyRef.current[historyIndexRef.current]);
      } else if (historyIndexRef.current === 0) {
        historyIndexRef.current = -1;
        setInput(savedInputRef.current);
      }
      return;
    }

    // Reset tab state on any other key
    if (tabIndexRef.current >= 0) {
      setTabIndex(-1);
      setTabPrefix("");
    }
  }, [handleSend]); // stable — reads from refs

  const getNickColor = useCallback((nick: string): string | undefined => {
    return personaColors[nick];
  }, [personaColors]);

  const toggleSidebar = useCallback((section: "personas" | "users") => {
    setSidebarCollapsed(p => ({ ...p, [section]: !p[section] }));
  }, []);

  return {
    messages,
    users,
    channel,
    input,
    setInput,
    personaColors,
    sidebarCollapsed,
    toggleSidebar,
    typingPersona,
    ws,
    sounds,
    messagesEndRef,
    messagesContainerRef,
    getNickColor,
    handleSend,
    handleKeyDown,
  };
}
