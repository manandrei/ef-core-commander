import test from "node:test";
import assert from "node:assert/strict";
import { splitArguments } from "../processArgs";

test("splits quoted dotnet ef arguments", () => {
  assert.deepEqual(
    splitArguments('ef migrations add --project "D:\\repo\\Data\\Data.csproj" --context AppDbContext Add_Orders'),
    ["ef", "migrations", "add", "--project", "D:\\repo\\Data\\Data.csproj", "--context", "AppDbContext", "Add_Orders"]);
});
