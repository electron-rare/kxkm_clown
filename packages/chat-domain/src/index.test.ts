import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createChatMessage,
  createChatSession,
  compactHistory,
  isValidChannelName,
  normalizeChannelName,
  buildChatChannels,
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
