import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  createNodeEngineRegistry,
  type NodeTypeDefinition,
} from "./registry.js";

describe("createNodeEngineRegistry", () => {
  it("lists built-in node types", () => {
    const reg = createNodeEngineRegistry();
    const types = reg.listNodeTypes();
    assert.ok(types.length > 0);
  });

  it("getNodeType returns a known type", () => {
    const reg = createNodeEngineRegistry();
    const nt = reg.getNodeType("dataset_file");
    assert.notEqual(nt, null);
    assert.equal(nt!.id, "dataset_file");
  });

  it("getNodeType returns null for unknown", () => {
    const reg = createNodeEngineRegistry();
    assert.equal(reg.getNodeType("nonexistent"), null);
  });

  it("register adds a custom node type", () => {
    const reg = createNodeEngineRegistry();
    const custom: NodeTypeDefinition = {
      id: "custom_node",
      family: "custom",
      label: "Custom",
      inputs: ["dataset"],
      outputs: ["dataset"],
      params: [],
      runtimes: ["local_cpu"],
      description: "A custom node",
    };

    reg.register(custom);

    const result = reg.getNodeType("custom_node");
    assert.notEqual(result, null);
    assert.equal(result!.label, "Custom");
  });

  it("listFamilies returns known families", () => {
    const reg = createNodeEngineRegistry();
    const families = reg.listFamilies();
    assert.ok(families.includes("dataset_source"));
    assert.ok(families.includes("training"));
  });
});
