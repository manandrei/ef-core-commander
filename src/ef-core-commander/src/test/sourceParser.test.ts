import test from "node:test";
import assert from "node:assert/strict";
import { findDbContextsInSource } from "../sourceParser";
import { EfProject } from "../types";

const project: EfProject = {
  name: "App",
  path: "App.csproj",
  directory: ".",
  sdk: "Microsoft.NET.Sdk.Web",
  outputType: "Exe",
  targetFrameworks: ["net8.0"],
  packageReferences: ["Microsoft.EntityFrameworkCore"],
  hasEfCoreReference: true,
  dbContexts: [],
  migrations: [],
  connectionStrings: []
};

test("detects DbContext classes but excludes design-time factories", () => {
  const contexts = findDbContextsInSource(`
namespace App.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : Microsoft.EntityFrameworkCore.DbContext(options)
{
}

public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
}

public sealed class FailingDbContextFactory(string errorMessage) : IDbContextFactory<AppDbContext>
{
}
`, project);

  assert.deepEqual(contexts.map(context => context.name), ["AppDbContext"]);
});
