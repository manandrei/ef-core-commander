export type EfOperation =
  | "addMigration"
  | "removeMigration"
  | "generateSqlScript"
  | "updateDatabase"
  | "dropDatabase";

export interface EfProject {
  name: string;
  path: string;
  directory: string;
  sdk: string;
  outputType: string;
  targetFrameworks: string[];
  packageReferences: string[];
  hasEfCoreReference: boolean;
  dbContexts: DbContextInfo[];
  migrations: MigrationInfo[];
  connectionStrings: ConnectionStringInfo[];
}

export interface DbContextInfo {
  name: string;
  fullName: string;
  projectName: string;
  projectPath: string;
}

export interface MigrationInfo {
  name: string;
  contextName: string;
  filePath: string;
}

export interface ConnectionStringInfo {
  name: string;
  value: string;
  filePath: string;
}

export interface WorkspaceModel {
  projects: EfProject[];
  migrationProjects: EfProject[];
  startupProjects: EfProject[];
  dbContexts: DbContextInfo[];
}

export interface DatabaseMigrationSelection {
  migrationProjectPath: string;
  startupProjectPath?: string;
  dbContextName: string;
  buildConfiguration: string;
  noBuild: boolean;
  targetFramework?: string;
  creationMethod: "StartupProject" | "DesignTimeFactory";
  connection?: string;
  useDefaultConnection: boolean;
}

export interface DatabaseMigrationStatus {
  selection: DatabaseMigrationSelection;
  state: "ready" | "unknown" | "error";
  latestApplied?: string;
  pending: string[];
  error?: string;
}

export interface CommandOptions {
  operation: EfOperation;
  migrationProjectPath: string;
  startupProjectPath?: string;
  dbContextName: string;
  buildConfiguration: string;
  noBuild: boolean;
  targetFramework?: string;
  creationMethod: "StartupProject" | "DesignTimeFactory";
  migrationName?: string;
  outputDir?: string;
  fromMigration?: string;
  toMigration?: string;
  scriptOutput?: string;
  idempotent?: boolean;
  noTransactions?: boolean;
  mariaDbCliCompatible?: boolean;
  connection?: string;
  useDefaultConnection?: boolean;
  additionalArgs?: string;
}
