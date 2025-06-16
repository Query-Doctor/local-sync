FROM denoland/deno:latest

WORKDIR /app
COPY deno.json deno.lock .
RUN deno install --frozen
COPY . .
RUN deno compile --allow-env --allow-run --allow-net --allow-read --deny-sys -o sync main.ts

FROM debian:12-slim

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y wget lsb-release gnupg2 postgresql-client-common

# Add PostgreSQL repository
RUN sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list' \
    && wget -qO - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -

# Install pg_dump for PostgreSQL 17
RUN apt-get update && apt-get install -y \
    postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*
ENV PG_DUMP_BINARY=/bin/pg_dump
COPY bin ./bin
COPY --from=0 /app/sync /app/sync

CMD ["/app/sync"]
