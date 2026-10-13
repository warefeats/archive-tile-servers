# Martin vs go-pmtiles vs tileserver-gl vs mbtileserver vs BBOX — serving a pre-built tile archive

The runner behind [warefeats.com/posts/2026-09-08-archive-tile-servers-martin-vs-go-pmtiles-vs-tileserver-gl-vs-mbtileserver-vs-bbox/](https://warefeats.com/posts/2026-09-08-archive-tile-servers-martin-vs-go-pmtiles-vs-tileserver-gl-vs-mbtileserver-vs-bbox/). Five open-source tile servers serve one pre-built vector tile archive of Berlin, stored once as MBTiles and once as PMTiles with byte-identical tiles, and this runner measures single-tile latency at four zoom levels, throughput under 10 and 100 concurrent clients on one tile, throughput over a 256-tile random walk, four-tile viewport bursts, time to first tile after a cold start, and resident memory. Part of the [warefeats](https://warefeats.com) benchmark suite and the sibling of [vector-tile-servers](https://github.com/warefeats/vector-tile-servers), which measures the same kind of servers generating tiles from PostGIS instead.

## Why this matrix

Most self-hosted vector basemaps are not generated per request: a build tool cuts the whole pyramid once into an archive and a small server hands the tiles out. The choice is then which archive format and which server. This benchmark holds everything else constant: one Planetiler build of one pinned OpenStreetMap extract, converted losslessly between the two formats, one server container at a time with the same CPU and memory budget, and the same request bytes to each. Two servers read both formats and appear twice (Martin, BBOX); go-pmtiles reads only PMTiles; tileserver-gl and mbtileserver are measured on MBTiles.

## Servers

| Candidate | Version | Image | Language | Archive | Tile URL used |
|-----------|---------|-------|----------|---------|---------------|
| Martin (PMTiles) | 1.16.0 | `ghcr.io/maplibre/martin:1.16.0` | Rust | PMTiles | `/berlin/{z}/{x}/{y}` |
| Martin (MBTiles) | 1.16.0 | `ghcr.io/maplibre/martin:1.16.0` | Rust | MBTiles | `/berlin/{z}/{x}/{y}` |
| go-pmtiles | 1.31.2 | `protomaps/go-pmtiles:v1.31.2` | Go | PMTiles | `/berlin/{z}/{x}/{y}.mvt` |
| tileserver-gl-light | 5.6.0 | `maptiler/tileserver-gl-light:v5.6.0` | Node.js | MBTiles | `/data/berlin/{z}/{x}/{y}.pbf` |
| mbtileserver | 0.11.0 | `ats-mbtileserver:0.11.0`, the project's `linux_arm64` release binary packaged by `Dockerfile.mbtileserver` | Go | MBTiles | `/services/berlin/tiles/{z}/{x}/{y}.pbf` |
| BBOX (PMTiles) | 0.6.2 | `ats-bbox:0.6.2`, built from [bbox-services/bbox@v0.6.2](https://github.com/bbox-services/bbox/tree/v0.6.2) by `Dockerfile.bbox` | Rust | PMTiles | `/xyz/berlin/{z}/{x}/{y}.mvt` |
| BBOX (MBTiles) | 0.6.2 | same | Rust | MBTiles | `/xyz/berlin/{z}/{x}/{y}.mvt` |

tileserver-gl is measured as its `-light` image, which serves data and styles but has no MapLibre Native and cannot rasterise; server-side raster rendering is a different workload and is out of scope here. mbtileserver publishes no arm64 image, so the release binary is packaged on `debian:bookworm-slim` (it links glibc). BBOX is built from source because its only published image is amd64-only; the build is the `bbox-tile-server` crate at `v0.6.2` with `--locked`, no map-server or asset-server features, on `rust:1.83.0-bookworm`.

The benchmark page shows each candidate by name and brand colour, not by logo, the same line the other tile-server page drew: none of the projects publishes a trademark policy that licenses its mark for third-party use.

## Corpus

The [Geofabrik Berlin extract of 2026-01-01](https://download.geofabrik.de/europe/germany/berlin-260101.osm.pbf), MD5 `6d6de8da2d8192c5bbe7dd00e1004c82` (Geofabrik's published checksum), the same file the PostGIS benchmark imports. The runner downloads it into `data/cache/` and refuses to use a file whose MD5 differs.

[Planetiler](https://github.com/onthegomap/planetiler) 0.10.2 (`ghcr.io/onthegomap/planetiler:0.10.2`) builds the archive with its OpenMapTiles profile, zoom 0 to 14, `--compact_db=false` so the MBTiles has a plain `tiles` table (BBOX 0.6.2 rejects Planetiler's default compact schema). Planetiler downloads the water polygons, Natural Earth and lake centrelines it needs into `data/cache/sources/` once. go-pmtiles then converts `berlin.mbtiles` into `berlin.pmtiles`; the conversion copies tile bytes, so both archives hold the same gzip-compressed tiles, and every server's decoded feature counts in the parity table match.

| Archive | Size | Tiles | Compression |
|---------|-----:|------:|-------------|
| `berlin.mbtiles` | 40.9 MB | see the run file | gzip |
| `berlin.pmtiles` | 40.2 MB | same | gzip |

Map data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). Water polygons from [OSMData](https://osmdata.openstreetmap.de/); Natural Earth is public domain; the OpenMapTiles schema is CC-BY 4.0.

## Tiles

All coordinates are WebMercatorQuad (XYZ). The z14 tile is Prenzlauer Berg around Helmholtzplatz, a dense 19th-century block grid; in the OpenMapTiles schema it carries twelve layers.

| Test tile | z/x/y | What is in it |
|-----------|-------|---------------|
| Street level z14 (the marquee tile) | 14/8802/5371 | 8,031 features in 12 layers: buildings, transportation, POIs, landuse, place names; 415,808 bytes decoded, 242,407 gzipped |
| District z12 | 12/2200/1342 | 2,541 features in 11 layers, buildings dropped |
| Region z9 | 9/275/167 | 292 features in 10 layers: boundaries, major roads, water, place names |
| Overview z5 | 5/17/10 | 8 features in 6 layers |
| Viewport | 14/8802/5371, 14/8803/5371, 14/8802/5372, 14/8803/5372 | the marquee tile and its east, south and south-east neighbours, requested in parallel |
| Random walk | z14, x 8794–8809, y 5366–5381 | 256 tiles of central Berlin, every one present in the archive; the load generator picks one per request |

## Fairness configuration

| Setting | Martin | go-pmtiles | tileserver-gl-light | mbtileserver | BBOX |
|---------|--------|------------|---------------------|--------------|------|
| Container | 4 CPUs, 4 GB | same | same | same | same |
| Workers | `worker_processes: 4` | Go runtime, 4 CPUs | single Node.js process (default) | Go runtime, 4 CPUs | `worker_threads = 4` |
| Tile cache | `cache: disable` | default 64 MB directory cache (`--cache-size=64`) | none | none | none configured |
| Endpoints | tiles only via config | tiles + TileJSON (default) | `--config` with one data source, no styles | `--tiles-only` | tiles + TileJSON (default) |
| Compression | stored gzip passed through when the client accepts it, decompressed otherwise | stored gzip passed through with `Content-Encoding: gzip`, always | stored tile gunzipped and re-gzipped on every request, `Content-Encoding: gzip`, always | stored gzip passed through with `Content-Encoding: gzip`, always | stored gzip passed through when the client accepts it, decompressed otherwise |

The compression row is the one behaviour no configuration aligns, so the request is chosen to make it moot where it can be: every request sends `Accept: application/vnd.mapbox-vector-tile` and `Accept-Encoding: gzip`, as every browser and MapLibre client does, so a server can pass the stored bytes through. One extra single-client pass on the marquee tile sends no `Accept-Encoding` at all; that is where Martin and BBOX decompress the tile per request (415,808 bytes out instead of 242,407) while go-pmtiles, mbtileserver and tileserver-gl send gzip regardless, and the parity table records what each server sent in each case. go-pmtiles' directory cache is its normal operating mode and caches directory entries, not tiles, so it stays on.

## Methodology

One engine container runs at a time with both archives bind-mounted read-only. The load generator (`oha` 1.16.0) and the runner (Bun) run on the host and reach the engine through its published port. Per engine, in order:

1. **Cold start.** `docker compose up` from a stopped state, then poll the marquee tile every 50 ms. The sample is the time from Docker's `StartedAt` (process start) to the first `200`, so image pulls and compose overhead are excluded and opening the archive is included. 5 repetitions; the engine stays up after the last. Idle RSS is read from `docker stats` five seconds later.
2. **Parity.** Each test tile is fetched once, decoded, and its byte size, content encoding, layer names and feature counts recorded, together with what the server sends to a client without `Accept-Encoding`.
3. **Single-tile latency.** For each test tile, one connection, 3 warmup passes then 20 measured passes of 20 sequential requests. The sample is the mean latency of a pass. Then the same for the marquee tile without `Accept-Encoding`.
4. **Viewport burst.** The four z14 tiles of the viewport requested at once over four connections; 3 warmups then 20 repetitions. The sample is the wall time until the last tile lands.
5. **Concurrency.** Closed-loop load on the marquee tile at 10 and then 100 connections: one 10-second warmup pass, then 8 measured passes of 12 seconds. Samples are each pass's successful requests per second and each pass's p99 latency. Requests still in flight when a pass ends are not counted as errors; non-2xx responses, connection errors and 60-second timeouts are.
6. **Random walk.** 10 connections, each request a random tile from the 256-tile list (`oha --urls-from-file`); one 10-second warmup, then 8 passes of 12 seconds.
7. **Memory after load.** `docker stats` RSS right after the walk.

The published run file carries every sample. `just smoke` runs a short version of the same protocol.

## Running it

Requires Docker, Bun, [oha](https://github.com/hatoo/oha) and [just](https://github.com/casey/just).

```sh
just archives      # download the extract, build berlin.mbtiles with Planetiler, convert to berlin.pmtiles
just build-images  # BBOX from source, mbtileserver from its release binary
just smoke         # short protocol, every engine
just bench         # full protocol; results.json
just import        # results.json -> runs/<date>-<rig>.json, appended to benchmark.json
```

`just bench --engine=go-pmtiles,martin-pmtiles` restricts the run; `--resume` skips engines already in `results.json`.

## Results

See `runs/` for the published run files and the [post](https://warefeats.com/posts/2026-09-08-archive-tile-servers-martin-vs-go-pmtiles-vs-tileserver-gl-vs-mbtileserver-vs-bbox/) for charts and the verdict.

### Run 2026-09-08, M2 Max (local)

Full protocol on the reference rig; the run file is [`runs/2026-09-08-m2-max.json`](runs/2026-09-08-m2-max.json). Verdict and limitations are in [`benchmark.json`](benchmark.json). Every request accepts gzip.

| Candidate | Street level z14, 1 client (mean) | Tiles/s at 10 clients | Tiles/s at 100 clients | p99 at 100 clients | Random walk, tiles/s at 10 clients | Viewport, 4 tiles (mean) | First tile after start (mean of 5) | RSS idle / after load |
|-----------|----------------------------------:|----------------------:|-----------------------:|-------------------:|-----------------------------------:|-------------------------:|-----------------------------------:|----------------------:|
| Martin 1.16.0 (PMTiles) | 1.23 ms | 11,289 | 12,634 | 203 ms | 12,993 | 1.2 ms | 158 ms | 9 / 168 MB |
| Martin 1.16.0 (MBTiles) | 1.17 ms | 11,145 | 9,185 | 14 ms | 13,724 | 1.2 ms | 153 ms | 10 / 63 MB |
| go-pmtiles 1.31.2 | 1.98 ms | 2,472 | 4,514 | 109 ms | 4,533 | 1.9 ms | 157 ms | 13 / 44 MB |
| tileserver-gl-light 5.6.0 | 14.30 ms | 301 | 281 | 449 ms | 793 | 18.7 ms | 276 ms | 46 / 309 MB |
| mbtileserver 0.11.0 | 1.15 ms | 5,908 | 7,857 | 34 ms | 7,110 | 2.2 ms | 137 ms | 6 / 66 MB |
| BBOX 0.6.2 (PMTiles) | 2.33 ms | 3,885 | 3,961 | 31 ms | 8,292 | 1.9 ms | 118 ms | 11 / 35 MB |
| BBOX 0.6.2 (MBTiles) | 2.75 ms | 3,509 | 2,202 | 65 ms | 6,503 | 2.6 ms | 150 ms | 11 / 69 MB |

District z12, region z9 and overview z5 tiles at one client: mbtileserver 0.92 / 0.84 / 0.72 ms, Martin (MBTiles) 0.82 / 0.84 / 0.88 ms, Martin (PMTiles) 1.09 / 0.98 / 0.96 ms, BBOX (PMTiles) 1.38 / 1.05 / 0.58 ms, BBOX (MBTiles) 1.41 / 1.01 / 0.57 ms, go-pmtiles 1.40 / 1.05 / 0.79 ms, tileserver-gl-light 3.59 / 2.75 / 1.63 ms. No candidate failed a request in any pass.

Two things the table shows that the verdict leans on. First, the format matters less than the server: Martin's two sources are 0.06 ms apart on one tile, BBOX's 0.4 ms, and both move more tiles from PMTiles than from MBTiles under load (Martin 12,634 vs 9,185 at 100 clients, BBOX 3,961 vs 2,202), so on this rig a local PMTiles file is at least as fast as a local MBTiles file for the servers that read both. Second, what a server does for a client that sends no `Accept-Encoding` is a behaviour, not a score, and this benchmark does not rank it: Martin and BBOX honour the missing header and decompress the stored tile (the marquee tile then takes 2.9 ms on Martin and 9 to 10 ms on BBOX instead of 1.2 and 2.3 to 2.8 ms), while go-pmtiles, mbtileserver and tileserver-gl send `Content-Encoding: gzip` regardless. That pass is recorded in the run file's parity data and per-candidate metrics so the behaviour is on record, and it feeds no ranked test. A first full run that sent no Accept-Encoding on every request would have charged Martin and BBOX for behaving correctly; it was discarded.

### Parity

What each server returned for the test tiles with `Accept-Encoding: gzip`: transferred bytes / decoded features. All seven candidates returned the same feature counts and layers for every tile; tileserver-gl's bytes differ because it re-compresses. The last column is the behaviour described above, on record and unranked.

| Candidate | Street level z14 | District z12 | Region z9 | Overview z5 | Content-Encoding | Same tile, no Accept-Encoding |
|-----------|-----------------:|-------------:|----------:|------------:|------------------|------------------------------:|
| Martin (PMTiles) | 242,407 / 8,031 | 76,490 / 2,541 | 38,506 / 292 | 3,972 / 8 | gzip | 415,808 B, decompressed |
| Martin (MBTiles) | 242,407 / 8,031 | 76,490 / 2,541 | 38,506 / 292 | 3,972 / 8 | gzip | 415,808 B, decompressed |
| go-pmtiles | 242,407 / 8,031 | 76,490 / 2,541 | 38,506 / 292 | 3,972 / 8 | gzip | 242,407 B, still gzip |
| tileserver-gl-light | 243,510 / 8,031 | 76,765 / 2,541 | 38,076 / 292 | 3,957 / 8 | gzip (re-compressed) | 243,510 B, still gzip |
| mbtileserver | 242,407 / 8,031 | 76,490 / 2,541 | 38,506 / 292 | 3,972 / 8 | gzip | 242,407 B, still gzip |
| BBOX (PMTiles) | 242,407 / 8,031 | 76,490 / 2,541 | 38,506 / 292 | 3,972 / 8 | gzip, no Content-Type | 415,808 B, decompressed |
| BBOX (MBTiles) | 242,407 / 8,031 | 76,490 / 2,541 | 38,506 / 292 | 3,972 / 8 | gzip | 415,808 B, decompressed |

The street-level tile carries 12 OpenMapTiles layers; the district tile 11, the region tile 10, the overview tile 6.
