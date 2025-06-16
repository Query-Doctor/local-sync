import postgres from "postgres";
import { PostgresSyncer } from "../src/sync/syncer.ts";
import { assertEquals } from "@std/assert";

const TESTING_SETUP = `
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  user_id INT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT INTO users (name) VALUES ('John Doe');
INSERT INTO users (name) VALUES ('Jane Doe');

INSERT INTO posts (title, user_id) VALUES ('Hello World', 1);
INSERT INTO posts (title, user_id) VALUES ('Hello World 2', 2);
`;

const fixture16 = Deno.readTextFileSync("./test/fixtures/pg-16.dump.txt");
const fixture17 = Deno.readTextFileSync("./test/fixtures/pg-17.dump.txt");

Deno.test("postgres integration", async () => {
  const PG_16_URL = Deno.env.get("PG_16");
  const PG_17_URL = Deno.env.get("PG_17");
  if (!PG_16_URL || !PG_17_URL) {
    throw new Error("PG_16_URL or PG_17_URL is not set");
  }
  const randomDatabaseName = `test_${Math.random()
    .toString(36)
    .substring(2, 15)}`;
  let db16 = postgres(PG_16_URL);
  let db17 = postgres(PG_17_URL);

  console.log(`running tests on ${randomDatabaseName}`);

  try {
    await db16.unsafe(`DROP DATABASE IF EXISTS ${randomDatabaseName};`).raw();
    await db16.unsafe(`CREATE DATABASE ${randomDatabaseName}`).raw();
    await db17.unsafe(`DROP DATABASE IF EXISTS ${randomDatabaseName};`).raw();
    await db17.unsafe(`CREATE DATABASE ${randomDatabaseName}`).raw();
    await db16.end();
    await db17.end();
    const db16Url = PG_16_URL.replace(/\/[^\/]+$/, `/${randomDatabaseName}`);
    const db17Url = PG_17_URL.replace(/\/[^\/]+$/, `/${randomDatabaseName}`);
    db16 = postgres(db16Url);
    db17 = postgres(db17Url);
    await db16.unsafe(TESTING_SETUP);
    await db17.unsafe(TESTING_SETUP);

    const sync = new PostgresSyncer();
    const [result16, result17] = await Promise.all([
      sync.syncWithUrl(new URL(db16Url), "public", {
        seed: 0,
        maxRows: 10,
        requiredRows: 2,
      }),
      sync.syncWithUrl(new URL(db17Url), "public", {
        seed: 0,
        maxRows: 10,
        requiredRows: 2,
      }),
    ]);
    for (const { result, fixture } of [
      { result: result16, fixture: fixture16 },
      { result: result17, fixture: fixture17 },
    ]) {
      if (result.kind !== "ok") {
        console.log(result);
        throw new Error("Sync failed");
      }
      console.log(result.setup);
      assertEquals(result.setup, fixture);
    }
  } catch (err) {
    console.error(err);
    throw err;
  } finally {
    await db16.end({ timeout: 5 });
    await db17.end({ timeout: 5 });
    db16 = postgres(PG_16_URL);
    db17 = postgres(PG_17_URL);
    await db16.unsafe(`DROP DATABASE IF EXISTS ${randomDatabaseName};`).raw();
    await db17.unsafe(`DROP DATABASE IF EXISTS ${randomDatabaseName};`).raw();
    await db16.end();
    await db17.end();
  }
});
