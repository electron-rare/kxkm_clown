import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createChatMessage,
  createChatSession,
  compactHistory,
  isValidChannelName,
  normalizeChannelName,
  buildChatChannels,
  createConversationMemory,
  addToMemory,
  buildLlmContext,
  clearMemory,
  parseSlashCommand,
  resolveCommand,
  generateHelpText,
  SLASH_COMMANDS,
} from "./index.js";
import type { ChatMessage } from "./index.js";

describe("createChatMessage", () => {
  it("creates a valid message with required fields", () => {
    const msg = createChatMessage("general", "alice", "hello world");
    assert.equal(typeof msg.id, "string");
    assert.ok(msg.id.startsWith("msg_"));
    assert.equal(msg.channel, "general");
    assert.equal(msg.nick, "alice");
    assert.equal(msg.content, "hello world");
    assert.equal(typeof msg.timestamp, "string");
    assert.equal(msg.personaId, undefined);
  });

  it("includes personaId when provided", () => {
    const msg = createChatMessage("general", "bot", "hi", "schaeffer");
    assert.equal(msg.personaId, "schaeffer");
  });
});

describe("createChatSession", () => {
  it("creates a valid session", () => {
    const session = createChatSession("user1");
    assert.ok(session.id.startsWith("session_"));
    assert.equal(session.userId, "user1");
    assert.equal(session.channel, "general");
    assert.equal(session.model, null);
    assert.equal(session.persona, null);
    assert.equal(typeof session.createdAt, "string");
    assert.equal(typeof session.lastActivity, "string");
  });

  it("uses custom channel when provided", () => {
    const session = createChatSession("user2", "admin");
    assert.equal(session.channel, "admin");
  });
});

describe("compactHistory", () => {
  function makeMessages(n: number): ChatMessage[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `msg_${i}`,
      channel: "general",
      nick: "test",
      content: `message ${i}`,
      timestamp: new Date(2024, 0, 1, 0, i).toISOString(),
    }));
  }

  it("returns all messages when under maxMessages", () => {
    const msgs = makeMessages(3);
    const result = compactHistory(msgs, 10, 5);
    assert.equal(result.length, 3);
    assert.deepEqual(result, msgs);
  });

  it("trims old messages keeping recent", () => {
    const msgs = makeMessages(20);
    const result = compactHistory(msgs, 10, 5);
    assert.equal(result.length, 5);
    // Should keep the last 5
    assert.equal(result[0].id, "msg_15");
    assert.equal(result[4].id, "msg_19");
  });
});

describe("isValidChannelName", () => {
  it("accepts valid names", () => {
    assert.equal(isValidChannelName("general"), true);
    assert.equal(isValidChannelName("my-channel"), true);
    assert.equal(isValidChannelName("chan_123"), true);
  });

  it("rejects invalid names", () => {
    assert.equal(isValidChannelName(""), false);
    assert.equal(isValidChannelName("123abc"), false); // must start with letter
    assert.equal(isValidChannelName("My Channel"), false); // spaces and uppercase
    assert.equal(isValidChannelName("-start"), false);
  });
});

describe("normalizeChannelName", () => {
  it("normalizes channel names", () => {
    assert.equal(normalizeChannelName("#General"), "general");
    assert.equal(normalizeChannelName("My Channel!"), "my-channel");
    assert.equal(normalizeChannelName("###test"), "test");
  });

  it("strips leading hash and lowercases", () => {
    assert.equal(normalizeChannelName("#Admin"), "admin");
  });
});

describe("buildChatChannels", () => {
  it("creates default + model channels", () => {
    const channels = buildChatChannels(["mistral:7b", "qwen2.5:14b"]);
    // 2 default + 2 model
    assert.equal(channels.length, 4);
    assert.equal(channels[0].id, "general");
    assert.equal(channels[1].id, "admin");
    assert.equal(channels[2].kind, "dedicated");
    assert.equal(channels[2].model, "mistral:7b");
    assert.equal(channels[3].kind, "dedicated");
    assert.equal(channels[3].model, "qwen2.5:14b");
  });

  it("returns only defaults when no models provided", () => {
    const channels = buildChatChannels([]);
    assert.equal(channels.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Conversational memory
// ---------------------------------------------------------------------------

describe("createConversationMemory", () => {
  it("creates empty memory with default max size", () => {
    const mem = createConversationMemory("sess_1");
    assert.equal(mem.sessionId, "sess_1");
    assert.equal(mem.messages.length, 0);
    assert.equal(mem.maxSize, 100);
  });

  it("respects custom max size", () => {
    const mem = createConversationMemory("sess_2", 50);
    assert.equal(mem.maxSize, 50);
  });
});

describe("addToMemory", () => {
  it("adds messages to memory", () => {
    const mem = createConversationMemory("sess_1");
    const msg = createChatMessage("general", "alice", "hello");
    addToMemory(mem, msg);
    assert.equal(mem.messages.length, 1);
    assert.equal(mem.messages[0].content, "hello");
  });

  it("evicts oldest when over capacity", () => {
    const mem = createConversationMemory("sess_1", 3);
    for (let i = 0; i < 5; i++) {
      addToMemory(mem, createChatMessage("general", "user", `msg ${i}`));
    }
    assert.equal(mem.messages.length, 3);
    assert.equal(mem.messages[0].content, "msg 2");
    assert.equal(mem.messages[2].content, "msg 4");
  });
});

describe("buildLlmContext", () => {
  it("maps persona messages as assistant, others as user", () => {
    const mem = createConversationMemory("sess_1");
    addToMemory(mem, createChatMessage("general", "alice", "hello"));
    addToMemory(mem, createChatMessage("general", "bot", "hi there", "schaeffer"));
    const ctx = buildLlmContext(mem);
    assert.equal(ctx.length, 2);
    assert.equal(ctx[0].role, "user");
    assert.equal(ctx[1].role, "assistant");
  });

  it("respects limit parameter", () => {
    const mem = createConversationMemory("sess_1");
    for (let i = 0; i < 10; i++) {
      addToMemory(mem, createChatMessage("general", "user", `msg ${i}`));
    }
    const ctx = buildLlmContext(mem, 3);
    assert.equal(ctx.length, 3);
    assert.equal(ctx[0].content, "msg 7");
  });
});

describe("clearMemory", () => {
  it("empties all messages", () => {
    const mem = createConversationMemory("sess_1");
    addToMemory(mem, createChatMessage("general", "user", "hello"));
    clearMemory(mem);
    assert.equal(mem.messages.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

describe("parseSlashCommand", () => {
  it("parses a simple command", () => {
    const cmd = parseSlashCommand("/help");
    assert.ok(cmd);
    assert.equal(cmd.name, "help");
    assert.equal(cmd.args, "");
  });

  it("parses a command with arguments", () => {
    const cmd = parseSlashCommand("/nick Alice");
    assert.ok(cmd);
    assert.equal(cmd.name, "nick");
    assert.equal(cmd.args, "Alice");
  });

  it("parses multi-word arguments", () => {
    const cmd = parseSlashCommand("/msg schaeffer hello how are you");
    assert.ok(cmd);
    assert.equal(cmd.name, "msg");
    assert.equal(cmd.args, "schaeffer hello how are you");
  });

  it("returns null for non-command input", () => {
    assert.equal(parseSlashCommand("hello"), null);
    assert.equal(parseSlashCommand(""), null);
    assert.equal(parseSlashCommand("/ invalid"), null);
  });
});

describe("resolveCommand", () => {
  it("finds existing commands", () => {
    const parsed = parseSlashCommand("/help")!;
    const result = resolveCommand(parsed, false);
    assert.ok(result.command);
    assert.equal(result.command.name, "help");
    assert.equal(result.denied, false);
  });

  it("denies admin-only commands for non-admin", () => {
    const parsed = parseSlashCommand("/model gpt-4")!;
    const result = resolveCommand(parsed, false);
    assert.ok(result.command);
    assert.equal(result.denied, true);
  });

  it("allows admin-only commands for admin", () => {
    const parsed = parseSlashCommand("/model gpt-4")!;
    const result = resolveCommand(parsed, true);
    assert.ok(result.command);
    assert.equal(result.denied, false);
  });

  it("returns null command for unknown commands", () => {
    const parsed = parseSlashCommand("/unknown")!;
    const result = resolveCommand(parsed, true);
    assert.equal(result.command, null);
  });
});

describe("generateHelpText", () => {
  it("includes all commands for admin", () => {
    const text = generateHelpText(true);
    for (const cmd of SLASH_COMMANDS) {
      assert.ok(text.includes(cmd.name), `should include ${cmd.name}`);
    }
  });

  it("excludes admin-only commands for non-admin", () => {
    const text = generateHelpText(false);
    const adminCmds = SLASH_COMMANDS.filter((c) => c.adminOnly);
    for (const cmd of adminCmds) {
      assert.ok(!text.includes(`/${cmd.name} `), `should exclude /${cmd.name}`);
    }
  });
});
