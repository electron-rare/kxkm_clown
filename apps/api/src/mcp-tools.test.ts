process.env.NODE_ENV = "test";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getToolsForPersona, getToolNames, TOOLS } from "./mcp-tools.js";

describe("TOOLS registry", () => {
  it("has web_search, image_generate, rag_search", () => {
    assert.ok(TOOLS.web_search, "web_search should exist");
    assert.ok(TOOLS.image_generate, "image_generate should exist");
    assert.ok(TOOLS.rag_search, "rag_search should exist");
  });

  it("tool definitions have valid function schema", () => {
    for (const [name, tool] of Object.entries(TOOLS)) {
      assert.equal(tool.type, "function", `${name} type should be function`);
      assert.equal(typeof tool.function.name, "string", `${name} should have a name`);
      assert.equal(typeof tool.function.description, "string", `${name} should have a description`);
      assert.equal(tool.function.parameters.type, "object", `${name} params type should be object`);
      assert.ok(Array.isArray(tool.function.parameters.required), `${name} should have required array`);
      assert.ok(tool.function.parameters.required.length > 0, `${name} should require at least one param`);
    }
  });

  it("each tool name matches its key", () => {
    for (const [key, tool] of Object.entries(TOOLS)) {
      assert.equal(key, tool.function.name, `key "${key}" should match function.name "${tool.function.name}"`);
    }
  });
});

describe("getToolsForPersona", () => {
  it("returns web_search + rag_search for sherlock", () => {
    const tools = getToolsForPersona("sherlock");
    const names = tools.map(t => t.function.name);
    assert.deepEqual(names.sort(), ["rag_search", "web_search"]);
  });

  it("returns image_generate + rag_search for picasso", () => {
    const tools = getToolsForPersona("picasso");
    const names = tools.map(t => t.function.name);
    assert.deepEqual(names.sort(), ["image_generate", "rag_search"]);
  });

  it("returns empty for pharmacius", () => {
    const tools = getToolsForPersona("pharmacius");
    assert.equal(tools.length, 0);
  });

  it("defaults to rag_search for unknown persona", () => {
    const tools = getToolsForPersona("unknown_persona_xyz");
    assert.equal(tools.length, 1);
    assert.equal(tools[0].function.name, "rag_search");
  });

  it("is case-insensitive", () => {
    const upper = getToolsForPersona("SHERLOCK");
    const lower = getToolsForPersona("sherlock");
    assert.deepEqual(
      upper.map(t => t.function.name).sort(),
      lower.map(t => t.function.name).sort(),
    );
  });
});

describe("getToolNames", () => {
  it("returns string array for sherlock", () => {
    const names = getToolNames("sherlock");
    assert.deepEqual(names.sort(), ["rag_search", "web_search"]);
  });

  it("returns empty array for pharmacius", () => {
    const names = getToolNames("pharmacius");
    assert.deepEqual(names, []);
  });

  it("returns rag_search for unknown persona", () => {
    const names = getToolNames("totally_unknown");
    assert.deepEqual(names, ["rag_search"]);
  });
});
