import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createCommandHandler } from "./ws-commands.js";
import type { ClientInfo, ChatPersona, OutboundMessage } from "./chat-types.js";
import type { WebSocket } from "ws";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeInfo(overrides?: Partial<ClientInfo>): ClientInfo {
  return {
    nick: "TestUser",
    channel: "#general",
    connectedAt: Date.now(),
    messageTimestamps: [],
    uploadBytesWindow: 0,
    lastUploadReset: Date.now(),
    isGuest: false,
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<Record<string, unknown>>) {
  return {
    send: mock.fn<(ws: WebSocket, msg: OutboundMessage) => void>(),
    broadcast: mock.fn<(channel: string, msg: OutboundMessage, exclude?: WebSocket) => void>(),
    broadcastUserlist: mock.fn<(channel: string) => void>(),
    channelUsers: mock.fn<(channel: string) => string[]>(() => ["TestUser", "Alice"]),
    listConnectedNicks: mock.fn<() => string[]>(() => ["TestUser", "Alice"]),
    listChannelCounts: mock.fn<() => Map<string, number>>(() => new Map([["#general", 2], ["#random", 1]])),
    routeToPersonas: mock.fn<(channel: string, text: string) => Promise<void>>(async () => {}),
    logChatMessage: mock.fn(),
    getPersonas: mock.fn<() => ChatPersona[]>(() => [
      { id: "p1", nick: "Merzbow", model: "llama3", systemPrompt: "Tu es un artiste noise japonais provocateur et expérimental...", color: "#ff0000" },
      { id: "p2", nick: "Oracle", model: "mistral", systemPrompt: "Tu es un oracle mystique qui parle en énigmes et prophéties...", color: "#9900ff" },
    ]),
    getMaxResponders: mock.fn<() => number>(() => 2),
    setMaxResponders: mock.fn<(n: number) => void>(),
    getActiveUserCount: mock.fn<() => number>(() => 3),
    ...overrides,
  };
}

const fakeWs = {} as WebSocket;

/* ------------------------------------------------------------------ */
/*  /help                                                              */
/* ------------------------------------------------------------------ */

describe("/help", () => {
  it("sends help text", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/help" });

    assert.equal(deps.send.mock.callCount(), 1);
    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.equal(msg.type, "system");
    assert.ok(msg.text.includes("/help"));
    assert.ok(msg.text.includes("/nick"));
    assert.ok(msg.text.includes("/join"));
  });
});

/* ------------------------------------------------------------------ */
/*  /nick                                                              */
/* ------------------------------------------------------------------ */

describe("/nick", () => {
  it("changes nick and broadcasts", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    const info = makeInfo({ nick: "OldNick" });
    await handle({ ws: fakeWs, info, text: "/nick NewNick" });

    assert.equal(info.nick, "NewNick");
    assert.equal(deps.broadcast.mock.callCount(), 1);
    const bMsg = deps.broadcast.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(bMsg.text.includes("OldNick"));
    assert.ok(bMsg.text.includes("NewNick"));
    assert.equal(deps.broadcastUserlist.mock.callCount(), 1);
  });

  it("rejects nick too short", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    const info = makeInfo();
    await handle({ ws: fakeWs, info, text: "/nick X" });

    assert.equal(info.nick, "TestUser"); // unchanged
    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("2-24"));
  });

  it("rejects nick too long", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    const info = makeInfo();
    await handle({ ws: fakeWs, info, text: "/nick " + "A".repeat(25) });

    assert.equal(info.nick, "TestUser");
  });

  it("rejects missing nick", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/nick" });

    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("2-24"));
  });

  it("rejects duplicate nick (case-insensitive)", async () => {
    const deps = makeDeps({
      listConnectedNicks: mock.fn(() => ["TestUser", "Alice"]),
    });
    const handle = createCommandHandler(deps as any);
    const info = makeInfo({ nick: "Bob" });
    await handle({ ws: fakeWs, info, text: "/nick alice" });

    assert.equal(info.nick, "Bob"); // unchanged
    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("deja utilise"));
  });

  it("allows re-casing own nick", async () => {
    const deps = makeDeps({
      listConnectedNicks: mock.fn(() => ["testuser", "Alice"]),
    });
    const handle = createCommandHandler(deps as any);
    const info = makeInfo({ nick: "testuser" });
    await handle({ ws: fakeWs, info, text: "/nick TestUser" });

    assert.equal(info.nick, "TestUser");
  });
});

/* ------------------------------------------------------------------ */
/*  /who                                                               */
/* ------------------------------------------------------------------ */

describe("/who", () => {
  it("sends userlist for current channel", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/who" });

    assert.ok(deps.send.mock.callCount() >= 1);
    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; users: string[] };
    assert.equal(msg.type, "userlist");
    assert.deepEqual(msg.users, ["TestUser", "Alice"]);
  });
});

/* ------------------------------------------------------------------ */
/*  /personas                                                          */
/* ------------------------------------------------------------------ */

describe("/personas", () => {
  it("sends persona list", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/personas" });

    assert.equal(deps.send.mock.callCount(), 1);
    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.equal(msg.type, "system");
    assert.ok(msg.text.includes("Merzbow"));
    assert.ok(msg.text.includes("Oracle"));
    assert.ok(msg.text.includes("llama3"));
  });
});

/* ------------------------------------------------------------------ */
/*  /join                                                              */
/* ------------------------------------------------------------------ */

describe("/join", () => {
  it("joins a valid channel", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    const info = makeInfo({ channel: "#general" });
    await handle({ ws: fakeWs, info, text: "/join #lounge" });

    assert.equal(info.channel, "#lounge");
    // broadcast part on old channel, join on new
    assert.equal(deps.broadcast.mock.callCount(), 2);
    const partMsg = deps.broadcast.mock.calls[0].arguments[1] as { type: string; channel: string };
    assert.equal(partMsg.type, "part");
    assert.equal(partMsg.channel, "#general");
    const joinMsg = deps.broadcast.mock.calls[1].arguments[1] as { type: string; channel: string };
    assert.equal(joinMsg.type, "join");
    assert.equal(joinMsg.channel, "#lounge");
    // broadcastUserlist called for both old and new
    assert.equal(deps.broadcastUserlist.mock.callCount(), 2);
    // send channelInfo + system confirmation
    assert.equal(deps.send.mock.callCount(), 2);
  });

  it("rejects channel without #", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    const info = makeInfo();
    await handle({ ws: fakeWs, info, text: "/join lounge" });

    assert.equal(info.channel, "#general"); // unchanged
    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("#"));
  });

  it("rejects channel with invalid characters", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/join #bad channel!" });

    // /join only takes parts[1], so "#bad" is valid; but let's test actual invalid chars
    const deps2 = makeDeps();
    const handle2 = createCommandHandler(deps2);
    const info2 = makeInfo();
    await handle2({ ws: fakeWs, info: info2, text: "/join #café" });

    assert.equal(info2.channel, "#general");
    const msg = deps2.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("invalide"));
  });

  it("rejects missing channel name", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/join" });

    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("Usage"));
  });

  it("rejects channel name too long", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info: makeInfo(), text: `/join #${"a".repeat(30)}` });

    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("2-30"));
  });
});

/* ------------------------------------------------------------------ */
/*  /channels                                                          */
/* ------------------------------------------------------------------ */

describe("/channels", () => {
  it("lists channels sorted by user count", async () => {
    const deps = makeDeps({
      listChannelCounts: mock.fn(() => new Map([["#random", 1], ["#general", 5]])),
    });
    const handle = createCommandHandler(deps as any);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/channels" });

    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("#general"));
    assert.ok(msg.text.includes("#random"));
    // #general (5) should appear before #random (1)
    assert.ok(msg.text.indexOf("#general") < msg.text.indexOf("#random"));
  });

  it("shows (aucun) when no channels", async () => {
    const deps = makeDeps({
      listChannelCounts: mock.fn(() => new Map()),
    });
    const handle = createCommandHandler(deps as any);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/channels" });

    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("(aucun)"));
  });
});

/* ------------------------------------------------------------------ */
/*  Unknown command                                                    */
/* ------------------------------------------------------------------ */

describe("unknown command", () => {
  it("sends error for unknown command", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/foobar" });

    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.equal(msg.type, "system");
    assert.ok(msg.text.includes("inconnue"));
    assert.ok(msg.text.includes("/foobar"));
    assert.ok(msg.text.includes("/help"));
  });
});

/* ------------------------------------------------------------------ */
/*  /web                                                               */
/* ------------------------------------------------------------------ */

describe("/web", () => {
  it("rejects empty query", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/web" });

    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("Usage"));
  });
});

/* ------------------------------------------------------------------ */
/*  /imagine                                                           */
/* ------------------------------------------------------------------ */

describe("/imagine", () => {
  it("rejects empty prompt", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/imagine" });

    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("Usage"));
  });
});

/* ------------------------------------------------------------------ */
/*  /compose                                                           */
/* ------------------------------------------------------------------ */

describe("/compose", () => {
  it("rejects empty prompt", async () => {
    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info: makeInfo(), text: "/compose" });

    const msg = deps.send.mock.calls[0].arguments[1] as { type: string; text: string };
    assert.ok(msg.text.includes("Usage"));
  });
});
