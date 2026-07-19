import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { addMariaDbCliDelimiters, processMariaDbCliScript, withTemporarySqlScript } from "../mariaDbCliScript";

test("adds delimiters around a procedure while preserving comments and strings", () => {
  const script = "CREATE PROCEDURE `SyncOrders`()\nBEGIN\n  -- keep this ; comment\n  SELECT 'semi;colon';\nEND;\n";
  assert.equal(
    addMariaDbCliDelimiters(script),
    "DELIMITER $$\n\nCREATE PROCEDURE `SyncOrders`()\nBEGIN\n  -- keep this ; comment\n  SELECT 'semi;colon';\nEND$$\n\nDELIMITER ;\n");
});

test("does not end a routine at a CASE expression or nested procedural block", () => {
  const script = "CREATE PROCEDURE p() BEGIN\n  SET @value = CASE WHEN 1 = 1 THEN 1 ELSE 0 END;\n  IF @value = 1 THEN\n    SELECT 'ok';\n  END IF;\nEND;";
  assert.equal(
    addMariaDbCliDelimiters(script),
    "DELIMITER $$\n\nCREATE PROCEDURE p() BEGIN\n  SET @value = CASE WHEN 1 = 1 THEN 1 ELSE 0 END;\n  IF @value = 1 THEN\n    SELECT 'ok';\n  END IF;\nEND$$\n\nDELIMITER ;");
});

test("closes a routine at END when EF output omits its final semicolon", () => {
  const script = "CREATE PROCEDURE p() BEGIN\n  IF 1 = 1 THEN SELECT 1; END IF;\nEND\n\nDELETE FROM `__EFMigrationsHistory` WHERE `MigrationId` = '20260714192906_NormalizeDocumentNumberCollations';\nCOMMIT;";
  assert.equal(
    addMariaDbCliDelimiters(script),
    "DELIMITER $$\n\nCREATE PROCEDURE p() BEGIN\n  IF 1 = 1 THEN SELECT 1; END IF;\nEND$$\n\nDELIMITER ;\n\nDELETE FROM `__EFMigrationsHistory` WHERE `MigrationId` = '20260714192906_NormalizeDocumentNumberCollations';\nCOMMIT;");
});

test("preserves a label on the outer BEGIN END block", () => {
  const script = "CREATE PROCEDURE p() outer_block: BEGIN SELECT 1; END outer_block;\nSELECT 2;";
  assert.equal(
    addMariaDbCliDelimiters(script),
    "DELIMITER $$\n\nCREATE PROCEDURE p() outer_block: BEGIN SELECT 1; END outer_block$$\n\nDELIMITER ;\nSELECT 2;");
});

test("chooses a delimiter that does not occur in the routine", () => {
  const script = "CREATE PROCEDURE p() BEGIN SELECT '$$'; END;";
  assert.equal(
    addMariaDbCliDelimiters(script),
    "DELIMITER //\n\nCREATE PROCEDURE p() BEGIN SELECT '$$'; END//\n\nDELIMITER ;");
});

test("rejects scripts that already contain delimiter directives", () => {
  assert.throws(
    () => addMariaDbCliDelimiters("DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END//\nDELIMITER ;"),
    /already contains DELIMITER/i);
});

test("fails explicitly when a routine has no detectable end", () => {
  assert.throws(() => addMariaDbCliDelimiters("CREATE PROCEDURE p() BEGIN SELECT 1;"), /Could not determine the end/i);
});

test("does not treat routine keywords in unrelated CREATE statements as routines", () => {
  const script = "CREATE SERVER s FOREIGN DATA WRAPPER mysql OPTIONS (PROCEDURE x);";
  assert.equal(addMariaDbCliDelimiters(script), script);
});

test("adds delimiters for functions, triggers, events and CREATE variants", () => {
  const script = [
    "CREATE OR REPLACE FUNCTION `CountOrders`() RETURNS INT BEGIN RETURN 1; END;",
    "CREATE DEFINER=`app`@`%` TRIGGER `orders_before_insert` BEFORE INSERT ON `Orders` FOR EACH ROW BEGIN SET NEW.`Name` = 'x'; END;",
    "CREATE EVENT `nightly_sync` ON SCHEDULE EVERY 1 DAY DO BEGIN SELECT 1; END;"
  ].join("\n");
  const output = addMariaDbCliDelimiters(script);
  assert.equal((output.match(/DELIMITER \$\$/g) || []).length, 3);
  assert.match(output, /FUNCTION `CountOrders`\(\) RETURNS INT BEGIN RETURN 1; END\$\$/);
  assert.match(output, /TRIGGER `orders_before_insert`[\s\S]*SET NEW\.`Name` = 'x'; END\$\$/);
  assert.match(output, /EVENT `nightly_sync`[\s\S]*SELECT 1; END\$\$/);
});

test("leaves scripts without routines byte-for-byte unchanged and preserves CRLF", () => {
  const script = "CREATE TABLE `Orders` (`Id` int NOT NULL);\r\nINSERT INTO `Orders` VALUES (1);\r\n";
  assert.equal(addMariaDbCliDelimiters(script), script);
});

test("writes a requested output file or returns the compatible script", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-mariadb-test-"));
  const rawPath = path.join(directory, "raw.sql");
  const outputPath = path.join(directory, "final.sql");
  await fs.writeFile(rawPath, "CREATE PROCEDURE p() BEGIN SELECT 1; END;", "utf8");
  try {
    assert.equal(await processMariaDbCliScript(rawPath), "DELIMITER $$\n\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$\n\nDELIMITER ;");
    assert.equal(await processMariaDbCliScript(rawPath, outputPath), undefined);
    assert.match(await fs.readFile(outputPath, "utf8"), /DELIMITER \$\$/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("removes the temporary script directory after success and failure", async () => {
  let successfulPath = "";
  await withTemporarySqlScript(async scriptPath => {
    successfulPath = scriptPath;
    await fs.writeFile(scriptPath, "SELECT 1;", "utf8");
  });
  await assert.rejects(fs.access(successfulPath));

  let failedPath = "";
  await assert.rejects(withTemporarySqlScript(async scriptPath => {
    failedPath = scriptPath;
    throw new Error("expected failure");
  }));
  await assert.rejects(fs.access(failedPath));
});
