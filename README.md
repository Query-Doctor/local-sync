# Sync

A tool for dumping the schema of a database with minimal permissions. Used at
https://app.querydoctor.com to keep user databases in sync with the local pglite
instance

You can play around with a hosted version of this tool
https://sync.querydoctor.com/postgres/all?db=postgres://user:password@host:port/database

## Setup

This runs a deno server on port 2345.

- [Install deno](https://docs.deno.com/runtime/getting_started/installation/)
- `deno run dev`

Or if you're a docker type of fella:

- `docker run -t -p 2345:2345 ghcr.io/query-doctor/sync:latest`

## API

OpenAPI spec coming later.

`POST /postgres/all`

```json
{
  "db": "postgres://user:password@host:port/database",
  "schema": "public",
  "maxRows": 15,
  "requiredRows": 5,
  "seed": 0
}
```

<sub>Right now only public schema is supported</sub>
