import type { TileCoord } from "./tiles";

export type Engine = "martin-pmtiles" | "martin-mbtiles" | "go-pmtiles" | "tileserver-gl" | "mbtileserver" | "bbox-pmtiles" | "bbox-mbtiles";

export const ENGINES: readonly Engine[] = ["martin-pmtiles", "martin-mbtiles", "go-pmtiles", "tileserver-gl", "mbtileserver", "bbox-pmtiles", "bbox-mbtiles"];

export type Archive = "pmtiles" | "mbtiles";

export interface EngineMeta {
  id: Engine;
  /** Display name, as it appears on the site. */
  name: string;
  version: string;
  image: string;
  homepage: string;
  color: string;
  /** Which of the two archives (same tiles, different container) the server reads. */
  archive: Archive;
  /** Path of the tile endpoint at z/x/y, relative to the engine's root. */
  tilePath: (tile: TileCoord) => string;
}

/** The tileset id every server publishes; it is the archive's file stem. */
export const TILESET = "berlin";

export const ENGINE_META: Record<Engine, EngineMeta> = {
  "martin-pmtiles": {
    id: "martin-pmtiles",
    name: "Martin (PMTiles)",
    version: "1.16.0",
    image: "ghcr.io/maplibre/martin:1.16.0",
    homepage: "https://martin.maplibre.org",
    color: "#2563EB",
    archive: "pmtiles",
    tilePath: (t) => `/${TILESET}/${t.z}/${t.x}/${t.y}`,
  },
  "martin-mbtiles": {
    id: "martin-mbtiles",
    name: "Martin (MBTiles)",
    version: "1.16.0",
    image: "ghcr.io/maplibre/martin:1.16.0",
    homepage: "https://martin.maplibre.org",
    color: "#60A5FA",
    archive: "mbtiles",
    tilePath: (t) => `/${TILESET}/${t.z}/${t.x}/${t.y}`,
  },
  "go-pmtiles": {
    id: "go-pmtiles",
    name: "go-pmtiles",
    version: "1.31.2",
    image: "protomaps/go-pmtiles:v1.31.2",
    homepage: "https://docs.protomaps.com/deploy/server",
    color: "#16A34A",
    archive: "pmtiles",
    tilePath: (t) => `/${TILESET}/${t.z}/${t.x}/${t.y}.mvt`,
  },
  "tileserver-gl": {
    id: "tileserver-gl",
    name: "tileserver-gl-light",
    version: "5.6.0",
    image: "maptiler/tileserver-gl-light:v5.6.0",
    homepage: "https://tileserver.readthedocs.io",
    color: "#EA580C",
    archive: "mbtiles",
    tilePath: (t) => `/data/${TILESET}/${t.z}/${t.x}/${t.y}.pbf`,
  },
  mbtileserver: {
    id: "mbtileserver",
    name: "mbtileserver",
    version: "0.11.0",
    image: "ats-mbtileserver:0.11.0 (built from the consbio/mbtileserver v0.11.0 release binary)",
    homepage: "https://github.com/consbio/mbtileserver",
    color: "#0891B2",
    archive: "mbtiles",
    tilePath: (t) => `/services/${TILESET}/tiles/${t.z}/${t.x}/${t.y}.pbf`,
  },
  "bbox-pmtiles": {
    id: "bbox-pmtiles",
    name: "BBOX (PMTiles)",
    version: "0.6.2",
    image: "ats-bbox:0.6.2 (built from bbox-services/bbox@v0.6.2)",
    homepage: "https://www.bbox.earth",
    color: "#9333EA",
    archive: "pmtiles",
    tilePath: (t) => `/xyz/${TILESET}/${t.z}/${t.x}/${t.y}.mvt`,
  },
  "bbox-mbtiles": {
    id: "bbox-mbtiles",
    name: "BBOX (MBTiles)",
    version: "0.6.2",
    image: "ats-bbox:0.6.2 (built from bbox-services/bbox@v0.6.2)",
    homepage: "https://www.bbox.earth",
    color: "#C084FC",
    archive: "mbtiles",
    tilePath: (t) => `/xyz/${TILESET}/${t.z}/${t.x}/${t.y}.mvt`,
  },
};

/**
 * Sent with every tile request, to every server. Tiles in both archives are stored gzip-compressed
 * and every map client accepts gzip, so the default request does too: a server can then hand the
 * stored bytes through. The explicit identity variant (no Accept-Encoding) shows what each server
 * does for a client that did not ask for gzip: pass the bytes through anyway, or decompress.
 */
export const TILE_REQUEST_HEADERS: Readonly<Record<string, string>> = { Accept: "application/vnd.mapbox-vector-tile", "Accept-Encoding": "gzip" };

/** Header overrides for the identity variant: an empty value removes the header from the request. */
export const IDENTITY_HEADERS: Readonly<Record<string, string>> = { "Accept-Encoding": "" };

export type TileId = "city-z14" | "district-z12" | "region-z9" | "country-z5";

export interface TileSpec {
  id: TileId;
  tile: TileCoord;
  title: string;
  /** What the tile stands for, for the run file and README. */
  description: string;
}

/**
 * Prenzlauer Berg, Berlin (Helmholtzplatz / Kollwitzplatz): a dense 19th-century block grid; in
 * the OpenMapTiles schema this z14 tile carries buildings, transportation, POIs and more.
 */
const MARQUEE_Z14: TileCoord = { z: 14, x: 8802, y: 5371 };

export const TILES: readonly TileSpec[] = [
  {
    id: "city-z14",
    tile: MARQUEE_Z14,
    title: "Street level z14",
    description: "The densest kind of tile: a 1.5 km Prenzlauer Berg tile with every building, road, POI and landuse polygon of the OpenMapTiles schema.",
  },
  {
    id: "district-z12",
    tile: { z: 12, x: 2200, y: 1342 },
    title: "District z12",
    description: "Inner-city tile covering Prenzlauer Berg and Mitte: roads, landuse, water and place labels, buildings dropped.",
  },
  {
    id: "region-z9",
    tile: { z: 9, x: 275, y: 167 },
    title: "Region z9",
    description: "Low-zoom tile covering most of Berlin: boundaries, major roads, water, place names.",
  },
  {
    id: "country-z5",
    tile: { z: 5, x: 17, y: 10 },
    title: "Overview z5",
    description: "Small tile at the top of the pyramid: the extract's footprint in one tile, mostly boundaries and a few labels.",
  },
];

/**
 * Four adjacent z14 tiles fetched in parallel, as a map view would: the marquee tile and its east,
 * south and south-east neighbours. The archive stops at z14, so the marquee's z15 children would
 * be empty.
 */
export const VIEWPORT: { tiles: TileCoord[] } = {
  tiles: [MARQUEE_Z14, { ...MARQUEE_Z14, x: MARQUEE_Z14.x + 1 }, { ...MARQUEE_Z14, y: MARQUEE_Z14.y + 1 }, { ...MARQUEE_Z14, x: MARQUEE_Z14.x + 1, y: MARQUEE_Z14.y + 1 }],
};

/**
 * The random-walk test: oha picks a fresh z14 tile per request from this central-Berlin range
 * (16 x 16 tiles, every one present in the archive), so no server can win on one hot tile and the
 * archive's index lookups are exercised.
 */
export const WALK = {
  z: 14,
  x: { min: 8794, max: 8809 },
  y: { min: 5366, max: 5381 },
} as const;

export const CONCURRENCY_LEVELS = [10, 100] as const;
export type ConcurrencyLevel = (typeof CONCURRENCY_LEVELS)[number];

export interface Protocol {
  coldStart: { reps: number };
  single: { warmupPasses: number; passes: number; requestsPerPass: number };
  burst: { warmups: number; reps: number };
  concurrency: { levels: readonly ConcurrencyLevel[]; warmupSeconds: number; passes: number; passSeconds: number };
  walk: { connections: number; warmupSeconds: number; passes: number; passSeconds: number };
  requestTimeoutSeconds: number;
}

export function protocol(smoke: boolean): Protocol {
  if (smoke) {
    return {
      coldStart: { reps: 1 },
      single: { warmupPasses: 1, passes: 3, requestsPerPass: 3 },
      burst: { warmups: 1, reps: 3 },
      concurrency: { levels: [10], warmupSeconds: 3, passes: 2, passSeconds: 4 },
      walk: { connections: 10, warmupSeconds: 3, passes: 2, passSeconds: 4 },
      requestTimeoutSeconds: 60,
    };
  }
  return {
    coldStart: { reps: 5 },
    single: { warmupPasses: 3, passes: 20, requestsPerPass: 20 },
    burst: { warmups: 3, reps: 20 },
    concurrency: { levels: CONCURRENCY_LEVELS, warmupSeconds: 10, passes: 8, passSeconds: 12 },
    walk: { connections: 10, warmupSeconds: 10, passes: 8, passSeconds: 12 },
    requestTimeoutSeconds: 60,
  };
}

const ENGINE_HOST = process.env.ENGINE_HOST ?? "127.0.0.1";
const ENGINE_PORT = process.env.ENGINE_PORT ?? "8099";

export function engineBaseUrl(): string {
  return `http://${ENGINE_HOST}:${ENGINE_PORT}`;
}

export function tileUrl(engine: Engine, tile: TileCoord): string {
  return engineBaseUrl() + ENGINE_META[engine].tilePath(tile);
}

/**
 * Every tile of the walk range for one engine, in a fixed shuffled order (deterministic LCG), for
 * oha's --urls-from-file: each request picks one of them at random.
 */
export function walkUrls(engine: Engine): string[] {
  const urls: string[] = [];
  for (let x = WALK.x.min; x <= WALK.x.max; x++) for (let y = WALK.y.min; y <= WALK.y.max; y++) urls.push(tileUrl(engine, { z: WALK.z, x, y }));
  let seed = 20260908;
  for (let i = urls.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [urls[i], urls[j]] = [urls[j]!, urls[i]!];
  }
  return urls;
}

export function composeProject(engine: Engine): string {
  return `ats-${engine}`;
}

export function containerName(engine: Engine): string {
  return `${composeProject(engine)}-engine-1`;
}

export function composeFile(engine: Engine): string {
  return `docker-compose.${engine}.yml`;
}
