import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, 'fixtures', 'java-project');
const scannerPath = path.join(__dirname, '..', 'scanner.js');

// Mock scanner module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
  };
});

describe('Scanner Module Tests', () => {
  describe('parseYamlFile', () => {
    it('should parse valid YAML file', async () => {
      const scanner = await import(scannerPath);
      const yamlPath = path.join(projectRoot, 'src', 'main', 'resources', 'application.yml');
      const result = scanner.parseYamlFile(yamlPath);
      expect(result).toBeDefined();
    });

    it('should return empty object for invalid YAML', async () => {
      const scanner = await import(scannerPath);
      const result = scanner.parseYamlFile('/nonexistent/file.yml');
      expect(result).toEqual({});
    });
  });

  describe('extractNacosConfig', () => {
    it('should extract Nacos discovery config', async () => {
      const scanner = await import(scannerPath);
      const yamlObj = {
        spring: {
          cloud: {
            nacos: {
              discovery: {
                'server-addr': 'localhost:8848',
                namespace: 'dev'
              }
            }
          }
        }
      };
      const result = scanner.extractNacosConfig(yamlObj);
      expect(result.discoveryAddr).toBe('localhost:8848');
      expect(result.discoveryNamespace).toBe('dev');
    });

    it('should extract Nacos config center config', async () => {
      const scanner = await import(scannerPath);
      const yamlObj = {
        spring: {
          cloud: {
            nacos: {
              config: {
                'server-addr': 'localhost:8848',
                namespace: 'prod-config'
              }
            }
          }
        }
      };
      const result = scanner.extractNacosConfig(yamlObj);
      expect(result.configAddr).toBe('localhost:8848');
      expect(result.configNamespace).toBe('prod-config');
    });

    it('should handle camelCase and kebab-case keys', async () => {
      const scanner = await import(scannerPath);
      const yamlObj = {
        spring: {
          cloud: {
            nacos: {
              discovery: {
                serverAddr: 'localhost:8848',
                namespace: 'test'
              }
            }
          }
        }
      };
      const result = scanner.extractNacosConfig(yamlObj);
      expect(result.discoveryAddr).toBe('localhost:8848');
    });

    it('should return empty object for no Nacos config', async () => {
      const scanner = await import(scannerPath);
      const result = scanner.extractNacosConfig({});
      expect(result).toEqual({});
    });
  });

  describe('extractFeignClients', () => {
    it('should extract @FeignClient annotations', async () => {
      const scanner = await import(scannerPath);
      const javaFile = path.join(projectRoot, 'src', 'main', 'java', 'com', 'example', 'client', 'ProductClient.java');
      const result = scanner.extractFeignClients(javaFile);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should parse fallback and fallbackFactory attributes', async () => {
      const scanner = await import(scannerPath);
      const content = `
        @FeignClient(name = "test", fallback = TestFallback.class)
        public interface TestClient {}
      `;
      const result = scanner.parseFeignAnnotation(content);
      expect(result.name).toBe('test');
      expect(result.fallback).toBe('TestFallback.class');
    });
  });
});

describe('Scanner Integration Tests', () => {
  const outputFile = path.join(__dirname, 'fixtures', 'test-output.json');

  afterEach(() => {
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }
  });

  it('should run scanner on fixture project', async () => {
    const { execSync } = await import('child_process');
    const result = execSync(`node ${scannerPath} "${projectRoot}" --output "${outputFile}"`, {
      encoding: 'utf8',
      timeout: 30000
    });

    expect(fs.existsSync(outputFile)).toBe(true);

    const scanResult = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    expect(scanResult.services).toBeDefined();
    expect(scanResult.globalSummary).toBeDefined();
  });
});