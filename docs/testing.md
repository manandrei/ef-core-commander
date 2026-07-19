# Testing guide

## Automated checks

Run from the repository root:

```powershell
npm test
dotnet list test/fixtures/ef-core-commander-sqlite-test/EfCoreCommander.SqliteTest.csproj package --vulnerable --include-transitive
```

The extension test suite compiles TypeScript and runs the Node test files under `src/ef-core-commander/src/test`.

## Manual extension checks

Open the repository root in VS Code, refresh EF Core Commander and select:

- migration project: `EfCoreCommander.SqliteTest`;
- startup project: `EfCoreCommander.SqliteTest`;
- DbContext: `TestDbContext`;
- target framework: `<Default>`.

Verify migration listing, Add/Remove Migration, Generate SQL Script, Update Database, Drop Database, execution output and Last result restoration.
