import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createCommandHandler } from "./ws-commands.js";
import { addTrack, createComposition, setActiveComposition } from "./composition-store.js";
import type { ClientInfo, ChatPersona, OutboundMessage } from "./chat-types.js";
import type { WebSocket } from "ws";

// Unique per-run suffix to avoid nick/channel collisions with compositions persisted from prior test runs
const RUN_ID = Date.now().toString(36);

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

  it("prefers AI Bridge direct endpoint", async () => {
    const originalFetch = globalThis.fetch;
    const fakeFetch = mock.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/generate/music")) {
        return new Response(Buffer.from("RIFFtest"), { status: 200, headers: { "Content-Type": "audio/wav" } });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500, headers: { "Content-Type": "application/json" } });
    });
    (globalThis as any).fetch = fakeFetch;

    try {
      const deps = makeDeps();
      const handle = createCommandHandler(deps);
      await handle({ ws: fakeWs, info: makeInfo(), text: "/compose ambient drone, 10s" });

      assert.ok(fakeFetch.mock.calls.some((c) => String(c.arguments[0]).includes("/generate/music")));
      assert.ok(!fakeFetch.mock.calls.some((c) => String(c.arguments[0]).includes("/compose")));
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  it("falls back to TTS /compose when AI Bridge fails", async () => {
    const originalFetch = globalThis.fetch;
    const fakeFetch = mock.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/generate/music")) {
        return new Response(JSON.stringify({ error: "down" }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/compose")) {
        return new Response(Buffer.from("RIFFfallback"), { status: 200, headers: { "Content-Type": "audio/wav" } });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500, headers: { "Content-Type": "application/json" } });
    });
    (globalThis as any).fetch = fakeFetch;

    try {
      const deps = makeDeps();
      const handle = createCommandHandler(deps);
      await handle({ ws: fakeWs, info: makeInfo(), text: "/compose dark noise, 12s" });

      assert.ok(fakeFetch.mock.calls.some((c) => String(c.arguments[0]).includes("/generate/music")));
      assert.ok(fakeFetch.mock.calls.some((c) => String(c.arguments[0]).includes("/compose")));
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});

/* ------------------------------------------------------------------ */
/*  composition management routing                                     */
/* ------------------------------------------------------------------ */

describe("/rename", () => {
  it("renames the active composition through the extracted compose handler", async () => {
    const info = makeInfo({ nick: `ComposerRename_${RUN_ID}`, channel: `#compose-rename_${RUN_ID}` });
    createComposition(info.nick, info.channel, "Ancien nom");

    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info, text: "/rename Nouveau nom" });

    const msg = deps.send.mock.calls.at(-1)?.arguments[1] as { type: string; text: string };
    assert.equal(msg.type, "system");
    assert.ok(msg.text.includes("Nouveau nom"));
  });
});

describe("/tracks", () => {
  it("lists tracks through the extracted compose management handler", async () => {
    const info = makeInfo({ nick: `ComposerTracks_${RUN_ID}`, channel: `#compose-tracks_${RUN_ID}` });
    const comp = createComposition(info.nick, info.channel, "Track test");
    assert.ok(comp);
    addTrack(comp.id, { type: "music", prompt: "drone test", duration: 12, volume: 80, startMs: 0 });

    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info, text: "/tracks" });

    const msg = deps.send.mock.calls.at(-1)?.arguments[1] as { type: string; text: string };
    assert.equal(msg.type, "system");
    assert.ok(msg.text.includes("Track test"));
    assert.ok(msg.text.includes("drone test"));
  });
});

describe("/delete", () => {
  it("deletes a track through the extracted compose advanced handler", async () => {
    const info = makeInfo({ nick: `ComposerDelete_${RUN_ID}`, channel: `#compose-delete_${RUN_ID}` });
    const comp = createComposition(info.nick, info.channel, "Delete test");
    assert.ok(comp);
    setActiveComposition(info.nick, info.channel, comp.id);
    addTrack(comp.id, { type: "music", prompt: "first track", duration: 8, volume: 100, startMs: 0 });
    addTrack(comp.id, { type: "music", prompt: "second track", duration: 9, volume: 100, startMs: 0 });

    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info, text: "/delete 1" });

    const msg = deps.send.mock.calls.at(-1)?.arguments[1] as { type: string; text: string };
    assert.equal(msg.type, "system");
    assert.ok(msg.text.includes("supprimee"));
    assert.equal(comp.tracks.length, 1);
    assert.ok(comp.tracks[0].prompt.includes("second track"));
  });
});

describe("/marker", () => {
  it("adds and lists markers through the extracted compose advanced handler", async () => {
    const info = makeInfo({ nick: `ComposerMarker_${RUN_ID}`, channel: `#compose-marker_${RUN_ID}` });
    createComposition(info.nick, info.channel, "Marker test");

    const deps = makeDeps();
    const handle = createCommandHandler(deps);
    await handle({ ws: fakeWs, info, text: "/marker intro at 12s" });
    await handle({ ws: fakeWs, info, text: "/marker" });

    const lastMsg = deps.send.mock.calls.at(-1)?.arguments[1] as { type: string; text: string };
    assert.equal(lastMsg.type, "system");
    assert.ok(lastMsg.text.includes("intro"));
    assert.ok(lastMsg.text.includes("12s"));
  });
});
