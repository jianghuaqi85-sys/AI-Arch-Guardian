import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mockAuditResult = {
  services: [
    {
      moduleName: 'demo-service',
      feignClients: [
        {
          interfaceName: 'ProductClient',
          filePath: '/test/ProductClient.java',
          annotation: { name: 'product-service' },
          methods: [
            { name: 'getProduct', returnType: 'Product', params: [{ type: 'Long', name: 'id' }] },
            { name: 'getAllProducts', returnType: 'List<Product>', params: [] }
          ]
        }
      ]
    }
  ],
  findings: [
    {
      service: 'demo-service',
      ruleId: 'FEIGN-001',
      severity: 'critical'
    }
  ]
};

describe('Patcher Module Tests', () => {
  describe('Java Interface Parsing', () => {
    let patcher;
    beforeEach(async () => {
      const patcherPath = path.join(__dirname, '..', 'patcher.js');
      patcher = await import(patcherPath);
    });

    it('should parse package declaration', () => {
      const javaCode = `
        package com.example.client;
        public interface ProductClient {}
      `;
      const result = patcher.parseJavaInterface('/test/ProductClient.java');
      expect(result.package).toBe('com.example.client');
    });

    it('should parse imports', () => {
      const javaCode = `
        package com.example.client;
        import org.springframework.cloud.openfeign.FeignClient;
        import org.springframework.web.bind.annotation.GetMapping;
        public interface ProductClient {}
      `;
      const result = patcher.parseJavaInterface('/test/ProductClient.java');
      expect(result.imports).toContain('org.springframework.cloud.openfeign.FeignClient');
    });

    it('should parse @FeignClient annotation', () => {
      const javaCode = `
        package com.example.client;
        @FeignClient(name = "product-service", url = "http://localhost:8080")
        public interface ProductClient {}
      `;
      const result = patcher.parseJavaInterface('/test/ProductClient.java');
      expect(result.feignAnnotation.name).toBe('product-service');
      expect(result.feignAnnotation.url).toBe('http://localhost:8080');
    });

    it('should parse interface name', () => {
      const javaCode = `package com.example; public interface TestClient {}`;
      const result = patcher.parseJavaInterface('/test/TestClient.java');
      expect(result.interfaceName).toBe('TestClient');
    });

    it('should parse method signatures', () => {
      const javaCode = `
        package com.example;
        public interface TestClient {
          Product getProduct(Long id);
          List<Product> getAllProducts();
        }
      `;
      const result = patcher.parseJavaInterface('/test/TestClient.java');
      expect(result.methods).toHaveLength(2);
      expect(result.methods[0].name).toBe('getProduct');
      expect(result.methods[0].returnType).toBe('Product');
    });
  });

  describe('Fallback Generation', () => {
    let patcher;
    beforeEach(async () => {
      const patcherPath = path.join(__dirname, '..', 'patcher.js');
      patcher = await import(patcherPath);
    });

    it('should generate fallback class', () => {
      const parsed = {
        package: 'com.example.client',
        interfaceName: 'ProductClient',
        methods: [
          { name: 'getProduct', returnType: 'Product', params: [{ type: 'Long', name: 'id' }] },
          { name: 'getAllProducts', returnType: 'List<Product>', params: [] }
        ]
      };
      const fallback = patcher.generateFallback(parsed);
      expect(fallback).toContain('ProductClientFallback');
      expect(fallback).toContain('implements ProductClient');
      expect(fallback).toContain('@Component');
    });

    it('should handle void return type', () => {
      const parsed = {
        package: 'com.example',
        interfaceName: 'TestClient',
        methods: [{ name: 'delete', returnType: 'void', params: [] }]
      };
      const fallback = patcher.generateFallback(parsed);
      expect(fallback).toContain('void');
    });

    it('should handle generic return types', () => {
      const parsed = {
        package: 'com.example',
        interfaceName: 'TestClient',
        methods: [{ name: 'list', returnType: 'List<Product>', params: [] }]
      };
      const fallback = patcher.generateFallback(parsed);
      expect(fallback).toContain('List<Product>');
      expect(fallback).toContain('Collections.emptyList()');
    });
  });

  describe('Patch Generation', () => {
    let patcher;
    beforeEach(async () => {
      const patcherPath = path.join(__dirname, '..', 'patcher.js');
      patcher = await import(patcherPath);
    });

    it('should generate annotation patch', () => {
      const oldAnnotation = { name: 'product-service' };
      const newAnnotation = { name: 'product-service', fallback: 'ProductFallback.class' };
      const patch = patcher.generateAnnotationPatch(oldAnnotation, newAnnotation);
      expect(patch).toContain('fallback');
    });
  });
});