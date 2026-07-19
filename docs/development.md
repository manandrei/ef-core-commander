# Development guide

## First setup

```powershell
npm install --prefix src/ef-core-commander
dotnet restore test/fixtures/ef-core-commander-sqlite-test/EfCoreCommander.SqliteTest.csproj
```

Open the repository root in VS Code. For extension development, compile with `npm run compile --prefix src/ef-core-commander` or use the package's watch script.

## Source boundaries

- Keep VS Code extension behavior under `src/ef-core-commander`.
- Keep EF Core test data and migrations under `test/fixtures/ef-core-commander-sqlite-test`.
- Keep connection strings used by tests local and non-secret.
