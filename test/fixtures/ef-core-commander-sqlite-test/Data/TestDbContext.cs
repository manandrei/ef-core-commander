using Microsoft.EntityFrameworkCore;

namespace EfCoreCommander.SqliteTest.Data;

public sealed class TestDbContext : DbContext
{
    public DbSet<TestItem> Items => Set<TestItem>();

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        optionsBuilder.UseSqlite("Data Source=ef-core-commander-test.db");
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TestItem>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).IsRequired().HasMaxLength(200);
            entity.Property(item => item.CreatedAt).IsRequired();
        });
    }
}
