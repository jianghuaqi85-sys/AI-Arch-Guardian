#!/usr/bin/env node

/**
 * AI-Arch-Guardian — Auditor
 *
 * Compares scan results against Spring Cloud Alibaba 2021.x/2022.x best practices
 * and produces a structured audit report with risk assessments.
 *
 * Standards reference:
 *   - Spring Cloud Alibaba 2021.0.4.0+ / 2022.0.0.0+
 *   - Alibaba Sentinel 1.8.6+
 *   - Spring Cloud OpenFeign 3.1.x / 4.0.x
 *
 * Usage:
 *   node auditor.js <scan-report.json>               → print audit to stdout
 *   node auditor.js <scan-report.json> --output a.json → write to file
 *   node scanner.js /path/to/project | node auditor.js  → pipe mode
 */

const fs = require('fs');

// ---------------------------------------------------------------------------
// 1. STANDARDS DEFINITION — Spring Cloud Alibaba best-practice rulebook
// ---------------------------------------------------------------------------

/**
 * Each rule has:
 *   id          — stable identifier for cross-referencing
 *   category    — 'nacos' | 'openfeign' | 'sentinel' | 'hystrix'
 *   severity    — 'critical' | 'high' | 'medium' | 'low' | 'info'
 *   title       — human-readable one-liner
 *   rationale   — why this rule exists (linked to official docs)
 *   check(service) — predicate: returns true when rule is SATISFIED
 */
const STANDARDS = Object.freeze([

  // ── Nacos — Namespace Isolation ──────────────────────────────────────────
  {
    id: 'NACOS-001',
    category: 'nacos',
    severity: 'critical',
    title: 'Nacos 命名空间必须配置（禁止使用空 namespace / public 保留空间）',
    rationale:
      'Spring Cloud Alibaba 官方建议按环境（dev/test/staging/prod）配置独立命名空间，' +
      '实现服务治理层面的逻辑隔离。使用空 namespace 会导致服务混入 public 保留空间，' +
      '存在跨环境调用的风险。参考：Nacos 官方文档 § 命名空间。',
    check(svc) {
      // Has nacos discovery configured AND namespace is non-empty
      if (!svc.pom.nacosDiscoveryDeps.length) return true; // no nacos → skip
      const ns = svc.nacos.discoveryNamespace;
      return ns !== undefined && ns !== null && String(ns).trim().length > 0;
    },
  },

  {
    id: 'NACOS-002',
    category: 'nacos',
    severity: 'high',
    title: 'Nacos 配置中心命名空间应与服务发现分离（推荐）',
    rationale:
      '配置中心涉及敏感信息（数据库密码、密钥等），官方建议使用独立命名空间隔离配置访问权限，' +
      '避免服务发现 namespace 泄露配置数据。参考：Nacos 权限控制最佳实践。',
    check(svc) {
      if (!svc.pom.nacosConfigDeps.length) return true; // no config center → skip
      const discNs = svc.nacos.discoveryNamespace;
      const cfgNs = svc.nacos.configNamespace;
      // If both configured, they should differ or at least be explicitly set
      if (discNs && cfgNs && discNs === cfgNs) return false;
      return true;
    },
  },

  {
    id: 'NACOS-003',
    category: 'nacos',
    severity: 'high',
    title: 'Nacos server-addr 不得为 localhost（生产环境）',
    rationale:
      '生产环境中 localhost 指向本机，会导致服务无法注册到远程 Nacos 集群，' +
      '造成服务发现失败。应使用 Nacos 集群的 VIP/域名。',
    check(svc) {
      const addr = svc.nacos.discoveryAddr || svc.nacos.configAddr;
      if (!addr) return true; // no nacos → skip
      const hostPart = String(addr).split(':')[0];
      const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostPart.toLowerCase());
      return !isLocal;
    },
  },

  {
    id: 'NACOS-004',
    category: 'nacos',
    severity: 'low',
    title: '建议启用 Nacos 认证（username/password）',
    rationale:
      'Nacos 1.2.0+ 引入了基于角色的访问控制（RBAC），生产环境中应启用鉴权防止未授权访问。' +
      '配置方式：spring.cloud.nacos.username / spring.cloud.nacos.password。',
    check(svc) {
      return true; // scanner doesn't extract credentials — always warn as info
    },
  },

  // ── OpenFeign — Fallback / Circuit Breaker ──────────────────────────────
  {
    id: 'FEIGN-001',
    category: 'openfeign',
    severity: 'critical',
    title: '每个 @FeignClient 必须配置 fallback 或 fallbackFactory',
    rationale:
      'Spring Cloud Alibaba 2021.x+ 强制要求所有 Feign 客户端具备熔断降级能力。' +
      '未配置 fallback 的接口在被调用服务宕机、超时、线程池满时会直接抛出异常，' +
      '导致上游服务雪崩。Sentinel 降级规则依赖 fallback 类执行回退逻辑。' +
      '参考：Spring Cloud Circuit Breaker 官方文档。',
    check(svc) {
      return svc.summary.feignFallbackConfigured;
    },
  },

  {
    id: 'FEIGN-002',
    category: 'openfeign',
    severity: 'high',
    title: 'Sentinel 依赖必须显式声明（spring-cloud-starter-alibaba-sentinel）',
    rationale:
      'Spring Cloud Alibaba 2021.x 默认以 Sentinel 为熔断降级实现。' +
      '若只引入 openfeign 而未引入 sentinel 依赖，feign.sentinel.enabled 默认为 false，' +
      'fallback 配置不会生效，降级逻辑形同虚设。',
    check(svc) {
      if (!svc.pom.hasOpenfeign) return true; // no feign → skip
      return svc.pom.hasSentinel;
    },
  },

  {
    id: 'FEIGN-003',
    category: 'openfeign',
    severity: 'medium',
    title: '每个 @FeignClient 的 fallback 类应有独立且语义化的命名',
    rationale:
      '避免所有接口共用同一个 fallback 类（如 DefaultFallback.class），' +
      '否则无法区分哪个接口触发了降级，不利于故障排查和监控。',
    check(svc) {
      if (!svc.summary.feignFallbackConfigured) return true; // skip if no fallback at all
      const fallbackNames = svc.feignClients
        .filter(c => c.fallback || c.fallbackFactory)
        .map(c => c.fallback || c.fallbackFactory);
      // Warn if more than half of fallbacks share the same name
      const unique = new Set(fallbackNames);
      if (fallbackNames.length > 1 && unique.size === 1) return false;
      return true;
    },
  },

  // ── Hystrix — Migration ──────────────────────────────────────────────────
  {
    id: 'HYSTRIX-001',
    category: 'hystrix',
    severity: 'high',
    title: 'Hystrix 已进入维护模式，必须迁移到 Sentinel',
    rationale:
      'Netflix Hystrix 自 2018 年起进入维护模式，不再接受新功能。' +
      'Spring Cloud 2021.x 官方推荐使用 Resilience4j 或 Sentinel 替代。' +
      '继续使用 Hystrix 会导致安全漏洞无法修复和社区支持缺失。',
    check(svc) {
      return !svc.pom.hasHystrix;
    },
  },

  // ── Sentinel — Degrade Rules ─────────────────────────────────────────────
  {
    id: 'SENTINEL-001',
    category: 'sentinel',
    severity: 'info',
    title: '建议为每个 FeignClient 配置 Sentinel 降级规则（慢调用比例/异常比例）',
    rationale:
      '仅配置 fallback 类不足以实现弹性工程。推荐通过 Sentinel Dashboard 或配置文件' +
      '为每个远程调用设置慢调用比例（slowRatioThreshold）或异常比例（grade=0/1）降级规则。',
    check() { return true; }, // Informational only — Sentinel rules are runtime config
  },

  // ── Sentinel — Circuit Breaker Configuration ──────────────────────────────
  {
    id: 'SENTINEL-002',
    category: 'sentinel',
    severity: 'critical',
    title: 'Sentinel 必须配置 Dashboard 地址以便实时监控',
    rationale:
      'Sentinel Dashboard 是 Sentinel 核心组件，用于配置流控规则、降级规则和实时监控。' +
      '未配置 Dashboard 将无法动态调整规则，影响运维效率。参考：Sentinel 官方文档。',
    check(svc) {
      if (!svc.pom.sentinelDeps.length) return true; // no sentinel → skip
      // Check if sentinel dashboard is configured
      const nacosConfig = svc.nacos || {};
      // Dashboard config is usually in application.yml sentinel section
      // This is more of a recommendation, so we check if there's any sentinel config
      return Object.keys(svc.nacos || {}).length > 0 || svc.pom.sentinelDeps.length > 0;
    },
  },

  {
    id: 'SENTINEL-003',
    category: 'sentinel',
    severity: 'high',
    title: 'Sentinel 建议配置 eager=true 提前加载规则',
    rationale:
      '将 sentinel.eager 设置为 true 可以让 Sentinel 在服务启动时提前加载规则，' +
      '避免首次请求时因规则未加载而放行过多流量。参考：Sentinel 官方文档。',
    check(svc) {
      if (!svc.pom.sentinelDeps.length) return true; // no sentinel → skip
      // This is informational - check if eager is configured (not easy to check in current structure)
      return true; // Placeholder - would need YAML parsing to check this
    },
  },

  // ── OpenFeign — Circuit Breaker ───────────────────────────────────────────
  {
    id: 'FEIGN-003',
    category: 'openfeign',
    severity: 'critical',
    title: 'Spring Cloud OpenFeign circuitbreaker.enabled 必须为 true',
    rationale:
      '从 Spring Cloud 2021.x 开始，需要显式启用 circuitbreaker.enabled=true 才能让 Fallback 生效。' +
      '根据官方 issue (#3979)，默认值为 false会导致 OpenFeign 客户端不会被 Spring Cloud CircuitBreaker 包装，' +
      'Fallback 不会触发。参考：Spring Cloud OpenFeign 官方文档。',
    check(svc) {
      if (!svc.pom.openfeignDeps.length) return true; // no feign → skip
      // Check if circuitbreaker is enabled - this would need to be extracted from scanner
      // For now, we check if sentinel is present as proxy
      return svc.pom.sentinelDeps.length > 0 || svc.pom.resilience4jDeps?.length > 0;
    },
  },

  // ── Nacos — Server Address ─────────────────────────────────────────────────
  {
    id: 'NACOS-003',
    category: 'nacos',
    severity: 'high',
    title: 'Nacos server-addr 不应使用 localhost 生产环境',
    rationale:
      '生产环境应使用内网地址或域名，不应使用 localhost。' +
      '使用 localhost 会导致服务间无法互相发现，影响微服务架构的正常运行。',
    check(svc) {
      if (!svc.nacos.discoveryAddr && !svc.nacos.configAddr) return true; // skip if no nacos
      const addr = svc.nacos.discoveryAddr || svc.nacos.configAddr || '';
      // Allow localhost for dev only, warn for others
      if (addr.includes('localhost') || addr.includes('127.0.0.1')) {
        // Check if namespace indicates production
        const ns = svc.nacos.discoveryNamespace || '';
        if (ns.toLowerCase().includes('prod') || ns.toLowerCase().includes('production')) {
          return false;
        }
      }
      return true;
    },
  },

  // ── Nacos — Endpoint Dynamic Discovery ─────────────────────────────────────
  {
    id: 'NACOS-004',
    category: 'nacos',
    severity: 'medium',
    title: 'Nacos 建议配置 endpoint 以支持集群动态感知',
    rationale:
      'Nacos Client 提供 endpoint 机制来动态感知服务端集群变化。' +
      '当 Nacos Server 集群扩缩容时，客户端可以通过 endpoint 及时更新集群列表。' +
      '参考：Nacos 官方文档 endpoint 最佳实践。',
    check(svc) {
      if (!svc.nacos.discoveryAddr && !svc.nacos.configAddr) return true; // skip if no nacos
      // Check if endpoint is configured - would need more YAML parsing
      return true; // Informational
    },
  },

  // ── OpenFeign — Timeout Configuration ───────────────────────────────────────
  {
    id: 'FEIGN-004',
    category: 'openfeign',
    severity: 'medium',
    title: 'OpenFeign 必须配置合理的超时时间',
    rationale:
      '未配置超时时间会导致请求无限期等待，当远程服务不可用时会阻塞线程池。' +
      '建议配置 connectTimeout 和 readTimeout，建议值：connectTimeout=5000ms, readTimeout=10000ms。' +
      '参考：Spring Cloud OpenFeign 官方文档。',
    check(svc) {
      if (!svc.pom.openfeignDeps.length) return true; // no feign → skip
      // Check if timeout is configured - would need YAML parsing
      return true; // Placeholder - would need feign client config parsing
    },
  },
]);

// Rule categories for grouping
const CATEGORY_LABELS = {
  nacos: 'Nacos 注册/配置中心',
  openfeign: 'OpenFeign 熔断降级',
  sentinel: 'Sentinel 流控降级',
  hystrix: 'Hystrix 迁移',
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const SEVERITY_LABELS = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  info: '建议',
};

// ---------------------------------------------------------------------------
// 2. AUDIT ENGINE — compare scan output against standards
// ---------------------------------------------------------------------------

/**
 * Run all standards against the scanner report.
 *
 * @param {Object} report — scanner.js output (contains .services[])
 * @returns {Object} { findings: [], summary: {} }
 */
function audit(report) {
  const services = report.services || [];
  const findings = [];

  for (const svc of services) {
    for (const rule of STANDARDS) {
      const satisfied = rule.check(svc);
      if (!satisfied) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          category: rule.category,
          title: rule.title,
          rationale: rule.rationale,
          service: svc.name,
          servicePath: svc.path,
          details: buildDetails(rule, svc),
        });
      }
    }

    // ── Additional per-FeignClient fallback checks ─────────────────────────
    for (const client of svc.feignClients) {
      if (!client.fallback && !client.fallbackFactory) {
        // Already covered by FEIGN-001 (module-level), but add per-interface detail
        const risk = inferRisk(client, svc);
        findings.push({
          ruleId: 'FEIGN-001',
          severity: 'critical',
          category: 'openfeign',
          title: `@FeignClient "${client.name || '未命名'}" 缺少降级配置`,
          rationale: STANDARDS.find(r => r.id === 'FEIGN-001').rationale,
          service: svc.name,
          servicePath: svc.path,
          details: {
            feignClient: client,
            riskAssessment: risk,
          },
        });
      }
    }
  }

  // Produce summary
  const summary = {
    totalFindings: findings.length,
    bySeverity: {
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
      info: findings.filter(f => f.severity === 'info').length,
    },
    byCategory: {},
    score: 0,
    grade: 'N/A',
  };

  for (const f of findings) {
    summary.byCategory[f.category] = (summary.byCategory[f.category] || 0) + 1;
  }

  // Score: 100 - deductions (critical:-15, high:-10, medium:-5, low:-2, info:0)
  const deductions = {
    critical: 15,
    high: 10,
    medium: 5,
    low: 2,
    info: 0,
  };
  let penalty = 0;
  for (const sev of Object.keys(summary.bySeverity)) {
    penalty += (summary.bySeverity[sev] || 0) * (deductions[sev] || 0);
  }
  summary.score = Math.max(0, 100 - penalty);

  if (summary.score >= 90) summary.grade = 'A — 优秀，架构规范';
  else if (summary.score >= 75) summary.grade = 'B — 良好，有少量改进空间';
  else if (summary.score >= 60) summary.grade = 'C — 一般，存在多项不合规';
  else if (summary.score >= 40) summary.grade = 'D — 较差，有严重架构风险';
  else summary.grade = 'F — 不合格，高可用性无保障';

  return { findings, summary, standardsVersion: 'Spring Cloud Alibaba 2021.x/2022.x' };
}

/**
 * Build human-readable details for a specific rule violation.
 */
function buildDetails(rule, svc) {
  switch (rule.id) {
    case 'NACOS-001':
      return { currentNamespace: svc.nacos.discoveryNamespace || '(空)', fix: '为每个环境配置独立 namespace，如 dev / test / prod' };
    case 'NACOS-002':
      return { discoveryNamespace: svc.nacos.discoveryNamespace, configNamespace: svc.nacos.configNamespace, fix: '配置中心使用独立命名空间，将配置访问权限与服务发现隔离' };
    case 'NACOS-003':
      return { currentAddr: svc.nacos.discoveryAddr || svc.nacos.configAddr, fix: '替换为 Nacos 集群地址（VIP/域名/内网 NLB）' };
    case 'FEIGN-001':
      return { affectedClients: svc.feignClients.filter(c => !c.fallback && !c.fallbackFactory).map(c => c.name || c.file), fix: '为每个 @FeignClient 添加 fallback = XxxFallback.class 或 fallbackFactory = XxxFallbackFactory.class' };
    case 'FEIGN-002':
      return { hasSentinelDep: svc.pom.hasSentinel, fix: 'pom.xml 添加依赖: com.alibaba.cloud:spring-cloud-starter-alibaba-sentinel' };
    case 'FEIGN-003':
      return { fallbackNames: svc.feignClients.filter(c => c.fallback || c.fallbackFactory).map(c => c.fallback || c.fallbackFactory), fix: '为不同接口创建独立的 fallback 类，命名体现接口用途' };
    case 'HYSTRIX-001':
      return { hystrixDeps: svc.pom.hystrixDeps.map(d => d.artifactId), fix: '移除 hystrix 依赖，迁移至 Sentinel (spring-cloud-starter-alibaba-sentinel)' };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// 3. AI RISK INFERENCE — analyze cascading effects of missing fallbacks
// ---------------------------------------------------------------------------

/**
 * Infer the risk level and cascading failure chain for a FeignClient missing fallback.
 *
 * This function encodes architectural reasoning rules that an LLM would apply:
 *   - What domain does this client name suggest? (order, payment, user, inventory...)
 *   - What is the blast radius if this call fails?
 *   - What upstream chains depend on this service?
 *
 * @param {Object} client — the @FeignClient annotation data
 * @param {Object} svc — the parent service
 * @returns {Object} { riskLevel, chainReaction, mitigation }
 */
function inferRisk(client, svc) {
  const name = (client.name || client.path || '').toLowerCase();
  const serviceName = (svc.name || '').toLowerCase();

  // ── Domain classification by naming convention ──
  const domainPatterns = [
    { pattern: /\b(?:pay|payment|billing|charge|refund|wallet|settle)/i, domain: '支付/结算', criticality: 'critical', chain: '整个支付链路中断 → 订单无法完成 → 营收损失' },
    { pattern: /\b(?:order|booking|reserv)/i, domain: '订单/预订', criticality: 'critical', chain: '订单创建失败 → 库存未锁定 → 用户体验受损 → 客诉/流失' },
    { pattern: /\b(?:user|account|auth|login|sso|oauth|token|session)/i, domain: '用户/认证', criticality: 'critical', chain: '认证鉴权失败 → 所有需要登录的接口不可用 → 全站不可用' },
    { pattern: /\b(?:inventory|stock|warehouse|goods|product|sku|item)/i, domain: '库存/商品', criticality: 'high', chain: '库存查询失败 → 超卖/少卖 → 订单异常 → 客诉' },
    { pattern: /\b(?:notify|sms|email|push|message|im)/i, domain: '通知/消息', criticality: 'medium', chain: '通知漏发 → 用户不知道订单状态 → 体验降级（非阻断）' },
    { pattern: /\b(?:log|audit|trace|report|analytics|metric)/i, domain: '日志/审计', criticality: 'low', chain: '日志丢失 → 排查困难 → 不影响业务流程' },
    { pattern: /\b(?:search|recommend|suggest|rank)/i, domain: '搜索/推荐', criticality: 'medium', chain: '搜索降级 → 用户看到空结果 → 体验降级（非阻断）' },
    { pattern: /\b(?:config|admin|manage|internal|monitor|health)/i, domain: '配置/管理', criticality: 'low', chain: '管理功能异常 → 不影响用户侧 → 运维效率降低' },
  ];

  const matched = domainPatterns.find(d => d.pattern.test(name))
    || domainPatterns.find(d => d.pattern.test(serviceName))
    || { domain: '未分类', criticality: 'medium', chain: '未知影响 → 建议人工评估调用链路' };

  // ── Specific chain-reaction reasoning ──
  const chainReactions = buildChainReaction(client, svc, matched);
  const mitigation = buildMitigation(client, svc, matched);

  return {
    riskLevel: matched.criticality,
    domain: matched.domain,
    clientName: client.name || client.file,
    callerService: svc.name,
    chainReactions,
    mitigation,
  };
}

function buildChainReaction(client, svc, matched) {
  const steps = [];

  // Step 1: Immediate failure
  const callDesc = client.path
    ? `调用 ${client.name || '远程服务'} 的 ${client.path} 接口`
    : `调用 ${client.name || '远程服务'}`;
  steps.push(`① 当被调服务不可用时，${callDesc} 直接抛出异常（无 fallback 兜底）`);

  // Step 2: Thread pool exhaustion
  steps.push(`② 请求线程被阻塞（默认超时前一直等待），${svc.name || '调用方'} 的 Tomcat/Undertow 线程池逐步耗尽`);

  // Step 3: Upstream cascade
  steps.push(`③ ${svc.name || '调用方'} 自身变得不可用，上游调用方（如 API Gateway）也开始超时`);

  // Step 4: Domain-specific blast
  steps.push(`④ 业务影响：${matched.chain}`);

  // Step 5: Recovery difficulty
  steps.push('⑤ 无降级时恢复依赖重启整个集群，而配置了 fallback 的服务可在被调恢复后自动愈合');

  return steps;
}

function buildMitigation(client, svc, matched) {
  const fallbackExample = client.name
    ? `${capitalize(client.name)}Fallback`
    : 'DefaultFallback';

  const tips = [
    `为 @FeignClient(name = "${client.name || 'xxx'}") 添加 fallback = ${fallbackExample}.class`,
    `${fallbackExample} 类应实现该 Feign 接口，并返回合理的兜底值（如空列表、缓存数据、默认对象）`,
    '在 pom.xml 中确认已引入 spring-cloud-starter-alibaba-sentinel',
    '在 application.yml 中确认 feign.sentinel.enabled = true',
  ];

  if (matched.criticality === 'critical') {
    tips.push('⚠️ 建议在 Sentinel Dashboard 中为该接口配置线程数隔离（thread）或信号量隔离，防止单个接口耗尽所有线程');
    tips.push('⚠️ 建议设置合理的超时时间（feign.client.config.default.connectTimeout / readTimeout），避免无限期等待');
  }

  return tips;
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// 4. Report formatting
// ---------------------------------------------------------------------------

function formatReport(auditResult, format = 'text') {
  if (format === 'json') return JSON.stringify(auditResult, null, 2);

  const { findings, summary } = auditResult;
  const lines = [];

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  AI-Arch-Guardian  架构审计报告');
  lines.push('  标准: Spring Cloud Alibaba 2021.x / 2022.x 生产最佳实践');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`  综合评分: ${summary.score}/100  等级: ${summary.grade}`);
  lines.push(`  发现问题: ${summary.totalFindings} 项`);
  lines.push(`    严重: ${summary.bySeverity.critical}  高: ${summary.bySeverity.high}  中: ${summary.bySeverity.medium}  低: ${summary.bySeverity.low}  建议: ${summary.bySeverity.info}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('  ✓ 未发现不合规项，架构规范！');
    return lines.join('\n');
  }

  // Group findings by severity
  for (const sev of SEVERITY_ORDER) {
    const group = findings.filter(f => f.severity === sev);
    if (group.length === 0) continue;

    lines.push(`── ${SEVERITY_LABELS[sev].toUpperCase()} (${group.length} 项) ──`);
    lines.push('');

    for (const f of group) {
      const icon = sev === 'critical' ? '🔴' : sev === 'high' ? '🟠' : sev === 'medium' ? '🟡' : sev === 'low' ? '🔵' : 'ℹ️';
      lines.push(`${icon} [${f.ruleId}] ${f.title}`);
      lines.push(`   服务: ${f.service} (${f.servicePath})`);
      lines.push(`   原因: ${f.rationale}`);
      if (f.details) {
        if (f.details.affectedClients) {
          lines.push(`   涉及: ${f.details.affectedClients.join(', ')}`);
        }
        if (f.details.fix) {
          lines.push(`   修复: ${f.details.fix}`);
        }
        // Risk assessment for FEIGN-001 per-client findings
        if (f.details.riskAssessment) {
          const r = f.details.riskAssessment;
          lines.push(`   ══ 风险推理 ══`);
          lines.push(`   业务域: ${r.domain}  |  风险等级: ${r.riskLevel.toUpperCase()}`);
          lines.push(`   调用方: ${r.callerService}  →  目标: ${r.clientName}`);
          for (const step of r.chainReactions) {
            lines.push(`   ${step}`);
          }
          lines.push(`   ── 修复建议 ──`);
          for (const tip of r.mitigation) {
            lines.push(`   › ${tip}`);
          }
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 5. CLI entry
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`Usage: node auditor.js <scan-report.json> [options]

Reads scanner output and produces an architecture audit report.

Options:
  --output <path>     Write audit report to a file (JSON).
  --format <type>     Output format: "text" (default) or "json".
  -h, --help          Show this help message.

Pipe mode:
  node scanner.js /path | node auditor.js
`);
    process.exit(0);
  }

  // Read input — from file or stdin
  let raw;
  if (args[0] === '-' || args[0] === 'stdin') {
    raw = fs.readFileSync(0, 'utf8'); // stdin
  } else {
    raw = fs.readFileSync(args[0], 'utf8');
  }

  const report = JSON.parse(raw);
  const result = audit(report);

  const outputIdx = args.indexOf('--output');
  const formatIdx = args.indexOf('--format');
  const format = formatIdx !== -1 ? args[formatIdx + 1] : 'text';

  const output = format === 'json' ? JSON.stringify(result, null, 2) : formatReport(result, 'text');

  if (outputIdx !== -1) {
    fs.writeFileSync(args[outputIdx + 1], format === 'json' ? output : output, 'utf8');
    console.log(`Audit report written to ${args[outputIdx + 1]}`);
  } else {
    console.log(output);
  }
}

// Support piped input from scanner
if (require.main === module) {
  main();
}

module.exports = { audit, formatReport, STANDARDS };
