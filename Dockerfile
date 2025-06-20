FROM denoland/deno:alpine AS builder

WORKDIR /app
COPY deno.json deno.lock .
RUN deno install --frozen
COPY . .
RUN deno compile \
    --allow-env \
    --allow-net \
    --allow-read=/usr/bin/pg_dump \
    --allow-run \
    --deny-sys \
    -o sync main.ts

FROM denoland/deno:alpine AS runner

WORKDIR /app

# Install PostgreSQL client
RUN apk add --no-cache postgresql-client

ENV PG_DUMP_BINARY=/usr/bin/pg_dump
# bind to all interfaces
ENV HOST=0.0.0.0
# COPY bin ./bin
COPY --from=builder /app/sync /app/sync

USER deno
EXPOSE 2345

CMD ["/app/sync"]
