import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const CORPUS = {
  file: "berlin-260101.osm.pbf",
  url: "https://download.geofabrik.de/europe/germany/berlin-260101.osm.pbf",
  /** Geofabrik publishes MD5 next to every extract; this is the value for the 2026-01-01 Berlin file. */
  md5: "6d6de8da2d8192c5bbe7dd00e1004c82",
} as const;

/** Planetiler builds the MBTiles archive; go-pmtiles converts it, so both archives hold the same tile bytes. */
export const TOOLS = {
  planetiler: "ghcr.io/onthegomap/planetiler:0.10.2",
  pmtiles: "protomaps/go-pmtiles:v1.31.2",
} as const;

const root = join(import.meta.dirname!, "..");
export const cacheDir = join(root, "data", "cache");
export const archiveDir = join(cacheDir, "archives");
export const MBTILES = join(archiveDir, "berlin.mbtiles");
export const PMTILES = join(archiveDir, "berlin.pmtiles");

export async function md5File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

export async function ensureExtract(): Promise<string> {
  mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, CORPUS.file);
  if (existsSync(path)) {
    const digest = await md5File(path);
    if (digest === CORPUS.md5) return path;
    console.log(`  cached extract has md5 ${digest}, expected ${CORPUS.md5}; re-downloading`);
  }
  console.log(`  downloading ${CORPUS.url}`);
  const response = await fetch(CORPUS.url);
  if (!response.ok) throw new Error(`GET ${CORPUS.url} -> ${response.status}`);
  await Bun.write(path, await response.arrayBuffer());
  const digest = await md5File(path);
  if (digest !== CORPUS.md5) throw new Error(`downloaded extract md5 ${digest} does not match ${CORPUS.md5}`);
  return path;
}

function docker(args: string[], timeoutMs: number): void {
  const result = Bun.spawnSync(["docker", ...args], { stdout: "inherit", stderr: "inherit", timeout: timeoutMs });
  if (result.exitCode !== 0) throw new Error(`docker ${args[0]} ${args[1] ?? ""} failed (exit ${result.exitCode})`);
}

export interface ArchiveStats {
  extract: { file: string; md5: string };
  mbtilesBytes: number;
  pmtilesBytes: number;
  pmtilesMd5: string;
  tools: typeof TOOLS;
}

/**
 * Build both archives if missing. Planetiler runs its OpenMapTiles profile over the pinned extract
 * (it downloads the water polygons and Natural Earth once into data/cache/sources), writing
 * berlin.mbtiles; go-pmtiles converts that into berlin.pmtiles. Neither is rebuilt if present.
 */
export async function ensureArchives(): Promise<ArchiveStats> {
  const extract = await ensureExtract();
  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(join(cacheDir, "sources"), { recursive: true });
  if (!existsSync(MBTILES)) {
    console.log("  building berlin.mbtiles with Planetiler (one-time; downloads about 1 GB of shared sources on the first run)");
    docker(
      [
        "run", "--rm",
        "-e", "JAVA_TOOL_OPTIONS=-Xmx6g",
        "-v", `${cacheDir}:/data`,
        TOOLS.planetiler,
        "--download",
        `--osm-path=/data/${CORPUS.file}`,
        "--output=/data/archives/berlin.mbtiles",
        // Plain `tiles` table: Planetiler's default compact schema (tiles_shallow + tiles_data) is rejected by BBOX 0.6.2's mbtiles crate.
        "--compact_db=false",
        "--force",
      ],
      3_600_000,
    );
  }
  if (!existsSync(PMTILES)) {
    console.log("  converting berlin.mbtiles to berlin.pmtiles with go-pmtiles");
    docker(["run", "--rm", "-v", `${archiveDir}:/archives`, TOOLS.pmtiles, "convert", "/archives/berlin.mbtiles", "/archives/berlin.pmtiles"], 1_800_000);
  }
  const stats: ArchiveStats = {
    extract: { file: CORPUS.file, md5: CORPUS.md5 },
    mbtilesBytes: statSync(MBTILES).size,
    pmtilesBytes: statSync(PMTILES).size,
    pmtilesMd5: await md5File(PMTILES),
    tools: TOOLS,
  };
  console.log(`  archives: berlin.mbtiles ${(stats.mbtilesBytes / 1e6).toFixed(1)} MB, berlin.pmtiles ${(stats.pmtilesBytes / 1e6).toFixed(1)} MB`);
  return stats;
}

if (import.meta.main) {
  await ensureArchives();
}
