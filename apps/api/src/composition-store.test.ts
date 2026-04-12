process.env.NODE_ENV = "test";

import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
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
    assert.ok(comp, "createComposition should not return undefined");
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
    assert.ok(comp);
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
    assert.ok(comp);
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
    assert.ok(e1);
    await new Promise(r => setTimeout(r, 5));
    const e2 = createComposition("eve", "#b", "Eve B");
    assert.ok(e2);
    await new Promise(r => setTimeout(r, 5));
    const f1 = createComposition("frank", "#a", "Frank A");
    assert.ok(f1);

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
    assert.ok(comp);
    // Wait briefly for async writeFile to complete
    await new Promise(r => setTimeout(r, 50));
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
    assert.ok(comp);

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
    assert.ok(comp);
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
    assert.ok(comp);
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
    assert.ok(comp);

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

    // Wait for async saveComposition to flush to disk
    await new Promise(r => setTimeout(r, 100));

    const jsonPath = path.join(testDir, "data", "compositions", comp.id, "composition.json");
    const onDisk = JSON.parse(readFileSync(jsonPath, "utf-8"));
    assert.ok(onDisk.timeline, "timeline should be persisted");
    assert.equal(onDisk.timeline.version, 1);
    assert.equal(onDisk.timeline.bpm, 98);
    assert.equal(onDisk.timeline.markers.length, 1);
    assert.equal(onDisk.timeline.markers[0].label, "Intro");
  });

  it("setActiveComposition rebinds nick and channel", async () => {
    const { createComposition, setActiveComposition, getActiveComposition } = await storePromise;
    const comp = createComposition("lena", "#a", "Lena A");
    assert.ok(comp);
    const result = setActiveComposition("lena2", "#b", comp.id);
    assert.ok(result, "should return composition");
    assert.equal(result!.nick, "lena2");
    assert.equal(result!.channel, "#b");
    const found = getActiveComposition("lena2", "#b");
    assert.ok(found, "should find rebounded composition");
    assert.equal(found!.id, comp.id);
  });

  it("setActiveComposition returns undefined for unknown compId", async () => {
    const { setActiveComposition } = await storePromise;
    const result = setActiveComposition("nobody", "#x", "comp_nonexistent_abc");
    assert.equal(result, undefined);
  });

  it("updateTimelineSettings returns null for unknown compId", async () => {
    const { updateTimelineSettings } = await storePromise;
    const result = updateTimelineSettings("comp_nonexistent_abc", { bpm: 140 });
    assert.equal(result, null);
  });

  it("addTimelineMarker returns null for unknown compId", async () => {
    const { addTimelineMarker } = await storePromise;
    const result = addTimelineMarker("comp_nonexistent_abc", { label: "X", atMs: 1000 });
    assert.equal(result, null);
  });

  it("BPM is clamped to [20, 300]", async () => {
    const { createComposition, updateTimelineSettings } = await storePromise;
    const comp = createComposition("mike", "#clamp", "Mike Clamp");
    assert.ok(comp);
    const low = updateTimelineSettings(comp.id, { bpm: 5 });
    assert.equal(low!.bpm, 20, "bpm below 20 should clamp to 20");
    const high = updateTimelineSettings(comp.id, { bpm: 999 });
    assert.equal(high!.bpm, 300, "bpm above 300 should clamp to 300");
    const ok = updateTimelineSettings(comp.id, { bpm: 90.7 });
    assert.equal(ok!.bpm, 91, "bpm should be rounded");
  });

  it("timeSignature numerator and denominator are clamped to >= 1", async () => {
    const { createComposition, updateTimelineSettings } = await storePromise;
    const comp = createComposition("nina", "#clamp2", "Nina Clamp");
    assert.ok(comp);
    const ts = updateTimelineSettings(comp.id, { timeSignature: [0, -3] });
    assert.deepEqual(ts!.timeSignature, [1, 1], "both values should clamp to 1");
  });

  it("listTimelineMarkers returns sorted by atMs", async () => {
    const { createComposition, addTimelineMarker, listTimelineMarkers } = await storePromise;
    const comp = createComposition("otto", "#markers", "Otto Markers");
    assert.ok(comp);
    addTimelineMarker(comp.id, { label: "B", atMs: 8000 });
    addTimelineMarker(comp.id, { label: "A", atMs: 2000 });
    addTimelineMarker(comp.id, { label: "C", atMs: 15000 });
    const markers = listTimelineMarkers(comp.id);
    assert.equal(markers.length, 3);
    assert.equal(markers[0].label, "A");
    assert.equal(markers[1].label, "B");
    assert.equal(markers[2].label, "C");
  });

  it("multiple tracks generate multiple clips each linked by trackId", async () => {
    const { createComposition, addTrack, getTimeline } = await storePromise;
    const comp = createComposition("pam", "#multi", "Pam Multi");
    assert.ok(comp);
    const t1 = addTrack(comp.id, { type: "music", prompt: "beat", duration: 20, volume: 100, startMs: 0 });
    const t2 = addTrack(comp.id, { type: "voice", prompt: "narration", duration: 10, volume: 80, startMs: 5000 });
    assert.ok(t1);
    assert.ok(t2);
    const tl = getTimeline(comp.id);
    assert.ok(tl);
    assert.equal(tl!.clips.length, 2);
    const clipIds = tl!.clips.map((c: any) => c.trackId);
    assert.ok(clipIds.includes(t1!.id), "clip for t1 should exist");
    assert.ok(clipIds.includes(t2!.id), "clip for t2 should exist");
    const clip2 = tl!.clips.find((c: any) => c.trackId === t2!.id);
    assert.equal(clip2!.startMs, 5000);
    assert.equal(clip2!.durationMs, 10000);
  });

  it("clip gain is clamped between 0 and 200", async () => {
    const { createComposition, addTrack, getTimeline } = await storePromise;
    const comp = createComposition("quinn", "#gain", "Quinn Gain");
    assert.ok(comp);
    const t1 = addTrack(comp.id, { type: "sfx", prompt: "silent", duration: 5, volume: 0, startMs: 0 });
    const t2 = addTrack(comp.id, { type: "sfx", prompt: "loud", duration: 5, volume: 250, startMs: 0 });
    assert.ok(t1 && t2);
    const tl = getTimeline(comp.id);
    const clip1 = tl!.clips.find((c: any) => c.trackId === t1!.id);
    const clip2 = tl!.clips.find((c: any) => c.trackId === t2!.id);
    assert.equal(clip1!.gain, 0);
    assert.equal(clip2!.gain, 200);
  });

  it("serializes concurrent saves for the same composition without corrupting JSON", async () => {
    const {
      createComposition,
      addTrack,
      updateTimelineSettings,
      addTimelineMarker,
    } = await storePromise;

    const comp = createComposition("rose", "#race", "Race Safe");
    assert.ok(comp);

    addTrack(comp.id, { type: "music", prompt: "layer 1", duration: 8, volume: 90, startMs: 0 });
    addTrack(comp.id, { type: "voice", prompt: "layer 2", duration: 6, volume: 70, startMs: 1000 });
    updateTimelineSettings(comp.id, { bpm: 132, timeSignature: [7, 8] });
    addTimelineMarker(comp.id, { label: "Drop", atMs: 2400, color: "#ffaa00" });

    await new Promise((resolve) => setTimeout(resolve, 150));

    const jsonPath = path.join(testDir, "data", "compositions", comp.id, "composition.json");
    assert.ok(existsSync(jsonPath), "JSON file should exist after queued writes");

    const onDisk = JSON.parse(readFileSync(jsonPath, "utf-8"));
    assert.equal(onDisk.id, comp.id);
    assert.equal(onDisk.timeline.bpm, 132);
    assert.deepEqual(onDisk.timeline.timeSignature, [7, 8]);
    assert.equal(onDisk.timeline.tracks.length, 2);
    assert.equal(onDisk.timeline.clips.length, 2);
    assert.equal(onDisk.timeline.markers.length, 1);
    assert.equal(onDisk.timeline.markers[0].label, "Drop");
  });

  it("recovers a composition file with trailing garbage at boot", async () => {
    const compId = `comp_recover_${Date.now().toString(36)}`;
    const compDir = path.join(testDir, "data", "compositions", compId);
    mkdirSync(compDir, { recursive: true });

    const valid = {
      id: compId,
      name: "Recovered",
      channel: "#repair",
      nick: "repair-bot",
      tracks: [],
      timeline: {
        version: 1,
        bpm: 120,
        timeSignature: [4, 4],
        tracks: [],
        clips: [],
        markers: [],
      },
      createdAt: "2026-04-03T12:00:00.000Z",
      updatedAt: "2026-04-03T12:00:00.000Z",
    };
    writeFileSync(
      path.join(compDir, "composition.json"),
      `${JSON.stringify(valid, null, 2)}  "prompt": "orphaned tail"\n`,
      "utf8",
    );

    const repairedStore = await import(`./composition-store.js?recover=${Date.now()}`);
    const repaired = repairedStore.getComposition(compId);
    assert.ok(repaired, "boot loader should recover the composition");

    const repairedText = readFileSync(path.join(compDir, "composition.json"), "utf8");
    const repairedJson = JSON.parse(repairedText);
    assert.equal(repairedJson.id, compId);
    assert.equal(repairedJson.name, "Recovered");
  });

  it("quarantines an unrecoverable composition file at boot", async () => {
    const compId = `comp_quarantine_${Date.now().toString(36)}`;
    const compDir = path.join(testDir, "data", "compositions", compId);
    mkdirSync(compDir, { recursive: true });
    writeFileSync(
      path.join(compDir, "composition.json"),
      "{\n  \"id\": \"broken\",\n  \"name\": \"Incomplete\"\n",
      "utf8",
    );

    const quarantinedStore = await import(`./composition-store.js?quarantine=${Date.now()}`);
    assert.equal(quarantinedStore.getComposition(compId), undefined);
    assert.equal(existsSync(path.join(compDir, "composition.json")), false, "original corrupt file should be moved away");

    const quarantinedFiles = readdirSync(compDir).filter((name) => name.startsWith("composition.corrupt."));
    assert.equal(quarantinedFiles.length > 0, true, "a quarantined file should be kept for inspection");
  });
});
