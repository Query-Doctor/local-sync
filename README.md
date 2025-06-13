# Sync

A tool for dumping the schema of a database with minimal permissions.
Used at https://app.querydoctor.com to keep user databases in sync with the local pglite instance

You can play around with a hosted version of this tool
https://sync.querydoctor.com/postgres/all?db=postgres://user:password@host:port/database

## Setup

- [Install deno](https://docs.deno.com/runtime/getting_started/installation/)
- `PG_DUMP_BINARY=$(which pg_dump) deno run `
