#!/usr/bin/env node

/**
 * AI-Arch-Guardian — Unified CLI
 *
 * Runs the full pipeline: scan → audit → report → patch
 *
 * Usage:
 *   node index.js /path/to/java-project
 *   node index.js /path/to/java-project --no-patch
 *   node index.js /path/to/java-project --output-dir ./my-report
 *   node index.js /path/to/java-project --debug
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { handleError, validateArgs, validatePath, ExitCode, formatError, throwError } = require('./src/errors.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function banner(text) {
  const line = '═'.repeat(60);
  return `\n${line}\n  ${text}\n${line}\n`;
}

function step(name) {
  console.log(`\n▶ ${name}...`);
}

function done(name, detail = '') {
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`
AI-Arch-Guardian — Java 微服务架构审计工具

Usage:
  node index.js <path-to-java-project> [options]

Pipeline: scan → audit → report → patch

Options:
  --no-patch           Skip auto-patching (only scan + audit + report).
  --output-dir <path>  Directory for output files (default: <project>/arch-guardian-output).
  --dry-run            Dry-run mode: show what WOULD be generated without writing files.
  --debug              Enable debug mode for detailed error output.
  -v, --version        Show version information.
  -h, --help           Show this help message.

Examples:
  node index.js ~/my-microservice-project
  node index.js ~/my-microservice-project --no-patch --output-dir ./audit-results
  node index.js ~/my-microservice-project --debug
`);
    process.exit(0);
  }

  // Validate arguments
  validateArgs(args, 1);

  const projectPath = path.resolve(args[0]);
  const noPatch = args.includes('--no-patch');
  const dryRun = args.includes('--dry-run');
  const debugMode = args.includes('--debug');

  // Validate project path
  validatePath(projectPath, 'SCANNER_001');

  const outputIdx = args.indexOf('--output-dir');
  const outputDir = outputIdx !== -1
    ? path.resolve(args[outputIdx + 1])
    : path.join(projectPath, 'arch-guardian-output');

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  const scriptDir = __dirname;

  const scanJson = path.join(outputDir, 'scan-result.json');
  const auditJson = path.join(outputDir, 'audit-result.json');
  const reportMd = path.join(projectPath, 'ARCH_AUDIT_REPORT.md');
  const patchDir = path.join(outputDir, 'patches');

  const startTime = Date.now();

  // ──────────────────────────────────────────────────────────────────────
  console.log(banner('AI-Arch-Guardian — 架构审计'));
  console.log(`  项目路径: ${projectPath}`);
  console.log(`  输出目录: ${outputDir}`);
  console.log(`  模式: ${dryRun ? '试运行' : '正式运行'}`);
  // ──────────────────────────────────────────────────────────────────────

  // Step 1 — Scan (增强版扫描器)
  step('Step 1/4 — 扫描项目 (增强版)');
  const scanStart = Date.now();
  try {
    execSync(`node "${path.join(scriptDir, 'src', 'enhanced-scanner.js')}" "${projectPath}" --output "${scanJson}"`, {
      stdio: 'pipe',
      timeout: 120000,
    });
    const scanDuration = ((Date.now() - scanStart) / 1000).toFixed(1);
    done('扫描完成', `${scanDuration}s (增强版)`);

    const scanReport = JSON.parse(fs.readFileSync(scanJson, 'utf8'));
    console.log(`     模块: ${scanReport.globalSummary.totalModules} 个`);
    console.log(`     Feign 接口: ${scanReport.globalSummary.totalFeignClients} 个`);
    console.log(`     未配置降级: ${scanReport.globalSummary.feignWithoutFallback} 个`);
    console.log(`     环境: ${Object.entries(scanReport.globalSummary.environment).filter(([_,v])=>v>0).map(([k,v])=>k+':'+v).join(', ')}`);
  } catch (err) {
    console.error(`  ✗ 扫描失败: ${err.message}`);
    if (debugMode && err.stack) {
      console.error('\n--- Debug Info ---');
      console.error(err.stack);
    }
    process.exit(ExitCode.SCAN_ERROR);
  }

  // Step 2 — Audit (使用增强版)
  step('Step 2/4 — 执行审计 (增强版)');
  const auditStart = Date.now();
  try {
    execSync(`node "${path.join(scriptDir, 'src', 'enhanced-auditor.js')}" "${scanJson}" --output "${auditJson}" --env production`, {
      stdio: 'pipe',
      timeout: 30000,
    });
    const auditDuration = ((Date.now() - auditStart) / 1000).toFixed(1);
    done('审计完成', `${auditDuration}s (增强版)`);

    const auditReport = JSON.parse(fs.readFileSync(auditJson, 'utf8'));
    console.log(`     评分: ${auditReport.summary.score}/100  |  等级: ${auditReport.summary.grade}`);
    console.log(`     问题: 严重 ${auditReport.summary.bySeverity.critical} | 高 ${auditReport.summary.bySeverity.high} | 中 ${auditReport.summary.bySeverity.medium}`);
  } catch (err) {
    console.error(`  ✗ 审计失败: ${err.message}`);
    if (debugMode && err.stack) {
      console.error('\n--- Debug Info ---');
      console.error(err.stack);
    }
    process.exit(ExitCode.AUDIT_ERROR);
  }

  // Step 3 — Report
  step('Step 3/4 — 生成报告');
  try {
    execSync(`node "${path.join(scriptDir, 'reporter.js')}" "${auditJson}" "${scanJson}" --output "${reportMd}"`, {
      stdio: 'pipe',
      timeout: 30000,
    });
    done('报告已生成', reportMd);
  } catch (err) {
    console.error(`  ✗ 报告生成失败: ${err.message}`);
    if (debugMode && err.stack) {
      console.error('\n--- Debug Info ---');
      console.error(err.stack);
    }
    // Report failure is not critical, continue
  }

  // Step 4 — Patch (optional)
  if (!noPatch) {
    step('Step 4/4 — 自动生成降级补丁');
    try {
      const patchCmd = dryRun
        ? `node "${path.join(scriptDir, 'patcher.js')}" "${auditJson}" "${projectPath}" --output-dir "${patchDir}"`
        : `node "${path.join(scriptDir, 'patcher.js')}" "${auditJson}" "${projectPath}" --output-dir "${patchDir}" --apply`;

      const patchOutput = execSync(patchCmd, {
        stdio: 'pipe',
        timeout: 30000,
      }).toString();

      if (dryRun) {
        // Patcher dry-run outputs JSON + trailing text; extract first JSON object
        const jsonEnd = patchOutput.lastIndexOf('}');
        const jsonStr = jsonEnd !== -1 ? patchOutput.substring(0, jsonEnd + 1) : patchOutput;
        const preview = JSON.parse(jsonStr);
        const patchCount = preview.patches ? preview.patches.length : 0;
        done(`试运行 — ${patchCount} 个补丁可生成`, `使用 --apply 模式正式写入`);
        if (patchCount > 0) {
          console.log(`\n  可生成的补丁预览:`);
          for (const p of preview.patches) {
            console.log(`    • ${p.fallbackClass}  ← ${p.interfaceName} (${p.service})`);
          }
        }
      } else {
        const generatedCount = patchOutput.split('\n').filter(l => l.trim().startsWith(path.sep) || l.includes('patches')).length;
        done('补丁已生成', `${patchDir}`);
        console.log(patchOutput);
      }
    } catch (err) {
      console.error(`  ✗ 补丁生成失败: ${err.message}`);
      if (debugMode && err.stack) {
        console.error('\n--- Debug Info ---');
        console.error(err.stack);
      }
      // Patch failure is not critical, continue
    }
  } else {
    console.log('\n  ⏭  跳过补丁生成 (--no-patch)');
  }

  // ──────────────────────────────────────────────────────────────────────
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(banner(`完成 — 耗时 ${totalDuration}s`));

  console.log(`
  输出文件:
    • 扫描结果:    ${scanJson}
    • 审计结果:    ${auditJson}
    • 审计报告:    ${reportMd}
    ${!noPatch ? `• 补丁文件:    ${patchDir}` : ''}

  下一步建议:
    ${dryRun ? '  1. 确认无误后，去掉 --dry-run 重新运行以生成补丁文件' : '  1. 查看 ARCH_AUDIT_REPORT.md 了解所有问题'}
    ${dryRun ? '' : `  2. 审查 ${patchDir}/ 下的自动生成代码`}
    ${dryRun ? '' : '  3. 将补丁文件合并到对应服务模块'}
    ${dryRun ? '' : '  4. 修改 @FeignClient 注解添加 fallback 引用'}
`);
}

main().catch(err => {
  console.error(`\n  ✗ 流水线异常: ${err.message}`);
  if (err.stack) {
    console.error('\n--- Stack Trace ---');
    console.error(err.stack);
  }
  process.exit(ExitCode.GENERAL_ERROR);
});
