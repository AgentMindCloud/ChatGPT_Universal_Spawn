export type PluginTemplate = "skill" | "mcp" | "mcp-ui" | "custom-gpt-action";

export type ValidationProfile = "local" | "publish";

export type ValidationStatus = "valid" | "invalid" | "manual_required";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  path: string;
  message: string;
  helpUrl?: string;
}

export interface ManualCheck {
  id: string;
  label: string;
  complete: boolean;
  note: string;
}

export interface ValidationOptions {
  profile?: ValidationProfile;
  online?: boolean;
}

export interface ValidationReport {
  profile: ValidationProfile;
  status: ValidationStatus;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  manualChecks: ManualCheck[];
  checkedRules: string[];
}

export interface ScaffoldOptions {
  root: string;
  template: PluginTemplate;
  name: string;
  description: string;
  author: string;
  repositoryUrl: string;
  mcpUrl?: string;
  actionBaseUrl?: string;
}

export interface ScaffoldResult {
  root: string;
  template: PluginTemplate;
  pluginName: string;
  createdFiles: string[];
}

export interface BuildOptions {
  out: string;
}

export interface BuildResult {
  archivePath: string;
  checksumPath: string;
  sha256: string;
  bytes: number;
  files: string[];
}

export type MarketplaceTarget = "personal" | "repo";

export interface InstallOptions {
  marketplace: MarketplaceTarget;
  repoRoot?: string;
  replace?: boolean;
}

export interface MarketplaceEntry {
  name: string;
  source: {
    source: "local";
    path: string;
  };
  policy: {
    installation: "AVAILABLE";
    authentication: "ON_INSTALL";
  };
  category: string;
}

export interface InstallPlan {
  sourceRoot: string;
  destinationRoot: string;
  marketplacePath: string;
  pluginName: string;
  replace: boolean;
  conflicts: string[];
  before: string | null;
  after: string;
  rollback: {
    restoreMarketplace: string | null;
    destinationExisted: boolean;
  };
}

export interface InstallResult {
  destinationRoot: string;
  marketplacePath: string;
  installed: boolean;
}

export interface LinkResult {
  appManifestPath: string;
  pluginManifestPath: string;
  appId: string;
}

export interface CustomGptExportOptions {
  out: string;
  force?: boolean;
}

export interface CustomGptExportResult {
  out: string;
  files: string[];
  checksumPath: string;
}

export interface DoctorOptions {
  checkDocs?: boolean;
}

export interface DoctorCheck {
  id: string;
  ok: boolean;
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface PluginManifest {
  id?: string;
  name: string;
  version: string;
  description: string;
  author: {
    name: string;
    email?: string;
    url?: string;
  };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  skills?: string;
  apps?: string;
  mcpServers?: string | Record<string, unknown>;
  interface: {
    displayName: string;
    shortDescription: string;
    longDescription: string;
    developerName: string;
    category: string;
    capabilities: string[];
    websiteURL?: string;
    privacyPolicyURL?: string;
    termsOfServiceURL?: string;
    defaultPrompt?: string[];
    default_prompt?: string[];
    brandColor?: string;
    composerIcon?: string;
    logo?: string;
    logoDark?: string;
    screenshots?: string[];
  };
}
