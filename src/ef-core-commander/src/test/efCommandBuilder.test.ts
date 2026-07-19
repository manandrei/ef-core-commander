import test from "node:test";
import assert from "node:assert/strict";
import { buildEfCommand, buildMigrationListCommand, buildTargetMigrationItems, normalizeMigrationName } from "../efCommandBuilder";

test("normalizes migration file names", () => {
  assert.equal(
    normalizeMigrationName("20260604120000_BackfillRawMaterialImageUrlFromStoredFiles.cs"),
    "20260604120000_BackfillRawMaterialImageUrlFromStoredFiles");
  assert.equal(
    normalizeMigrationName("20260604120000_BackfillRawMaterialImageUrlFromStoredFiles.Designer.cs"),
    "20260604120000_BackfillRawMaterialImageUrlFromStoredFiles");
  assert.equal(normalizeMigrationName("0"), "0");
  assert.equal(normalizeMigrationName("   "), "");
});

test("builds target migrations with initial database sentinel", () => {
  assert.deepEqual(
    buildTargetMigrationItems(["20240601000000_Initial", "20240602000000_AddOrders"]),
    ["20240602000000_AddOrders", "20240601000000_Initial", "0"]);
});

test("builds add migration command", () => {
  const command = buildEfCommand({
    operation: "addMigration",
    migrationProjectPath: "D:\\repo\\Data\\Data.csproj",
    startupProjectPath: "D:\\repo\\Web\\Web.csproj",
    dbContextName: "AppDbContext",
    buildConfiguration: "Debug",
    noBuild: false,
    targetFramework: "net8.0",
    creationMethod: "StartupProject",
    migrationName: "Add Orders",
    outputDir: "Migrations",
    additionalArgs: "--verbose"
  });

  assert.equal(
    command,
    'ef migrations add --project "D:\\repo\\Data\\Data.csproj" --startup-project "D:\\repo\\Web\\Web.csproj" --context AppDbContext --configuration Debug --framework net8.0 Add_Orders --output-dir "Migrations" --verbose');
});

test("builds script command without cs suffixes", () => {
  const command = buildEfCommand({
    operation: "generateSqlScript",
    migrationProjectPath: "Data.csproj",
    startupProjectPath: "Web.csproj",
    dbContextName: "AppDbContext",
    buildConfiguration: "Release",
    noBuild: true,
    creationMethod: "StartupProject",
    fromMigration: "20240601000000_Initial.cs",
    toMigration: "20240602000000_AddOrders.Designer.cs",
    scriptOutput: "migration.sql",
    idempotent: true,
    noTransactions: true
  });

  assert.equal(
    command,
    'ef migrations script --project "Data.csproj" --startup-project "Web.csproj" --context AppDbContext --configuration Release --no-build 20240601000000_Initial 20240602000000_AddOrders --output "migration.sql" --idempotent --no-transactions');
});

test("builds update database command with explicit connection", () => {
  const command = buildEfCommand({
    operation: "updateDatabase",
    migrationProjectPath: "Data.csproj",
    startupProjectPath: "Web.csproj",
    dbContextName: "AppDbContext",
    buildConfiguration: "Debug",
    noBuild: false,
    creationMethod: "StartupProject",
    toMigration: "0",
    useDefaultConnection: false,
    connection: "Server=.;Database=App;"
  });

  assert.equal(
    command,
    'ef database update --project "Data.csproj" --startup-project "Web.csproj" --context AppDbContext --configuration Debug 0 --connection "Server=.;Database=App;"');
});

test("builds migration list command with the default connection", () => {
  assert.equal(
    buildMigrationListCommand({
      operation: "updateDatabase",
      migrationProjectPath: "Data.csproj",
      startupProjectPath: "Web.csproj",
      dbContextName: "AppDbContext",
      buildConfiguration: "Debug",
      noBuild: false,
      creationMethod: "StartupProject",
      useDefaultConnection: true
    }),
    'ef migrations list --project "Data.csproj" --startup-project "Web.csproj" --context AppDbContext --configuration Debug --json --no-color');
});

test("builds migration list command with an explicit connection", () => {
  assert.equal(
    buildMigrationListCommand({
      operation: "updateDatabase",
      migrationProjectPath: "Data.csproj",
      dbContextName: "AppDbContext",
      buildConfiguration: "Release",
      noBuild: true,
      creationMethod: "DesignTimeFactory",
      useDefaultConnection: false,
      connection: "Server=.;Database=App;"
    }),
    'ef migrations list --project "Data.csproj" --context AppDbContext --configuration Release --no-build --connection "Server=.;Database=App;" --json --no-color');
});

test("preserves whitespace inside quoted command arguments", () => {
  const command = buildEfCommand({
    operation: "updateDatabase",
    migrationProjectPath: "D:\\Project  Files\\Data.csproj",
    dbContextName: "AppDbContext",
    buildConfiguration: "Debug",
    noBuild: false,
    creationMethod: "DesignTimeFactory",
    useDefaultConnection: false,
    connection: "Server=db;Password=secret  value;"
  });
  assert.match(command, /"D:\\Project  Files\\Data\.csproj"/);
  assert.match(command, /Password=secret  value/);
});
