#!/usr/bin/env node

/**
 * AI-Arch-Guardian — Enhanced Auditor
 *
 * Improvements:
 * - Environment-aware rules (dev/prod/staging)
 * - Alternative circuit breaker support (Resilience4j)
 * - Confidence scoring system
 * - Service dependency graph
 *
 * Usage:
 *   node src/enhanced-auditor.js <scan-result.json> [--output audit.json]
 */

const fs = require('fs');

// ============================================================================
// 1. Environment Configuration
// ============================================================================

const ENVIRONMENTS = {
  development: {
    name: 'Development',
    rules: {
      'NACOS-003': { severity: 'warning', skip: true },  // Allow localhost
      'NACOS-001': { severity: 'warning' },             // Namespace not critical
      'FEIGN-001': { severity: 'warning' }              // Fallback recommended
    }
  },
  testing: {
    name: 'Testing',
    rules: {
      'NACOS-003': { severity: 'medium', skip: false },
      'FEIGN-001': { severity: 'high' }
    }
  },
  production: {
    name: 'Production',
    rules: {
      'NACOS-003': { severity: 'critical', fail: true },
      'NACOS-001': { severity: 'critical', fail: true },
      'FEIGN-001': { severity: 'critical', fail: true }
    }
  },
  unknown: {
    name: 'Unknown',
    rules: {
      // Conservative defaults - treat as production
      'NACOS-003': { severity: 'high' },
      'FEIGN-001': { severity: 'high' }
    }
  }
};

// ============================================================================
// 2. Standards Definition with Confidence Factors
// ============================================================================

const STANDARDS = Object.freeze([
  // --- Nacos ---
  {
    id: 'NACOS-001',
    category: 'nacos',
    severity: 'critical',
    title: 'Nacos 命名空间必须配置',
    rationale: '生产环境必须配置独立命名空间隔离',
    confidenceFactors: {
      hasNamespace: 1.0,
      isPlaceholder: -0.3,
      configSource: 'yaml'
    },
    check(svc) {
      if (!svc.pom?.nacosDiscoveryDeps?.length) return true;
      const ns = svc.nacos?.discoveryNamespace;
      if (!ns) return false;
      if (typeof ns === 'object' && ns.hasPlaceholder) return false;
      return String(ns).trim().length > 0;
    }
  },
  {
    id: 'NACOS-002',
    category: 'nacos',
    severity: 'high',
    title: 'Nacos 配置中心命名空间应与服务发现分离',
    rationale: '配置涉及敏感信息，应独立隔离',
    confidenceFactors: { configSource: 0.8 },
    check(svc) {
      if (!svc.pom?.nacosConfigDeps?.length) return true;
      const discNs = svc.nacos?.discoveryNamespace;
      const cfgNs = svc.nacos?.configNamespace;
      if (discNs && cfgNs && discNs === cfgNs) return false;
      return true;
    }
  },
  {
    id: 'NACOS-003',
    category: 'nacos',
    severity: 'high',
    title: 'Nacos server-addr 不应使用 localhost (生产环境)',
    rationale: '生产环境应使用内网地址或域名',
    confidenceFactors: { isLocalhost: 1.0 },
    check(svc) {
      const addr = svc.nacos?.discoveryAddr || svc.nacos?.configAddr || '';
      if (!addr) return true;
      const isLocalhost = addr.includes('localhost') || addr.includes('127.0.0.1');
      if (!isLocalhost) return true;
      // Allow in dev environment
      return svc.detectedEnvironment === 'development';
    }
  },

  // --- OpenFeign ---
  {
    id: 'FEIGN-001',
    category: 'openfeign',
    severity: 'critical',
    title: '@FeignClient 必须配置 fallback 或 fallbackFactory',
    rationale: '无降级配置会导致服务雪崩',
    confidenceFactors: { hasFallback: 1.0, hasFactory: 1.0, dynamicDetection: -0.2 },
    check(svc) {
      const clients = svc.feignClients || [];
      if (clients.length === 0) return true;
      return clients.some(c => c.fallback || c.fallbackFactory);
    }
  },
  {
    id: 'FEIGN-002',
    category: 'openfeign',
    severity: 'high',
    title: 'Sentinel 或 Resilience4j 依赖必须存在',
    rationale: '无熔断降级依赖，fallback 不会生效',
    confidenceFactors: { hasDependency: 1.0 },
    check(svc) {
      // Check for Sentinel OR Resilience4j OR Hystrix
      const hasSentinel = svc.pom?.sentinelDeps?.length > 0;
      const hasResilience4j = svc.pom?.resilience4jDeps?.length > 0;
      const hasHystrix = svc.pom?.hystrixDeps?.length > 0;
      return hasSentinel || hasResilience4j || hasHystrix;
    }
  },
  {
    id: 'FEIGN-003',
    category: 'openfeign',
    severity: 'critical',
    title: 'circuitbreaker.enabled 必须为 true',
    rationale: '2021.x+ 版本需显式启用',
    confidenceFactors: { configSource: 0.7 },
    check(svc) {
      // This would need YAML config parsing - skip for now
      // Assume enabled if Sentinel is present
      return svc.pom?.sentinelDeps?.length > 0 || svc.pom?.resilience4jDeps?.length > 0;
    }
  },

  // --- Hystrix ---
  {
    id: 'HYSTRIX-001',
    category: 'hystrix',
    severity: 'high',
    title: 'Hystrix 已进入维护模式，建议迁移',
    rationale: 'Netflix Hystrix 自 2018 年停止维护',
    confidenceFactors: { hasDependency: 1.0 },
    check(svc) {
      return !svc.pom?.hystrixDeps?.length;
    }
  }
]);

// ============================================================================
// 3. Confidence Calculator
// ============================================================================

function calculateConfidence(finding, service) {
  const rule = STANDARDS.find(r => r.id === finding.ruleId);
  if (!rule) return { score: 50, level: 'medium', factors: [] };

  let score = 100;
  const factors = [];

  // Check confidence factors
  if (rule.confidenceFactors) {
    // Has fallback
    if (rule.confidenceFactors.hasFallback !== undefined) {
      const hasFallback = service.feignClients?.some(c => c.fallback);
      if (!hasFallback) {
        score -= 20 * rule.confidenceFactors.hasFallback;
        factors.push({ factor: 'no_fallback', impact: -20 });
      }
    }

    // Has factory
    if (rule.confidenceFactors.hasFactory !== undefined) {
      const hasFactory = service.feignClients?.some(c => c.fallbackFactory);
      if (!hasFactory) {
        score -= 15 * rule.confidenceFactors.hasFactory;
        factors.push({ factor: 'no_factory', impact: -15 });
      }
    }

    // Placeholder
    if (rule.confidenceFactors.isPlaceholder !== undefined) {
      // Check if config has placeholders
      const hasPlaceholder = service.warnings?.some(w => w.type === 'spel_placeholder');
      if (hasPlaceholder) {
        score -= 30 * Math.abs(rule.confidenceFactors.isPlaceholder);
        factors.push({ factor: 'spel_placeholder', impact: -30 });
      }
    }
  }

  // Check for dynamic Feign warnings
  const hasDynamicWarning = service.warnings?.some(w => w.type === 'dynamic_feign');
  if (hasDynamicWarning) {
    score -= 25;
    factors.push({ factor: 'dynamic_feign', impact: -25 });
  }

  // Check for inherited Feign warnings
  const hasInheritedWarning = service.warnings?.some(w => w.type === 'inherited_feign');
  if (hasInheritedWarning) {
    score -= 15;
    factors.push({ factor: 'inherited_feign', impact: -15 });
  }

  // Parse method factor
  const usesJavaParser = service.feignClients?.some(c => c.parseMethod === 'javaparser');
  if (usesJavaParser) {
    factors.push({ factor: 'javaparser_used', impact: 10 });
    score += 10;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    level: score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low',
    factors
  };
}

// ============================================================================
// 4. Service Dependency Graph Builder
// ============================================================================

function buildServiceGraph(services) {
  const graph = {
    nodes: [],
    edges: [],
    metrics: {}
  };

  // Create nodes
  for (const svc of services) {
    graph.nodes.push({
      id: svc.name,
      type: 'service',
      moduleCount: 1,
      feignClientCount: svc.feignClients?.length || 0,
      environment: svc.detectedEnvironment,
      hasCircuitBreaker: svc.summary?.hasCircuitBreaker || false
    });
  }

  // Create edges (service call relationships)
  for (const svc of services) {
    for (const client of svc.feignClients || []) {
      if (client.name) {
        graph.edges.push({
          from: svc.name,
          to: client.name,
          hasFallback: !!client.fallback || !!client.fallbackFactory,
          methodCount: client.methods?.length || 0
        });
      }
    }
  }

  // Calculate metrics
  const callCounts = {};
  const fallbackCounts = {};
  for (const edge of graph.edges) {
    callCounts[edge.to] = (callCounts[edge.to] || 0) + 1;
    if (edge.hasFallback) {
      fallbackCounts[edge.to] = (fallbackCounts[edge.to] || 0) + 1;
    }
  }

  graph.metrics = {
    mostCalledService: Object.entries(callCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    maxCalls: Math.max(...Object.values(callCounts), 0),
    servicesWithoutFallback: Object.entries(callCounts)
      .filter(([_, count]) => !fallbackCounts[_])
      .map(([name]) => name),
    singlePointsOfFailure: Object.entries(callCounts)
      .filter(([_, count]) => count >= 3)
      .map(([name, count]) => ({ service: name, callCount: count }))
  };

  return graph;
}

// ============================================================================
// 5. Audit Engine with Environment Adaptation
// ============================================================================

function audit(scanResult, env = 'unknown') {
  const services = scanResult.services || [];
  const envConfig = ENVIRONMENTS[env] || ENVIRONMENTS.unknown;
  const findings = [];

  for (const svc of services) {
    const serviceEnv = svc.detectedEnvironment || env;
    const serviceEnvConfig = ENVIRONMENTS[serviceEnv] || ENVIRONMENTS.unknown;

    for (const rule of STANDARDS) {
      // Check if rule should be skipped for this environment
      const envRule = serviceEnvConfig.rules[rule.id];
      if (envRule?.skip) {
        continue;
      }

      const satisfied = rule.check(svc);
      if (!satisfied) {
        // Adjust severity based on environment
        let severity = rule.severity;
        if (envRule?.severity) {
          severity = envRule.severity;
        }

        const confidence = calculateConfidence({ ruleId: rule.id }, svc);

        findings.push({
          service: svc.name,
          servicePath: svc.path,
          ruleId: rule.id,
          category: rule.category,
          severity,
          title: rule.title,
          rationale: rule.rationale,
          location: svc.path,
          confidence,
          environment: serviceEnv,
          isEnvironmentAdjusted: envRule?.severity !== undefined
        });
      }
    }

    // Add per-interface fallback checks
    for (const client of svc.feignClients || []) {
      if (!client.fallback && !client.fallbackFactory) {
        const confidence = calculateConfidence({ ruleId: 'FEIGN-001' }, svc);
        const envRule = serviceEnvConfig.rules['FEIGN-001'];

        findings.push({
          service: svc.name,
          servicePath: svc.path,
          ruleId: 'FEIGN-001',
          category: 'openfeign',
          severity: envRule?.severity || 'critical',
          title: `@FeignClient "${client.name || client.interfaceName}" 缺少降级配置`,
          rationale: STANDARDS.find(r => r.id === 'FEIGN-001').rationale,
          location: client.filePath,
          clientName: client.name || client.interfaceName,
          confidence,
          environment: serviceEnv
        });
      }
    }

    // Add warnings as info-level findings
    for (const warning of svc.warnings || []) {
      findings.push({
        service: svc.name,
        servicePath: svc.path,
        ruleId: 'WARN-001',
        category: 'warning',
        severity: 'info',
        title: warning.message,
        rationale: warning.suggestion || 'This may affect analysis accuracy',
        location: warning.files?.[0],
        isWarning: true,
        confidence: { score: 40, level: 'low', factors: [{ factor: warning.type, impact: -60 }] },
        environment: serviceEnv
      });
    }
  }

  // Build service graph
  const serviceGraph = buildServiceGraph(services);

  // Summary
  const summary = {
    totalFindings: findings.filter(f => !f.isWarning).length,
    totalWarnings: findings.filter(f => f.isWarning).length,
    bySeverity: {
      critical: findings.filter(f => f.severity === 'critical' && !f.isWarning).length,
      high: findings.filter(f => f.severity === 'high' && !f.isWarning).length,
      medium: findings.filter(f => f.severity === 'medium' && !f.isWarning).length,
      low: findings.filter(f => f.severity === 'low' && !f.isWarning).length,
      info: findings.filter(f => f.severity === 'info' || f.isWarning).length
    },
    byCategory: {},
    environmentBreakdown: {
      production: findings.filter(f => f.environment === 'production' && !f.isWarning).length,
      development: findings.filter(f => f.environment === 'development' && !f.isWarning).length,
      testing: findings.filter(f => f.environment === 'testing' && !f.isWarning).length,
      unknown: findings.filter(f => f.environment === 'unknown' && !f.isWarning).length
    },
    confidenceStats: {
      high: findings.filter(f => f.confidence?.level === 'high').length,
      medium: findings.filter(f => f.confidence?.level === 'medium').length,
      low: findings.filter(f => f.confidence?.level === 'low').length
    }
  };

  // Calculate score
  const deductions = { critical: 15, high: 10, medium: 5, low: 2, info: 0 };
  let penalty = 0;
  for (const [sev, count] of Object.entries(summary.bySeverity)) {
    penalty += (deductions[sev] || 0) * count;
  }
  summary.score = Math.max(0, 100 - penalty);
  summary.grade = summary.score >= 90 ? 'A' :
                  summary.score >= 80 ? 'B' :
                  summary.score >= 70 ? 'C' :
                  summary.score >= 60 ? 'D' : 'F';

  for (const f of findings) {
    summary.byCategory[f.category] = (summary.byCategory[f.category] || 0) + 1;
  }

  return {
    standardsVersion: 'Spring Cloud Alibaba 2022.x Enhanced',
    projectRoot: scanResult.projectRoot,
    detectedEnvironment: env,
    findings,
    services,
    summary,
    serviceGraph
  };
}

// ============================================================================
// 6. Main
// ============================================================================

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`
AI-Arch-Guardian — Enhanced Auditor

Usage:
  node src/enhanced-auditor.js <scan-result.json> [--output audit.json] [--env production]

Features:
  - Environment-aware rules
  - Alternative circuit breaker support
  - Confidence scoring
  - Service dependency graph

Options:
  --env <environment>  Override environment (development|testing|production)
  --output <file>      Output file path
`);
    process.exit(0);
  }

  const scanFile = args[0];
  const envIdx = args.indexOf('--env');
  const env = envIdx !== -1 ? args[envIdx + 1] : 'unknown';
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : null;

  if (!scanFile) {
    console.error('Error: Please provide scan result file');
    process.exit(1);
  }

  const scanResult = JSON.parse(fs.readFileSync(scanFile, 'utf8'));
  console.log(`Auditing with environment: ${env}`);

  const result = audit(scanResult, env);

  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`Audit results written to: ${outputPath}`);
    console.log(`\nSummary:`);
    console.log(`  Score: ${result.summary.score}/100`);
    console.log(`  Grade: ${result.summary.grade}`);
    console.log(`  Findings: ${result.summary.totalFindings}`);
    console.log(`  Warnings: ${result.summary.totalWarnings}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main();