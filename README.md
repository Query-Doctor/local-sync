# Query Doctor Local Sync

This is a helper application to be used by https://querydoctor.com's Index Ray. It is meant to be ran locally. 

It is used to extract metadata from a local PostgresSQL database.

We retrieve:
- SQL commands for enum types
- SQL commands for tables and indexes
- sample data (trimmed to 10 rows)
- statistics

## Usage

You don't need to install this package locally. You can run it directly using `npx`::

```bash
npx query-doctor-local-sync
```

This will start the application on port 7777 by default.

## Options

- `--port` or `-p`: Specify the port to run the application (default: 7777)
- `--help` or `-h`: Display help information

Example:

```bash
npx query-doctor-local-sync --port 8080
```

## Prerequisites

Ensure you have Node.js installed on your machine. You can check this by running:

```bash
node -v
```

If you don't have Node.js installed, you can download it from [nodejs.org](https://nodejs.org/). Alternatively, you can use a version manager like [nvm](https://github.com/nvm-sh/nvm) or [nvm for windows](https://github.com/coreybutler/nvm-windows).
