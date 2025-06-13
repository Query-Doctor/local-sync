import { assertEquals } from "@std/assert";
import {
  DependencyAnalyzer,
  DatabaseConnector,
  type Hash,
} from "../src/sync/dependency-tree.ts";

function testDb(): DatabaseConnector<{
  data: { [key: string]: any; id: number };
  table: string;
}> {
  const db = {
    users: [{ id: 0 }, { id: 1 }, { id: 2 }],
    posts: [
      { id: 3, poster_id: 0 },
      { id: 4, poster_id: 1 },
    ],
  };
  return {
    async *cursor(table) {
      for (const row of db[table as keyof typeof db]) {
        yield { data: row, table };
      }
    },
    async dependencies() {
      return [
        {
          sourceTable: "posts",
          sourceColumn: ["poster_id"],
          referencedTable: "users",
          referencedColumn: ["id"],
        },
        {
          sourceTable: "users",
          sourceColumn: null,
          referencedTable: null,
          referencedColumn: null,
        },
      ];
    },
    async get(table, values) {
      const found = db[table as keyof typeof db].find((row) => {
        for (const [key, value] of Object.entries(values)) {
          if (row[key as keyof typeof row] !== value) {
            return false;
          }
        }
        return true;
      });
      return found ? { data: found, table } : undefined;
    },
    hash(db) {
      return db.data.id.toString() as Hash;
    },
  };
}

Deno.test(async function addTest() {
  const dbSimple = testDb();
  const da = new DependencyAnalyzer(dbSimple, {
    requiredRows: 2,
    maxRows: 8,
    seed: 0,
  });
  const result = await da.findAllDependencies("public");
  assertEquals(result.kind, "ok");
  if (result.kind === "ok") {
    assertEquals(result.items, {
      posts: [
        { id: 3, poster_id: 0 },
        { id: 4, poster_id: 1 },
      ],
      users: [{ id: 0 }, { id: 1 }],
    });
  }
  // const mockConnector = {
  // }
  // assertEquals(add(2, 3), 5);
});
