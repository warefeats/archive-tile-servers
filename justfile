set dotenv-load

check:
    bun run check

test:
    bun test

# Full benchmark: every engine, full protocol. Builds the two archives first if they are missing.
bench *ARGS:
    bun run src/run.ts {{ARGS}}

# Short protocol, every engine.
smoke *ARGS:
    bun run src/run.ts --smoke {{ARGS}}

# Download the pinned Berlin extract, build berlin.mbtiles with Planetiler and convert it to berlin.pmtiles.
archives:
    bun run src/corpus.ts

# Build the two images that have no arm64 release image (BBOX from source, mbtileserver from its release binary).
build-images:
    docker compose --project-directory compose -f compose/docker-compose.bbox-pmtiles.yml -p ats-bbox-pmtiles build
    docker compose --project-directory compose -f compose/docker-compose.mbtileserver.yml -p ats-mbtileserver build

# Stop every engine container this runner may have left behind.
clean:
    #!/usr/bin/env bash
    set -euo pipefail
    for engine in martin-pmtiles martin-mbtiles go-pmtiles tileserver-gl mbtileserver bbox-pmtiles bbox-mbtiles; do
        docker compose --project-directory compose -f "compose/docker-compose.${engine}.yml" -p "ats-${engine}" down --remove-orphans 2>/dev/null || true
    done
    echo "cleaned up all archive-tile-servers containers"

import RESULTS="results.json":
    bun run src/import.ts --results={{RESULTS}}
