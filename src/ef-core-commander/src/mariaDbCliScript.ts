import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { atomicWriteFile } from "./fileStorage";

type SqlToken = {
  end: number;
  start: number;
  type: "word" | "semicolon" | "other" | "eof";
  value?: string;
};

type RoutineTerminator = {
  statementEnd: number;
  resumeAt: number;
};

const routineKinds = new Set(["PROCEDURE", "FUNCTION", "TRIGGER", "EVENT"]);
const nonBlockEndKinds = new Set(["IF", "CASE", "LOOP", "WHILE", "REPEAT"]);
const statementStarters = new Set(["ALTER", "CALL", "COMMIT", "CREATE", "DELETE", "DROP", "INSERT", "REPLACE", "ROLLBACK", "SELECT", "SET", "START", "TRUNCATE", "UPDATE"]);

/** Converts EF-generated routine DDL into syntax accepted by the mariadb/mysql CLI. */
export function addMariaDbCliDelimiters(script: string): string {
  if (containsDelimiterDirective(script)) {
    throw new Error("The SQL script already contains DELIMITER directives and cannot be safely post-processed.");
  }
  const newline = script.includes("\r\n") ? "\r\n" : "\n";
  let result = "";
  let copiedThrough = 0;
  let position = 0;

  while (position < script.length) {
    const token = nextToken(script, position);
    if (token.type === "eof") {
      break;
    }

    position = token.end;
    if (token.type !== "word" || token.value !== "CREATE") {
      continue;
    }

    const kind = findRoutineKind(script, token.end);
    if (!kind) {
      continue;
    }

    const terminator = findRoutineTerminator(script, kind.afterKind);
    if (terminator === undefined) {
      throw new Error(`Could not determine the end of the ${kind.kind.toLowerCase()} statement at offset ${token.start}.`);
    }

    const statement = script.slice(token.start, terminator.statementEnd);
    const delimiter = chooseDelimiter(statement);

    result += script.slice(copiedThrough, token.start);
    result += `DELIMITER ${delimiter}${newline}${newline}`;
    result += statement;
    result += `${delimiter}${newline}${newline}DELIMITER ;`;
    copiedThrough = terminator.resumeAt;
    position = copiedThrough;
  }

  return copiedThrough === 0 ? script : result + script.slice(copiedThrough);
}

export async function processMariaDbCliScript(rawScriptPath: string, outputPath?: string): Promise<string | undefined> {
  const rawScript = await fs.readFile(rawScriptPath, "utf8");
  const compatibleScript = addMariaDbCliDelimiters(rawScript);

  if (outputPath) {
    await atomicWriteFile(outputPath, compatibleScript);
    return undefined;
  }

  return compatibleScript;
}

export async function withTemporarySqlScript<T>(action: (scriptPath: string) => Promise<T>): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-mariadb-"));
  const scriptPath = path.join(directory, "migration.sql");
  try {
    return await action(scriptPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function findRoutineKind(script: string, position: number): { afterKind: number; kind: string } | undefined {
  let cursor = position;
  let inDefiner = false;
  while (cursor < script.length) {
    const token = nextToken(script, cursor);
    cursor = token.end;
    if (token.type === "eof" || token.type === "semicolon") {
      return undefined;
    }
    if (token.type === "word" && routineKinds.has(token.value!)) {
      return { afterKind: token.end, kind: token.value! };
    }
    if (token.type === "word" && token.value === "DEFINER") {
      inDefiner = true;
      continue;
    }
    if (token.type === "word" && !inDefiner && !["OR", "REPLACE"].includes(token.value!)) {
      return undefined;
    }
  }
  return undefined;
}

function findRoutineTerminator(script: string, position: number): RoutineTerminator | undefined {
  let cursor = position;
  let blockDepth = 0;
  let caseDepth = 0;
  let sawBlock = false;

  while (cursor < script.length) {
    const token = nextToken(script, cursor);
    cursor = token.end;
    if (token.type === "eof") {
      return undefined;
    }
    if (token.type === "word" && token.value === "BEGIN") {
      blockDepth++;
      sawBlock = true;
      continue;
    }
    if (token.type === "word" && token.value === "CASE") {
      caseDepth++;
      continue;
    }
    if (token.type === "word" && token.value === "END" && blockDepth > 0) {
      const following = nextToken(script, token.end);
      if (following.type === "word" && following.value === "CASE") {
        caseDepth = Math.max(0, caseDepth - 1);
        cursor = following.end;
        continue;
      }
      if (caseDepth > 0) {
        caseDepth--;
        continue;
      }
      if (following.type !== "word" || !nonBlockEndKinds.has(following.value!)) {
        blockDepth--;
        if (blockDepth === 0) {
          if (following.type === "semicolon") {
            return { statementEnd: following.start, resumeAt: following.end };
          }
          if (following.type === "word" && !statementStarters.has(following.value!)) {
            const afterLabel = nextToken(script, following.end);
            if (afterLabel.type === "semicolon") {
              return { statementEnd: following.end, resumeAt: afterLabel.end };
            }
          }
          return { statementEnd: token.end, resumeAt: token.end };
        }
      }
      continue;
    }
    if (token.type === "semicolon" && (!sawBlock || blockDepth === 0)) {
      return { statementEnd: token.start, resumeAt: token.end };
    }
  }
  return undefined;
}

function chooseDelimiter(statement: string): string {
  for (const candidate of ["$$", "//", ";;"]) {
    if (!statement.includes(candidate)) return candidate;
  }
  let suffix = 1;
  while (statement.includes(`__EF_CORE_COMMANDER_END_${suffix}__`)) suffix++;
  return `__EF_CORE_COMMANDER_END_${suffix}__`;
}

function containsDelimiterDirective(script: string): boolean {
  return script.split(/\r?\n/).some(line => {
    const trimmed = line.trimStart();
    return trimmed.length > "DELIMITER".length && trimmed.slice(0, "DELIMITER".length).toUpperCase() === "DELIMITER" && /\s/.test(trimmed["DELIMITER".length]);
  });
}

function nextToken(script: string, start: number): SqlToken {
  let position = start;
  while (position < script.length) {
    const character = script[position];
    const next = script[position + 1];
    if (/\s/.test(character)) {
      position++;
      continue;
    }
    if (character === "-" && next === "-") {
      position = skipToLineEnd(script, position + 2);
      continue;
    }
    if (character === "#") {
      position = skipToLineEnd(script, position + 1);
      continue;
    }
    if (character === "/" && next === "*") {
      const close = script.indexOf("*/", position + 2);
      position = close === -1 ? script.length : close + 2;
      continue;
    }
    break;
  }

  if (position >= script.length) {
    return { start: position, end: position, type: "eof" };
  }

  const character = script[position];
  if (character === ";") {
    return { start: position, end: position + 1, type: "semicolon" };
  }
  if (character === "'" || character === '"' || character === "`") {
    return { start: position, end: skipQuotedValue(script, position, character), type: "other" };
  }
  if (/[A-Za-z_]/.test(character)) {
    let end = position + 1;
    while (end < script.length && /[A-Za-z0-9_$]/.test(script[end])) {
      end++;
    }
    return { start: position, end, type: "word", value: script.slice(position, end).toUpperCase() };
  }
  return { start: position, end: position + 1, type: "other" };
}

function skipQuotedValue(script: string, start: number, quote: string): number {
  let position = start + 1;
  while (position < script.length) {
    if (script[position] === "\\") {
      position += 2;
      continue;
    }
    if (script[position] === quote) {
      if (script[position + 1] === quote) {
        position += 2;
        continue;
      }
      return position + 1;
    }
    position++;
  }
  return position;
}

function skipToLineEnd(script: string, position: number): number {
  while (position < script.length && script[position] !== "\r" && script[position] !== "\n") {
    position++;
  }
  return position;
}
