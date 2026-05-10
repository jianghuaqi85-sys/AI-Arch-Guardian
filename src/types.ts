/**
 * AI-Arch-Guardian — TypeScript Type Definitions
 *
 * These types define the data structures used throughout the project.
 * Can be used with TypeScript directly or via JSDoc annotations in JavaScript.
 */

// ============================================================================
// Scanner Types
// ============================================================================

/** Nacos configuration extracted from YAML */
export interface NacosConfig {
  discoveryAddr?: string;
  discoveryNamespace?: string;
  configAddr?: string;
  configNamespace?: string;
}

/** POM.xml dependencies */
export interface PomDependencies {
  groupId?: string;
  artifactId?: string;
  version?: string;
  openfeignDeps: string[];
  nacosDiscoveryDeps: string[];
  nacosConfigDeps: string[];
  sentinelDeps: string[];
  hystrixDeps: string[];
}

/** @FeignClient method signature */
export interface FeignMethod {
  name: string;
  returnType: string;
  params: Array<{
    type: string;
    name: string;
  }>;
}

/** @FeignClient annotation parsed from Java file */
export interface FeignAnnotation {
  name?: string;
  url?: string;
  fallback?: string;
  fallbackFactory?: string;
  path?: string;
  contextId?: string;
}

/** Scanned FeignClient interface */
export interface FeignClient {
  interfaceName: string;
  filePath: string;
  annotation: FeignAnnotation;
  methods: FeignMethod[];
}

/** Scanned service/module */
export interface ScannedService {
  moduleName: string;
  modulePath: string;
  pom: PomDependencies;
  nacos: NacosConfig;
  feignClients: FeignClient[];
}

/** Global summary from scan */
export interface GlobalSummary {
  totalModules: number;
  totalFeignClients: number;
  feignWithoutFallback: number;
  nacosConfigured: number;
  sentinelConfigured: number;
}

/** Complete scan result */
export interface ScanResult {
  projectRoot: string;
  scanTime: string;
  services: ScannedService[];
  globalSummary: GlobalSummary;
}

// ============================================================================
// Auditor Types
// ============================================================================

/** Rule severity levels */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Rule categories */
export type RuleCategory = 'nacos' | 'openfeign' | 'sentinel' | 'hystrix';

/** Audit rule definition */
export interface AuditRule {
  id: string;
  category: RuleCategory;
  severity: Severity;
  title: string;
  rationale: string;
  check: (service: ScannedService) => boolean;
}

/** Individual finding */
export interface Finding {
  service: string;
  ruleId: string;
  category: RuleCategory;
  severity: Severity;
  title: string;
  message: string;
  location?: string;
}

/** Severity breakdown */
export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

/** Category breakdown */
export interface CategoryCounts {
  nacos: number;
  openfeign: number;
  sentinel: number;
  hystrix: number;
}

/** Audit summary */
export interface AuditSummary {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  totalFindings: number;
  bySeverity: SeverityCounts;
  byCategory: CategoryCounts;
}

/** Complete audit result */
export interface AuditResult {
  standardsVersion: string;
  projectRoot: string;
  findings: Finding[];
  services: ScannedService[];
  summary: AuditSummary;
}

// ============================================================================
// Reporter Types
// ============================================================================

/** Report format options */
export type ReportFormat = 'markdown' | 'json' | 'html';

/** Report configuration */
export interface ReportConfig {
  format: ReportFormat;
  outputPath: string;
  includeDetails: boolean;
  severityFilter?: Severity[];
}

// ============================================================================
// Patcher Types
// ============================================================================

/** Parsed Java interface */
export interface ParsedJavaInterface {
  package: string;
  imports: string[];
  feignAnnotation: FeignAnnotation;
  interfaceName: string;
  methods: FeignMethod[];
}

/** Generated fallback class info */
export interface FallbackClass {
  className: string;
  package: string;
  interfaceName: string;
  service: string;
  filePath: string;
  content: string;
}

/** Patch result */
export interface PatchResult {
  patches: FallbackClass[];
  totalGenerated: number;
  totalFailed: number;
  errors: Array<{
    interfaceName: string;
    error: string;
  }>;
}

// ============================================================================
// CLI Options Types
// ============================================================================

/** CLI configuration */
export interface CLIOptions {
  projectPath: string;
  outputDir?: string;
  noPatch: boolean;
  dryRun: boolean;
  debug: boolean;
  format?: ReportFormat;
  rulesFile?: string;
}

/** CLI argument parser result */
export interface ParsedArgs {
  args: string[];
  options: CLIOptions;
}

// ============================================================================
// Error Types
// ============================================================================

/** Error codes */
export type ErrorCode =
  | 'SCANNER_001' | 'SCANNER_002' | 'SCANNER_003' | 'SCANNER_004'
  | 'AUDITOR_001' | 'AUDITOR_002' | 'AUDITOR_003'
  | 'REPORTER_001' | 'REPORTER_002'
  | 'PATCHER_001' | 'PATCHER_002' | 'PATCHER_003'
  | 'VALIDATION_001' | 'VALIDATION_002'
  | 'FILESYSTEM_001' | 'FILESYSTEM_002'
  | 'CONFIG_001';

/** Custom error with code */
export interface ArchGuardianError extends Error {
  code: ErrorCode;
  exitCode: number;
  suggestion?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

/** External rule definition (YAML/JSON) */
export interface ExternalRule {
  id: string;
  category: RuleCategory;
  severity: Severity;
  title: string;
  description?: string;
  rationale?: string;
  checkExpression: string;
  enabled?: boolean;
}

/** Rules configuration file */
export interface RulesConfig {
  version: string;
  rules: ExternalRule[];
}

// ============================================================================
// Utility Types
// ============================================================================

/** Result type for operations that can fail */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/** Optional type */
export type Optional<T> = T | undefined | null;

/** Deep partial type */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};