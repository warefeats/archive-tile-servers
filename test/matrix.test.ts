import { describe, expect, test } from "bun:test";
import { ENGINES, ENGINE_META, TILES, TILE_REQUEST_HEADERS, VIEWPORT, WALK, containerName, protocol, tileUrl, walkUrls } from "../src/matrix";

describe("engine matrix", () => {
  test("every engine has display metadata and a distinct colour", () => {
    const colours = new Set<string>();
    for (const engine of ENGINES) {
      const meta = ENGINE_META[engine];
      expect(meta.id).toBe(engine);
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.version.length).toBeGreaterThan(0);
      expect(meta.image.length).toBeGreaterThan(0);
      expect(["pmtiles", "mbtiles"]).toContain(meta.archive);
      colours.add(meta.color);
    }
    expect(colours.size).toBe(ENGINES.length);
  });

  test("builds each server's tile URL for the same z/x/y", () => {
    const tile = { z: 14, x: 8802, y: 5373 };
    expect(tileUrl("martin-pmtiles", tile)).toBe("http://127.0.0.1:8099/berlin/14/8802/5373");
    expect(tileUrl("martin-mbtiles", tile)).toBe(tileUrl("martin-pmtiles", tile));
    expect(tileUrl("go-pmtiles", tile)).toBe("http://127.0.0.1:8099/berlin/14/8802/5373.mvt");
    expect(tileUrl("tileserver-gl", tile)).toBe("http://127.0.0.1:8099/data/berlin/14/8802/5373.pbf");
    expect(tileUrl("mbtileserver", tile)).toBe("http://127.0.0.1:8099/services/berlin/tiles/14/8802/5373.pbf");
    expect(tileUrl("bbox-pmtiles", tile)).toBe("http://127.0.0.1:8099/xyz/berlin/14/8802/5373.mvt");
    expect(tileUrl("bbox-mbtiles", tile)).toBe(tileUrl("bbox-pmtiles", tile));
    expect(TILE_REQUEST_HEADERS["Accept"]).toBe("application/vnd.mapbox-vector-tile");
  });

  test("the viewport is the marquee tile's four children", () => {
    const marquee = TILES[0]!;
    expect(VIEWPORT.tiles).toHaveLength(4);
    for (const child of VIEWPORT.tiles) {
      expect(child.z).toBe(marquee.tile.z + 1);
      expect(Math.floor(child.x / 2)).toBe(marquee.tile.x);
      expect(Math.floor(child.y / 2)).toBe(marquee.tile.y);
    }
  });

  test("the walk covers every tile of its block once, in a fixed order, and contains the marquee", () => {
    const urls = walkUrls("go-pmtiles");
    const expected = (WALK.x.max - WALK.x.min + 1) * (WALK.y.max - WALK.y.min + 1);
    expect(urls).toHaveLength(expected);
    expect(new Set(urls).size).toBe(expected);
    expect(urls).toContain(tileUrl("go-pmtiles", TILES[0]!.tile));
    expect(walkUrls("go-pmtiles")).toEqual(urls);
    expect(urls[0]).not.toBe(tileUrl("go-pmtiles", { z: WALK.z, x: WALK.x.min, y: WALK.y.min }));
  });

  test("the smoke protocol is strictly shorter than the full one", () => {
    const smoke = protocol(true);
    const full = protocol(false);
    expect(smoke.coldStart.reps).toBeLessThan(full.coldStart.reps);
    expect(smoke.single.passes).toBeLessThan(full.single.passes);
    expect(smoke.burst.reps).toBeLessThan(full.burst.reps);
    expect(smoke.concurrency.levels.length).toBeLessThan(full.concurrency.levels.length);
    expect(smoke.walk.passes).toBeLessThan(full.walk.passes);
    expect(full.concurrency.levels).toEqual([10, 100]);
    expect(full.requestTimeoutSeconds).toBe(60);
  });

  test("names compose containers per engine", () => {
    expect(containerName("tileserver-gl")).toBe("ats-tileserver-gl-engine-1");
  });
});
