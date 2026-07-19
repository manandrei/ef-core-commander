using EfCoreCommander.SqliteTest.Data;
using Microsoft.EntityFrameworkCore;

using var db = new TestDbContext();
db.Database.Migrate();

if (!db.Items.Any())
{
    db.Items.Add(new TestItem
    {
        Name = "Primul element de test",
        CreatedAt = DateTime.UtcNow
    });

    db.SaveChanges();
}

Console.WriteLine($"Database: {Path.GetFullPath("ef-core-commander-test.db")}");
Console.WriteLine($"Items: {db.Items.Count()}");
