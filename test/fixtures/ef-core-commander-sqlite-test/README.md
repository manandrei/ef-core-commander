# EF Core Commander SQLite test project

Proiect Console .NET 10 minimal pentru testarea rapidă a extensiei EF Core Commander din VS Code.

## Configurare în extensie

- Migration project: `EfCoreCommander.SqliteTest`
- Startup project: `EfCoreCommander.SqliteTest`
- DbContext: `TestDbContext`
- Target framework: `<Default>`
- Connection: `DefaultConnection` sau conexiunea implicită

## Comenzi locale

Din acest director:

```powershell
dotnet restore
dotnet build
dotnet ef migrations list
dotnet run
```

Comenzi utile pentru testarea extensiei:

```powershell
dotnet ef migrations add AddDescription
dotnet ef migrations remove
dotnet ef migrations script
dotnet ef database update
dotnet ef database drop --force
```

Pentru a testa `Add Migration`, modifică `TestItem` (de exemplu adaugă o proprietate), apoi rulează comanda din extensie. Baza `ef-core-commander-test.db` este creată local și este ignorată de Git.
