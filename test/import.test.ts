import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { agrees, enrichRunFile } from "../src/enrich";
import { type BenchmarkTest, buildRun, orderResults, rigSlug, type RunMetadata } from "../src/import";
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
      "10": { connections: 10, samplesP99Ms: [50 * scale, 55 * scale], samplesRps: [200 / scale, 210 / scale], rps: 205 / scale, p50Ms: 30 * scale, p99Ms: 52.5 * scale, errorRate: 0, completed: 4000, transportErrors: 0, statusCodes: { "200": 4000 }, errorDistribution: {}, minCompletedPerPass: 1900 },
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

  test("builds the five sections with their tests, and never ranks the identity pass", () => {
    expect(run.sections[0]!.tests.some((t) => t.id.includes("identity"))).toBe(false);
    expect(run.sections.map((s) => s.id)).toEqual(["single-tile-latency", "concurrency", "random-walk", "viewport-burst", "cold-start"]);
    expect(run.sections[0]!.tests.map((t) => t.id)).toEqual(["mean-city-z14", "mean-district-z12", "mean-region-z9", "mean-country-z5"]);
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

  test("names each test's statistic and carries the per-pass samples its value summarizes", () => {
    const martin = RAW.results.find((r) => r.engine === "martin-pmtiles")!;
    const find = (section: number, id: string): BenchmarkTest => run.sections[section]!.tests.find((t) => t.id === id)!;
    const martinRow = (t: BenchmarkTest) => t.results.find((r) => r.candidateId === "martin-pmtiles")!;
    expect(find(0, "mean-city-z14").statistic).toBe("mean");
    expect(martinRow(find(0, "mean-city-z14")).samples).toEqual(martin.single["city-z14"]!.samplesMs);
    expect(find(1, "rps-c100").statistic).toBe("mean");
    expect(martinRow(find(1, "rps-c100")).samples).toEqual([220, 230]);
    expect(find(1, "p99-c10").statistic).toBe("median");
    expect(martinRow(find(1, "p99-c10")).samples).toEqual([50, 55]);
    // The pass that completed no request has no p99 and is not a sample.
    expect(martinRow(find(1, "p99-c100")).samples).toEqual([500]);
    expect(find(1, "errors-c100").statistic).toBe("other");
    for (const result of find(1, "errors-c100").results) expect(Object.keys(result)).toEqual(["candidateId", "value"]);
    expect(find(2, "walk-rps").statistic).toBe("mean");
    expect(martinRow(find(2, "walk-rps")).samples).toEqual([150, 160]);
    expect(find(2, "walk-p99").statistic).toBe("median");
    expect(martinRow(find(2, "walk-p99")).samples).toEqual([60, 62]);
    expect(find(3, "burst-mean").statistic).toBe("mean");
    expect(martinRow(find(3, "burst-mean")).samples).toEqual([40, 42, 38]);
    expect(find(3, "burst-max").statistic).toBe("max");
    expect(martinRow(find(3, "burst-max")).samples).toEqual([40, 42, 38]);
    expect(martinRow(find(3, "burst-max")).value).toBe(42);
    expect(find(4, "first-tile").statistic).toBe("mean");
    expect(martinRow(find(4, "first-tile")).samples).toEqual([500, 520, 480]);
    expect(find(4, "idle-rss").statistic).toBe("mean");
    expect(martinRow(find(4, "idle-rss")).samples).toEqual([50]);
    expect(find(4, "loaded-rss").statistic).toBe("mean");
    expect(martinRow(find(4, "loaded-rss")).samples).toEqual([80]);
  });

  test("writes a test's keys and a result's keys in the contract's order", () => {
    const burst = run.sections[3]!.tests[0]!;
    expect(Object.keys(burst)).toEqual(["id", "title", "description", "unit", "lowerIsBetter", "results", "statistic"]);
    expect(Object.keys(burst.results[0]!)).toEqual(["candidateId", "value", "samples"]);
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

describe("enrich", () => {
  const fresh = buildRun(orderResults(RAW), META);
  const withoutSamples = (run: unknown): string => JSON.stringify(run, (key: string, value: unknown) => (key === "statistic" || key === "samples" ? undefined : value), 2) + "\n";
  const stage = (raw: RawResults, runText = withoutSamples(fresh)): { runPath: string; resultsPath: string; runText: string } => {
    const dir = mkdtempSync(join(tmpdir(), "enrich-"));
    const runPath = join(dir, "run.json");
    const resultsPath = join(dir, "results.json");
    writeFileSync(runPath, runText);
    writeFileSync(resultsPath, JSON.stringify(raw, null, 2) + "\n");
    return { runPath, resultsPath, runText };
  };

  test("adds the statistic and the samples to a published run and changes nothing else", async () => {
    const { runPath, resultsPath, runText } = stage(RAW);
    expect(runText).not.toContain('"samples"');
    await enrichRunFile(runPath, resultsPath);
    const enriched: unknown = JSON.parse(readFileSync(runPath, "utf8"));
    expect(enriched).toEqual(fresh);
    expect(withoutSamples(enriched)).toBe(runText);
  });

  test("refuses results whose value differs from the published one, naming the test", async () => {
    const perturbed = structuredClone(RAW);
    perturbed.results.find((r) => r.engine === "martin-pmtiles")!.burst.maxMs += 1;
    const { runPath, resultsPath, runText } = stage(perturbed);
    await expect(enrichRunFile(runPath, resultsPath)).rejects.toThrow("viewport-burst/burst-max martin-pmtiles");
    expect(readFileSync(runPath, "utf8")).toBe(runText);
  });

  test("refuses samples that do not summarize to the published value, naming the test", async () => {
    const perturbed = structuredClone(RAW);
    const samples = perturbed.results.find((r) => r.engine === "martin-pmtiles")!.single["city-z14"]!.samplesMs;
    samples[0] = samples[0]! + 3;
    const { runPath, resultsPath, runText } = stage(perturbed);
    await expect(enrichRunFile(runPath, resultsPath)).rejects.toThrow("single-tile-latency/mean-city-z14 martin-pmtiles");
    expect(readFileSync(runPath, "utf8")).toBe(runText);
  });

  test("refuses a run file that is not in the importer's format", async () => {
    const { runPath, resultsPath } = stage(RAW, JSON.stringify(JSON.parse(withoutSamples(fresh))));
    await expect(enrichRunFile(runPath, resultsPath)).rejects.toThrow("format");
  });

  test("holds a recomputed value to half a unit in the value's last digit", () => {
    expect(agrees(44.174, 44.1744)).toBe(true);
    expect(agrees(44.174, 44.1746)).toBe(false);
    expect(agrees(500, 500.5)).toBe(true);
    expect(agrees(500, 500.51)).toBe(false);
  });
});
