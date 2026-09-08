import { describe, expect, test } from "bun:test";
import { buildRun, orderResults, rigSlug, type RunMetadata } from "../src/import";
import { parseOha } from "../src/load-runner";
import type { Engine } from "../src/matrix";
import type { EngineResult, RawResults } from "../src/run";

function engineResult(engine: Engine, scale: number): EngineResult {
  const tile = (meanMs: number) => ({
    samplesMs: [meanMs * 0.9, meanMs, meanMs * 1.1],
    meanMs,
    p50Ms: meanMs,
    p99Ms: meanMs * 1.5,
    maxMs: meanMs * 2,
    requests: 15,
    errorRate: 0,
    bytesPerRequest: 40000,
  });
  const parity = { status: 200, bytes: 40000, contentType: "application/x-protobuf", contentEncoding: null, layers: [{ name: "buildings", version: 2, extent: 4096, features: 700, geometryTypes: { polygon: 700 } }], features: 700, identity: { status: 200, bytes: 60000, contentEncoding: null } };
  return {
    engine,
    image: `${engine}:test`,
    startedAt: "2026-09-01T10:00:00.000Z",
    durationS: 60,
    coldStart: { samplesMs: [500 * scale, 520 * scale, 480 * scale], idleRssMb: 50 * scale },
    parity: { "city-z14": parity, "district-z12": parity, "region-z9": parity, "country-z5": parity },
    single: { "city-z14": tile(20 * scale), "district-z12": tile(15 * scale), "region-z9": tile(10 * scale), "country-z5": tile(30 * scale), "city-z14-identity": tile(25 * scale) },
    burst: { samplesMs: [40 * scale, 42 * scale, 38 * scale], meanMs: 40 * scale, p50Ms: 40 * scale, maxMs: 42 * scale, slowestTileMeanMs: 30 * scale, errorRate: 0 },
    concurrency: {
      "10": { connections: 10, samplesP99Ms: [50 * scale, 55 * scale], samplesRps: [200 / scale, 210 / scale], rps: 205 / scale, p50Ms: 30 * scale, p99Ms: 52 * scale, errorRate: 0, completed: 4000, transportErrors: 0, statusCodes: { "200": 4000 }, errorDistribution: {}, minCompletedPerPass: 1900 },
      "100": { connections: 100, samplesP99Ms: [500 * scale, null], samplesRps: [220 / scale, 230 / scale], rps: 225 / scale, p50Ms: 300 * scale, p99Ms: 500 * scale, errorRate: 0.01, completed: 4400, transportErrors: 44, statusCodes: { "200": 4400 }, errorDistribution: { timeout: 44 }, minCompletedPerPass: 2100 },
    },
    walk: { connections: 10, tiles: 256, samplesRps: [150 / scale, 160 / scale], samplesP99Ms: [60 * scale, 62 * scale], rps: 155 / scale, p50Ms: 40 * scale, p99Ms: 61 * scale, errorRate: 0, completed: 3000, transportErrors: 0, statusCodes: { "200": 3000 }, bytesPerRequest: 30000 },
    rssAfterLoadMb: 80 * scale,
  };
}

const RAW: RawResults = {
  schemaVersion: 1,
  generatedAt: "2026-09-01T12:00:00.000Z",
  smoke: false,
  corpus: { extract: { file: "x", md5: "y" }, mbtilesBytes: 1, pmtilesBytes: 1, pmtilesMd5: "z", tools: { planetiler: "ghcr.io/onthegomap/planetiler:0.10.2", pmtiles: "protomaps/go-pmtiles:v1.31.2" } },
  tiles: [
    { id: "city-z14", z: 14, x: 8802, y: 5371 },
    { id: "district-z12", z: 12, x: 2200, y: 1342 },
    { id: "region-z9", z: 9, x: 275, y: 167 },
    { id: "country-z5", z: 5, x: 17, y: 10 },
  ],
  viewport: { tiles: [] },
  walk: { z: 14, x: { min: 8794, max: 8809 }, y: { min: 5366, max: 5381 } },
  results: [engineResult("go-pmtiles", 3), engineResult("martin-pmtiles", 1)],
  failures: [],
};

const META: RunMetadata = {
  id: "2026-09-01-m2-max",
  label: "M2 Max (local)",
  publishedAt: "2026-09-01",
  environment: { machine: "MacBook Pro", chip: "Apple M2 Max", cores: "12", memory: "96 GB", os: "macOS", arch: "arm64", runtime: "Docker" },
  protocol: { warmups: 3, runs: 20, processModel: "x", cacheState: "y", output: "z" },
};

describe("run import", () => {
  const run = buildRun(orderResults(RAW), META);

  test("produces exactly the run-file keys", () => {
    expect(Object.keys(run).sort()).toEqual(["candidates", "environment", "id", "label", "protocol", "publishedAt", "schemaVersion", "sections"]);
    expect(run.candidates).toEqual([]);
  });

  test("orders engines the way the site lists them", () => {
    expect(run.sections[0]!.candidates.map((c) => c.id)).toEqual(["martin-pmtiles", "go-pmtiles"]);
  });

  test("builds the five sections with their tests", () => {
    expect(run.sections.map((s) => s.id)).toEqual(["single-tile-latency", "concurrency", "random-walk", "viewport-burst", "cold-start"]);
    expect(run.sections[0]!.tests.map((t) => t.id)).toEqual(["mean-city-z14", "mean-district-z12", "mean-region-z9", "mean-country-z5", "mean-city-z14-identity"]);
    expect(run.sections[1]!.tests.map((t) => t.id)).toEqual(["rps-c10", "rps-c100", "p99-c10", "p99-c100", "errors-c100"]);
    expect(run.sections[2]!.tests.map((t) => t.id)).toEqual(["walk-rps", "walk-p99"]);
    expect(run.sections[3]!.tests.map((t) => t.id)).toEqual(["burst-mean", "burst-max"]);
    expect(run.sections[4]!.tests.map((t) => t.id)).toEqual(["first-tile", "idle-rss", "loaded-rss"]);
  });

  test("picks the faster engine as every section's winner, by mean", () => {
    for (const section of run.sections) expect(section.verdict.winnerId).toBe("martin-pmtiles");
    const coldStart = run.sections[4]!;
    expect(coldStart.tests[0]!.results.find((r) => r.candidateId === "martin-pmtiles")?.value).toBe(500);
    expect(coldStart.verdict.headline).toContain("500 ms after process start on average");
  });

  test("carries samples through and summarises them", () => {
    const martin = run.sections[0]!.candidates.find((c) => c.id === "martin-pmtiles")!;
    expect(martin.samplesMs).toEqual([18, 20, 22]);
    expect(martin.statistics).toEqual({ medianMs: 20, meanMs: 20, minMs: 18, maxMs: 22 });
    expect(martin.metrics?.["city-z14-bytes"]?.value).toBe(40000);
    expect(martin.metrics?.["city-z14-identity-bytes"]?.value).toBe(60000);
    expect(martin.metrics?.["city-z14-identity-mean"]?.value).toBe(25);
    const concurrency = run.sections[1]!.candidates.find((c) => c.id === "martin-pmtiles")!;
    expect(concurrency.samplesMs).toEqual([220, 230]);
    expect(run.sections[1]!.lowerIsBetter).toBe(false);
  });

  test("names the run after the rig", () => {
    expect(rigSlug("Apple M2 Max")).toBe("m2-max");
    expect(rigSlug("AWS Graviton3")).toBe("aws-graviton3");
  });
});

describe("oha parsing", () => {
  test("derives counts, rates and millisecond latencies", () => {
    const pass = parseOha(
      JSON.stringify({
        summary: { total: 12.0, slowest: 0.9, fastest: 0.01, average: 0.05, requestsPerSec: 100, sizePerRequest: 40000 },
        latencyPercentiles: { p50: 0.04, p99: 0.4 },
        statusCodeDistribution: { "200": 1180, "500": 20 },
        errorDistribution: { timeout: 5, "aborted due to deadline": 10 },
      }),
    );
    expect(pass.completed).toBe(1200);
    expect(pass.success).toBe(1180);
    expect(pass.transportErrors).toBe(5);
    expect(pass.abortedAtDeadline).toBe(10);
    expect(pass.p50Ms).toBe(40);
    expect(pass.p99Ms).toBe(400);
    expect(pass.meanMs).toBe(50);
    expect(pass.bytesPerRequest).toBe(40000);
  });

  test("reports null latencies when nothing completed", () => {
    const pass = parseOha(JSON.stringify({ summary: { total: 12, slowest: null, fastest: null, average: null, requestsPerSec: 0 }, statusCodeDistribution: {}, errorDistribution: { timeout: 100 } }));
    expect(pass.completed).toBe(0);
    expect(pass.p99Ms).toBeNull();
    expect(pass.meanMs).toBeNull();
  });
});
