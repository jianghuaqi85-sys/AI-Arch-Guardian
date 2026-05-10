#!/usr/bin/env node

/**
 * AI-Arch-Guardian — Reporter
 *
 * Generates a formatted ARCH_AUDIT_REPORT.md from audit results.
 *
 * Usage:
 *   node reporter.js <audit-report.json> [--output ARCH_AUDIT_REPORT.md]
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

/**
 * @param {Object} auditResult — output from auditor.js
 * @param {Object} scanReport — optional, from scanner.js (for richer context)
 * @returns {string} Markdown report
 */
function generateReport(auditResult, scanReport) {
  const { findings, summary, standardsVersion } = auditResult;
  const projectRoot = scanReport ? scanReport.projectRoot : 'N/A';
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const lines = [];

  // ── Header ──
  lines.push(`# AI-Arch-Guardian 架构审计报告`);
  lines.push('');
  lines.push(`> 生成时间：${now}  `);
  lines.push(`> 审计标准：${standardsVersion}  `);
  lines.push(`> 项目路径：\`${projectRoot}\`  `);
  lines.push('');

  // ── Executive Summary ──
  lines.push('---');
  lines.push('');
  lines.push('## 一、总体评估');
  lines.push('');
  const gradeEmoji =
    summary.grade.startsWith('A') ? '🟢' :
    summary.grade.startsWith('B') ? '🟢' :
    summary.grade.startsWith('C') ? '🟡' :
    summary.grade.startsWith('D') ? '🟠' : '🔴';

  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|----|`);
  lines.push(`| **综合评分** | **${summary.score} / 100** |`);
  lines.push(`| **等级** | ${gradeEmoji} **${summary.grade}** |`);
  lines.push(`| 发现问题总数 | ${summary.totalFindings} |`);
  lines.push(`| 🔴 严重 | ${summary.bySeverity.critical} |`);
  lines.push(`| 🟠 高 | ${summary.bySeverity.high} |`);
  lines.push(`| 🟡 中 | ${summary.bySeverity.medium} |`);
  lines.push(`| 🔵 低 | ${summary.bySeverity.low} |`);
  lines.push(`| ℹ️ 建议 | ${summary.bySeverity.info} |`);
  lines.push('');

  if (summary.byCategory) {
    lines.push('### 按类别分布');
    lines.push('');
    const catLabels = {
      nacos: 'Nacos 注册/配置中心',
      openfeign: 'OpenFeign 熔断降级',
      sentinel: 'Sentinel 流控降级',
      hystrix: 'Hystrix 迁移',
    };
    for (const [cat, count] of Object.entries(summary.byCategory)) {
      lines.push(`- ${catLabels[cat] || cat}：**${count}** 项`);
    }
    lines.push('');
  }

  // ── Global Snapshot (from scanner) ──
  if (scanReport && scanReport.globalSummary) {
    const gs = scanReport.globalSummary;
    lines.push('### 项目快照');
    lines.push('');
    lines.push(`| 指标 | 值 |`);
    lines.push(`|------|----|`);
    lines.push(`| 微服务模块数 | ${gs.totalModules} |`);
    lines.push(`| Feign 客户端总数 | ${gs.totalFeignClients} |`);
    lines.push(`| 已配置 fallback | ${gs.feignWithFallback} |`);
    lines.push(`| 已配置 fallbackFactory | ${gs.feignWithFallbackFactory} |`);
    lines.push(`| 未配置降级 | ${gs.feignWithoutFallback} |`);
    lines.push(`| 已接入 Nacos 服务发现 | ${gs.modulesWithNacosDiscovery} |`);
    lines.push(`| 已接入 Nacos 配置中心 | ${gs.modulesWithNacosConfig} |`);
    lines.push('');
  }

  // ── Findings ──
  lines.push('---');
  lines.push('');
  lines.push('## 二、不合规项详情');
  lines.push('');

  if (findings.length === 0) {
    lines.push('✅ 未发现不合规项，项目架构符合 Spring Cloud Alibaba 生产最佳实践。');
    lines.push('');
    return lines.join('\n');
  }

  // Group findings by service
  const byService = new Map();
  const feignPerClientFindings = []; // FEIGN-001 per-client findings (handled separately)

  for (const f of findings) {
    // Separate per-client FEIGN-001 from module-level FEIGN-001
    if (f.ruleId === 'FEIGN-001' && f.details && f.details.riskAssessment) {
      feignPerClientFindings.push(f);
    } else {
      if (!byService.has(f.service)) byService.set(f.service, []);
      byService.get(f.service).push(f);
    }
  }

  // Per-service findings
  for (const [svcName, svcFindings] of byService) {
    lines.push(`### ${svcName}`);
    lines.push('');
    for (const f of svcFindings) {
      const sevLabel = { critical: '🔴 严重', high: '🟠 高', medium: '🟡 中', low: '🔵 低', info: 'ℹ️ 建议' };
      lines.push(`#### ${sevLabel[f.severity]} — ${f.title} \`[${f.ruleId}]\``);
      lines.push('');
      lines.push(`**原因**：${f.rationale}`);
      lines.push('');
      if (f.details) {
        if (f.details.affectedClients) {
          lines.push('**涉及的 Feign 接口**：');
          for (const c of f.details.affectedClients) {
            lines.push(`- \`${c}\``);
          }
          lines.push('');
        }
        if (f.details.currentNamespace !== undefined) {
          lines.push(`- 当前命名空间：\`${f.details.currentNamespace}\``);
        }
        if (f.details.currentAddr) {
          lines.push(`- 当前地址：\`${f.details.currentAddr}\``);
        }
        if (f.details.discoveryNamespace && f.details.configNamespace) {
          lines.push(`- 发现命名空间：\`${f.details.discoveryNamespace}\`，配置命名空间：\`${f.details.configNamespace}\``);
        }
        if (f.details.fix) {
          lines.push('');
          lines.push(`**修复建议**：${f.details.fix}`);
        }
        lines.push('');
      }
    }
  }

  // ── FeignClient Risk Assessment ──
  if (feignPerClientFindings.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 三、Feign 降级缺失 — 风险评估与修复方案');
    lines.push('');

    for (const f of feignPerClientFindings) {
      const r = f.details.riskAssessment;
      const riskIcon = r.riskLevel === 'critical' ? '🔴' : r.riskLevel === 'high' ? '🟠' : r.riskLevel === 'medium' ? '🟡' : '🔵';
      lines.push(`### ${riskIcon} ${r.clientName}`);
      lines.push('');
      lines.push(`| 属性 | 值 |`);
      lines.push(`|------|----|`);
      lines.push(`| 调用方服务 | \`${r.callerService}\` |`);
      lines.push(`| 目标接口 | \`${r.clientName}\` |`);
      lines.push(`| 业务域 | ${r.domain} |`);
      lines.push(`| 风险等级 | **${r.riskLevel.toUpperCase()}** |`);
      lines.push(`| 源文件 | \`${f.details.feignClient.file}\` |`);
      lines.push('');

      lines.push('#### 雪崩链路分析');
      lines.push('');
      for (const step of r.chainReactions) {
        lines.push(`> ${step}`);
      }
      lines.push('');

      lines.push('#### 修复步骤');
      lines.push('');
      for (let i = 0; i < r.mitigation.length; i++) {
        lines.push(`${i + 1}. ${r.mitigation[i]}`);
      }
      lines.push('');
    }
  }

  // ── Service Details (from scanner) ──
  if (scanReport && scanReport.services) {
    lines.push('---');
    lines.push('');
    lines.push('## 四、服务配置详情');
    lines.push('');

    for (const svc of scanReport.services) {
      const statusIcon = svc.summary.feignFallbackMissing ? '⚠️' : '✅';
      lines.push(`### ${statusIcon} ${svc.name}`);
      lines.push('');
      lines.push(`| 配置项 | 值 |`);
      lines.push(`|--------|----|`);
      lines.push(`| OpenFeign | ${svc.pom.hasOpenfeign ? '✅' : '❌'} |`);
      lines.push(`| Sentinel | ${svc.pom.hasSentinel ? '✅' : '❌'} |`);
      lines.push(`| Hystrix（应迁移） | ${svc.pom.hasHystrix ? '⚠️' : '✅ 无'} |`);
      lines.push(`| Nacos 服务发现 | ${svc.nacos.discoveryAddr || '—'}${svc.nacos.discoveryNamespace ? ' (ns: ' + svc.nacos.discoveryNamespace + ')' : ''} |`);
      lines.push(`| Nacos 配置中心 | ${svc.nacos.configAddr || '—'}${svc.nacos.configNamespace ? ' (ns: ' + svc.nacos.configNamespace + ')' : ''} |`);
      lines.push(`| Feign 接口总数 | ${svc.summary.totalFeignClients} |`);
      lines.push(`| 有 fallback | ${svc.summary.feignWithFallback} |`);
      lines.push(`| 有 fallbackFactory | ${svc.summary.feignWithFallbackFactory} |`);
      lines.push(`| 无降级 | ${svc.summary.feignWithoutFallback} |`);
      lines.push('');

      if (svc.feignClients.length > 0) {
        lines.push('<details>');
        lines.push('<summary>Feign 接口清单</summary>');
        lines.push('');
        lines.push('| 接口名 | Path | Fallback | FallbackFactory |');
        lines.push('|--------|------|----------|----------------|');
        for (const c of svc.feignClients) {
          const fb = c.fallback ? `\`${c.fallback}\`` : '—';
          const fbf = c.fallbackFactory ? `\`${c.fallbackFactory}\`` : '—';
          lines.push(`| \`${c.name || '—'}\` | \`${c.path || '—'}\` | ${fb} | ${fbf} |`);
        }
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }
    }
  }

  // ── Appendix ──
  lines.push('---');
  lines.push('');
  lines.push('## 附录：审计标准说明');
  lines.push('');
  lines.push('本报告基于以下标准生成：');
  lines.push('');
  lines.push('| 规则编号 | 类别 | 严重度 | 说明 |');
  lines.push('|----------|------|--------|------|');
  lines.push('| NACOS-001 | Nacos | 🔴 严重 | 命名空间必须配置，禁止使用空/public namespace |');
  lines.push('| NACOS-002 | Nacos | 🟠 高 | 配置中心与服务发现推荐使用独立命名空间 |');
  lines.push('| NACOS-003 | Nacos | 🟠 高 | server-addr 不得为 localhost/127.0.0.1（生产环境） |');
  lines.push('| NACOS-004 | Nacos | 🔵 低 | 建议启用 Nacos 认证（username/password） |');
  lines.push('| FEIGN-001 | OpenFeign | 🔴 严重 | 每个 @FeignClient 必须配置 fallback/fallbackFactory |');
  lines.push('| FEIGN-002 | OpenFeign | 🟠 高 | Sentinel 依赖必须显式声明 |');
  lines.push('| FEIGN-003 | OpenFeign | 🟡 中 | fallback 类应有独立、语义化的命名 |');
  lines.push('| HYSTRIX-001 | Hystrix | 🟠 高 | Hystrix 已停维，必须迁移至 Sentinel |');
  lines.push('');

  lines.push('---');
  lines.push(`*由 AI-Arch-Guardian 自动生成 — ${now}*`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`Usage: node reporter.js <audit-report.json> [scan-report.json] [--output PATH]

Generates ARCH_AUDIT_REPORT.md from audit results.
Optionally include the scanner report for richer context.

Options:
  --output <path>   Write report to a file (default: ARCH_AUDIT_REPORT.md).
  -h, --help        Show this help message.
`);
    process.exit(0);
  }

  const auditPath = args[0];
  let scanPath = null;

  // Check if second positional arg is a file (not a flag)
  if (args[1] && !args[1].startsWith('--')) {
    scanPath = args[1];
  }

  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : 'ARCH_AUDIT_REPORT.md';

  const auditRaw = fs.readFileSync(auditPath, 'utf8');
  const auditResult = JSON.parse(auditRaw);

  let scanReport = null;
  if (scanPath) {
    try {
      scanReport = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
    } catch { /* optional */ }
  }

  const md = generateReport(auditResult, scanReport);
  fs.writeFileSync(outputPath, md, 'utf8');
  console.log(`Report written to ${path.resolve(outputPath)}`);
}

if (require.main === module) {
  main();
}

module.exports = { generateReport };
