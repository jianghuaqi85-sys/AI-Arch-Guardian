import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock audit result for testing
const mockAuditResult = {
  standardsVersion: 'Spring Cloud Alibaba 2022.x',
  projectRoot: '/test/project',
  findings: [
    {
      service: 'demo-service',
      ruleId: 'NACOS-001',
      category: 'nacos',
      severity: 'critical',
      title: 'Nacos 命名空间必须配置',
      message: '服务 demo-service 未配置 Nacos 命名空间',
      location: '/test/project/pom.xml'
    },
    {
      service: 'demo-service',
      ruleId: 'FEIGN-001',
      category: 'openfeign',
      severity: 'critical',
      title: '@FeignClient 必须配置 fallback',
      message: 'ProductClient 未配置降级处理',
      location: '/test/project/src/main/java/ProductClient.java'
    }
  ],
  summary: {
    score: 65,
    grade: 'C',
    totalFindings: 2,
    bySeverity: {
      critical: 2,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    },
    byCategory: {
      nacos: 1,
      openfeign: 1
    }
  }
};

const mockScanReport = {
  projectRoot: '/test/project',
  globalSummary: {
    totalModules: 1,
    totalFeignClients: 1,
    feignWithoutFallback: 1
  }
};

describe('Reporter Module Tests', () => {
  describe('Report Generation', () => {
    let reporter;
    beforeEach(async () => {
      const reporterPath = path.join(__dirname, '..', 'reporter.js');
      reporter = await import(reporterPath);
    });

    it('should generate markdown report', () => {
      const report = reporter.generateReport(mockAuditResult, mockScanReport);
      expect(report).toBeDefined();
      expect(typeof report).toBe('string');
      expect(report).toContain('AI-Arch-Guardian');
      expect(report).toContain('架构审计报告');
    });

    it('should include summary section', () => {
      const report = reporter.generateReport(mockAuditResult, mockScanReport);
      expect(report).toContain('总体评估');
      expect(report).toContain('65');
      expect(report).toContain('C');
    });

    it('should include findings by severity', () => {
      const report = reporter.generateReport(mockAuditResult, mockScanReport);
      expect(report).toContain('critical');
      expect(report).toContain('2');
    });

    it('should include findings by category', () => {
      const report = reporter.generateReport(mockAuditResult, mockScanReport);
      expect(report).toContain('Nacos');
      expect(report).toContain('OpenFeign');
    });

    it('should format severity with correct emoji', () => {
      const report = reporter.generateReport(mockAuditResult, mockScanReport);
      // Critical should show red indicator
      expect(report).toContain('严重');
    });
  });

  describe('CLI Integration', () => {
    const auditFile = path.join(__dirname, 'fixtures', 'mock-audit.json');
    const scanFile = path.join(__dirname, 'fixtures', 'mock-scan.json');
    const reportFile = path.join(__dirname, 'fixtures', 'mock-report.md');

    beforeEach(() => {
      fs.writeFileSync(auditFile, JSON.stringify(mockAuditResult, null, 2));
      fs.writeFileSync(scanFile, JSON.stringify(mockScanReport, null, 2));
    });

    afterEach(() => {
      [auditFile, scanFile, reportFile].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    });

    it('should generate report from audit result', async () => {
      const { execSync } = await import('child_process');
      execSync(`node ${path.join(__dirname, '..', 'reporter.js')} "${auditFile}" "${scanFile}" --output "${reportFile}"`, {
        encoding: 'utf8',
        timeout: 30000
      });

      expect(fs.existsSync(reportFile)).toBe(true);
      const report = fs.readFileSync(reportFile, 'utf8');
      expect(report).toContain('AI-Arch-Guardian');
    });
  });
});