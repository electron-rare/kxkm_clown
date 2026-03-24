process.env.NODE_ENV = "test";

import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

// Create temp dir and chdir into it BEFORE importing composition-store
// so that COMP_DIR (process.cwd()/data/compositions) resolves inside the temp dir
const testDir = mkdtempSync(path.join(os.tmpdir(), "kxkm-test-comp-"));
const originalCwd = process.cwd();
process.chdir(testDir);

// Dynamic import so COMP_DIR uses our temp dir
const storePromise = import("./composition-store.js");

// Cleanup after all tests
after(() => {
  process.chdir(originalCwd);
  rmSync(testDir, { recursive: true, force: true });
});

describe("composition-store", () => {
  it("createComposition creates with id and name", async () => {
    const { createComposition } = await storePromise;
    const comp = createComposition("alice", "#music", "My Song");
    assert.ok(comp.id.startsWith("comp_"), "id should start with comp_");
    assert.equal(comp.name, "My Song");
    assert.equal(comp.nick, "alice");
    assert.equal(comp.channel, "#music");
    assert.ok(Array.isArray(comp.tracks));
    assert.equal(comp.tracks.length, 0);
    assert.ok(comp.createdAt);
    assert.ok(comp.updatedAt);
  });

  it("getComposition returns created composition", async () => {
    const { createComposition, getComposition } = await storePromise;
    const comp = createComposition("bob", "#studio", "Bob Mix");
    const found = getComposition(comp.id);
    assert.ok(found, "should find the composition");
    assert.equal(found!.id, comp.id);
    assert.equal(found!.name, "Bob Mix");
  });

  it("getActiveComposition finds by nick and channel", async () => {
    const { createComposition, getActiveComposition } = await storePromise;
    createComposition("carol", "#live", "Carol Live");
    const active = getActiveComposition("carol", "#live");
    assert.ok(active, "should find active composition");
    assert.equal(active!.nick, "carol");
    assert.equal(active!.channel, "#live");

    const missing = getActiveComposition("carol", "#other");
    assert.equal(missing, undefined, "should not find for wrong channel");
  });

  it("addTrack adds to composition tracks", async () => {
    const { createComposition, addTrack, getComposition } = await storePromise;
    const comp = createComposition("dave", "#jam", "Dave Jam");
    const track = addTrack(comp.id, {
      type: "music",
      prompt: "ambient drone",
      duration: 30,
      volume: 80,
      startMs: 0,
    });
    assert.ok(track, "track should be created");
    assert.ok(track!.id.startsWith("trk_"), "track id should start with trk_");
    assert.equal(track!.prompt, "ambient drone");
    assert.equal(track!.type, "music");

    const updated = getComposition(comp.id);
    assert.equal(updated!.tracks.length, 1);
    assert.equal(updated!.tracks[0].id, track!.id);
  });

  it("addTrack returns null for unknown compId", async () => {
    const { addTrack } = await storePromise;
    const result = addTrack("comp_nonexistent", {
      type: "sfx",
      prompt: "boom",
      duration: 2,
      volume: 100,
      startMs: 0,
    });
    assert.equal(result, null);
  });

  it("listCompositions filters by nick", async () => {
    const { createComposition, listCompositions } = await storePromise;
    // Small delays to avoid Date.now() collisions in ID generation
    const e1 = createComposition("eve", "#a", "Eve A");
    await new Promise(r => setTimeout(r, 5));
    const e2 = createComposition("eve", "#b", "Eve B");
    await new Promise(r => setTimeout(r, 5));
    const f1 = createComposition("frank", "#a", "Frank A");

    assert.notEqual(e1.id, e2.id, "eve compositions should have distinct ids");
    assert.notEqual(e2.id, f1.id, "eve and frank should have distinct ids");

    const eveComps = listCompositions("eve");
    const eveIds = eveComps.map((c: any) => c.id);
    assert.ok(eveIds.includes(e1.id), "should contain Eve A");
    assert.ok(eveIds.includes(e2.id), "should contain Eve B");
    assert.ok(!eveIds.includes(f1.id), "should not contain Frank A");
    assert.ok(eveComps.every((c: any) => c.nick === "eve"), "all filtered should be eve");

    const allComps = listCompositions();
    const allIds = allComps.map((c: any) => c.id);
    assert.ok(allIds.includes(e1.id), "all should contain Eve A");
    assert.ok(allIds.includes(f1.id), "all should contain Frank A");
  });

  it("composition persists to JSON file", async () => {
    const { createComposition } = await storePromise;
    const comp = createComposition("grace", "#persist", "Grace Persist");
    const jsonPath = path.join(testDir, "data", "compositions", comp.id, "composition.json");
    assert.ok(existsSync(jsonPath), "JSON file should exist on disk");

    const onDisk = JSON.parse(readFileSync(jsonPath, "utf-8"));
    assert.equal(onDisk.id, comp.id);
    assert.equal(onDisk.name, "Grace Persist");
    assert.equal(onDisk.nick, "grace");
    assert.equal(onDisk.channel, "#persist");
  });

  it("track has correct type and fields", async () => {
    const { createComposition, addTrack } = await storePromise;
    const comp = createComposition("hank", "#fields", "Hank Fields");

    const voiceTrack = addTrack(comp.id, {
      type: "voice",
      prompt: "narrator voice",
      style: "dramatic",
      duration: 15,
      volume: 90,
      startMs: 5000,
    });

    assert.ok(voiceTrack);
    assert.equal(voiceTrack!.type, "voice");
    assert.equal(voiceTrack!.prompt, "narrator voice");
    assert.equal(voiceTrack!.style, "dramatic");
    assert.equal(voiceTrack!.duration, 15);
    assert.equal(voiceTrack!.volume, 90);
    assert.equal(voiceTrack!.startMs, 5000);
    assert.ok(voiceTrack!.createdAt, "should have createdAt timestamp");
    assert.ok(voiceTrack!.id, "should have an id");

    const sfxTrack = addTrack(comp.id, {
      type: "sfx",
      prompt: "explosion",
      duration: 3,
      volume: 100,
      startMs: 10000,
    });
    assert.ok(sfxTrack);
    assert.equal(sfxTrack!.type, "sfx");
    assert.equal(sfxTrack!.filePath, undefined, "filePath should be undefined when not set");
  });

  it("createComposition initializes timeline model v1", async () => {
    const { createComposition, getTimeline } = await storePromise;
    const comp = createComposition("ivy", "#timeline", "Timeline V1");
    const timeline = getTimeline(comp.id);

    assert.ok(timeline, "timeline should exist");
    assert.equal(timeline!.version, 1);
    assert.equal(timeline!.bpm, 120);
    assert.deepEqual(timeline!.timeSignature, [4, 4]);
    assert.equal(timeline!.tracks.length, 0);
    assert.equal(timeline!.clips.length, 0);
    assert.equal(timeline!.markers.length, 0);
  });

  it("addTrack creates a default clip in timeline", async () => {
    const { createComposition, addTrack, getTimeline } = await storePromise;
    const comp = createComposition("jules", "#timeline", "Track Clip");
    const track = addTrack(comp.id, {
      type: "music",
      prompt: "test clip",
      duration: 12,
      volume: 70,
      startMs: 2500,
    });

    assert.ok(track);
    const timeline = getTimeline(comp.id);
    assert.ok(timeline);
    assert.equal(timeline!.tracks.length, 1);
    assert.equal(timeline!.clips.length, 1);
    assert.equal(timeline!.clips[0].trackId, track!.id);
    assert.equal(timeline!.clips[0].startMs, 2500);
    assert.equal(timeline!.clips[0].durationMs, 12000);
    assert.equal(timeline!.clips[0].gain, 70);
  });

  it("updates timeline settings and persists markers", async () => {
    const {
      createComposition,
      updateTimelineSettings,
      addTimelineMarker,
      listTimelineMarkers,
    } = await storePromise;
    const comp = createComposition("kate", "#timeline", "Tempo + Markers");

    const updated = updateTimelineSettings(comp.id, { bpm: 98, timeSignature: [3, 4] });
    assert.ok(updated);
    assert.equal(updated!.bpm, 98);
    assert.deepEqual(updated!.timeSignature, [3, 4]);

    const marker = addTimelineMarker(comp.id, { label: "Intro", atMs: 4000, color: "#ff66b2" });
    assert.ok(marker);
    assert.equal(marker!.label, "Intro");

    const markers = listTimelineMarkers(comp.id);
    assert.equal(markers.length, 1);
    assert.equal(markers[0].label, "Intro");
    assert.equal(markers[0].atMs, 4000);

    const jsonPath = path.join(testDir, "data", "compositions", comp.id, "composition.json");
    const onDisk = JSON.parse(readFileSync(jsonPath, "utf-8"));
    assert.ok(onDisk.timeline, "timeline should be persisted");
    assert.equal(onDisk.timeline.version, 1);
    assert.equal(onDisk.timeline.bpm, 98);
    assert.equal(onDisk.timeline.markers.length, 1);
    assert.equal(onDisk.timeline.markers[0].label, "Intro");
  });

  it("setActiveComposition rebinds nick/channel while preserving timeline", async () => {
    const {
      createComposition,
      addTrack,
      setActiveComposition,
      getActiveComposition,
      getTimeline,
    } = await storePromise;
    const comp = createComposition("louis", "#old", "Rebind test");
    const track = addTrack(comp.id, {
      type: "music",
      prompt: "slow pulse",
      duration: 6,
      volume: 55,
      startMs: 1200,
    });

    assert.ok(track);

    const rebound = setActiveComposition("marie", "#new", comp.id);
    assert.ok(rebound);
    assert.equal(rebound!.nick, "marie");
    assert.equal(rebound!.channel, "#new");

    const active = getActiveComposition("marie", "#new");
    assert.ok(active);
    assert.equal(active!.id, comp.id);

    const timeline = getTimeline(comp.id);
    assert.ok(timeline);
    assert.equal(timeline!.tracks.length, 1);
    assert.equal(timeline!.clips.length, 1);
    assert.equal(timeline!.clips[0].trackId, track!.id);
  });

  it("clamps timeline settings and sorts markers by position", async () => {
    const {
      createComposition,
      updateTimelineSettings,
      addTimelineMarker,
      listTimelineMarkers,
    } = await storePromise;
    const comp = createComposition("nina", "#sort", "Clamp test");

    const timeline = updateTimelineSettings(comp.id, { bpm: 999, timeSignature: [0, 0] });
    assert.ok(timeline);
    assert.equal(timeline!.bpm, 300);
    assert.deepEqual(timeline!.timeSignature, [1, 1]);

    addTimelineMarker(comp.id, { label: "Outro", atMs: 9000 });
    addTimelineMarker(comp.id, { label: "Intro", atMs: 1000 });
    addTimelineMarker(comp.id, { label: "Middle", atMs: 5000 });

    const markers = listTimelineMarkers(comp.id);
    assert.deepEqual(markers.map((marker) => marker.label), ["Intro", "Middle", "Outro"]);
    assert.deepEqual(markers.map((marker) => marker.atMs), [1000, 5000, 9000]);
  });
});
