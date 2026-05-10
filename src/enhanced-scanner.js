#!/usr/bin/env node

/**
 * AI-Arch-Guardian — Enhanced Scanner (Fixed)
 * 
 * 修复版：保留原始扫描器的 Feign 检测 + 增强功能
 *
 * 增强功能:
 * - 支持 application.properties 配置文件
 * - 检测继承的 @FeignClient 接口
 * - 检测动态 Feign 构建
 * - SpEL 占位符支持
 * - 环境检测
 */

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');
const yaml = require('js-yaml');
const { XMLParser } = require('fast-xml-parser');

// ============================================================================
// 1. 保持原有 Feign 解析逻辑 (来自原始 scanner.js)
// ============================================================================

function extractBalancedBlock(source, openParenIdx) {
  let depth = 1;
  let i = openParenIdx + 1;
  let inString = false;
  let stringChar = '';

  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === stringChar) inString = false;
    } else {
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
      }
    }
    i++;
  }

  if (depth !== 0) return null;
  return source.substring(openParenIdx + 1, i - 1);
}

function splitTopLevel(str, delimiter) {
  const result = [];
  let depth = 0;
  let last = 0;

  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(' || str[i] === '[' || str[i] === '{') depth++;
    else if (str[i] === ')' || str[i] === ']' || str[i] === '}') depth--;
    else if (str[i] === delimiter && depth === 0) {
      result.push(str.substring(last, i).trim());
      last = i + 1;
    }
  }

  result.push(str.substring(last).trim());
  return result.filter(s => s.length > 0);
}

function stripQuotes(str) {
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}

function parseAnnotationProps(content) {
  const props = {};
  const segments = splitTopLevel(content, ',');

  for (const seg of segments) {
    const eqIdx = seg.indexOf('=');
    if (eqIdx === -1) {
      const trimmed = seg.trim();
      if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        props.value = stripQuotes(trimmed);
      }
      continue;
    }

    const key = seg.substring(0, eqIdx).trim();
    let val = seg.substring(eqIdx + 1).trim();
    props[key] = stripQuotes(val);
  }

  return props;
}

// 原有的 parseFeignClients 函数 (来自 scanner.js)
function parseFeignClients(filePath) {
  const results = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const feignRegex = /@FeignClient\s*\(\s*/g;
    let match;

    while ((match = feignRegex.exec(raw)) !== null) {
      const startIdx = match.index + match[0].length - 1;
      const block = extractBalancedBlock(raw, startIdx);
      if (!block) continue;

      const props = parseAnnotationProps(block);

      results.push({
        name: props.name || props.value || null,
        path: props.path || null,
        url: props.url || null,
        contextId: props.contextId || null,
        fallback: props.fallback || null,
        fallbackFactory: props.fallbackFactory || null,
        configuration: props.configuration || null,
        qualifiers: props.qualifiers || null,
        primary: props.primary || null
      });
    }
  } catch {
    // Ignore
  }
  return results;
}

// ============================================================================
// 2. 新增: Properties 文件解析器
// ============================================================================

function parsePropertiesFile(filePath) {
  const result = { hasPlaceholders: false, properties: {} };

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;

      const key = trimmed.substring(0, eqIdx).trim();
      let value = trimmed.substring(eqIdx + 1).trim();

      if (value.includes('${')) {
        result.hasPlaceholders = true;
        const placeholderMatch = value.match(/\$\{([^:}]+)(?::([^}]+))?\}/);
        if (placeholderMatch) {
          value = { raw: value, key: placeholderMatch[1], defaultValue: placeholderMatch[2] || null, hasPlaceholder: true };
        }
      }

      result.properties[key] = value;
    }
  } catch (err) {
    console.warn(`Warning: Failed to parse properties: ${filePath}`);
  }

  return result;
}

// ============================================================================
// 3. YAML 和 Nacos 配置解析
// ============================================================================

function parseYamlFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const docs = yaml.loadAll(raw);
    return docs[0] || {};
  } catch {
    return {};
  }
}

function extractNacosConfig(yamlObj, propertiesObj) {
  const result = {};

  const yamlNacos = yamlObj?.spring?.cloud?.nacos;
  if (yamlNacos) {
    if (yamlNacos.discovery) {
      result.discoveryAddr = yamlNacos.discovery['server-addr'] || yamlNacos.discovery.serverAddr;
      result.discoveryNamespace = yamlNacos.discovery.namespace;
    }
    if (yamlNacos.config) {
      result.configAddr = yamlNacos.config['server-addr'] || yamlNacos.config.serverAddr;
      result.configNamespace = yamlNacos.config.namespace;
    }
  }

  // Properties override
  const propPrefix = 'spring.cloud.nacos.';
  for (const [key, value] of Object.entries(propertiesObj)) {
    if (typeof value === 'object' && value.hasPlaceholder) continue;
    if (key.startsWith(propPrefix + 'discovery.server-addr') && !result.discoveryAddr) result.discoveryAddr = value;
    if (key.startsWith(propPrefix + 'discovery.namespace') && !result.discoveryNamespace) result.discoveryNamespace = value;
    if (key.startsWith(propPrefix + 'config.server-addr') && !result.configAddr) result.configAddr = value;
    if (key.startsWith(propPrefix + 'config.namespace') && !result.configNamespace) result.configNamespace = value;
  }

  return result;
}

// ============================================================================
// 4. POM 解析
// ============================================================================

function parsePomXml(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const doc = parser.parse(raw);
    const deps = [];
    const project = doc.project;
    if (!project) return { deps };

    const rawDeps = project.dependencies && project.dependencies.dependency;
    if (rawDeps) {
      const list = Array.isArray(rawDeps) ? rawDeps : [rawDeps];
      for (const d of list) {
        const gid = (d.groupId || '').trim();
        const aid = (d.artifactId || '').trim();
        const ver = (d.version || '').trim();
        const scope = (d.scope || '').trim();
        if (aid) deps.push({ groupId: gid, artifactId: aid, version: ver, scope });
      }
    }

    return { deps };
  } catch {
    return { deps: [] };
  }
}

// ============================================================================
// 5. 环境检测
// ============================================================================

function detectEnvironment(nacosConfig) {
  const namespace = nacosConfig.discoveryNamespace || nacosConfig.configNamespace || '';
  const lower = namespace.toLowerCase();
  if (lower.includes('prod') || lower.includes('production')) return 'production';
  if (lower.includes('dev') || lower.includes('development')) return 'development';
  if (lower.includes('test') || lower.includes('qa')) return 'testing';
  return 'unknown';
}

// ============================================================================
// 6. 熔断器检测 (支持 Sentinel + Resilience4j)
// ============================================================================

function detectCircuitBreaker(pomDeps) {
  const allDeps = pomDeps.map(d => d.artifactId);
  const options = {
    sentinel: ['spring-cloud-starter-alibaba-sentinel', 'sentinel-core'],
    resilience4j: ['resilience4j-spring-boot3', 'resilience4j-spring-boot2', 'resilience4j-all'],
    hystrix: ['spring-cloud-starter-netflix-hystrix']
  };

  for (const [name, artifacts] of Object.entries(options)) {
    if (artifacts.some(a => allDeps.includes(a))) {
      return { provider: name, supported: true };
    }
  }
  return { provider: null, supported: false };
}

// ============================================================================
// 7. 继承检测 (新增)
// ============================================================================

function findInheritedFeignClients(dir) {
  const results = [];
  const javaFiles = globSync(`${dir}/**/*.java`);
  const interfaceMap = new Map();

  for (const file of javaFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(/interface\s+(\w+)/);
    if (match) interfaceMap.set(match[1], file);
  }

  for (const file of javaFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(/interface\s+\w+\s+extends\s+([\w,\s]+)/);
    if (match) {
      const parents = match[1].split(',').map(n => n.trim());
      for (const parent of parents) {
        const parentFile = interfaceMap.get(parent);
        if (parentFile && parentFile !== file) {
          const parentContent = fs.readFileSync(parentFile, 'utf8');
          if (parentContent.includes('@FeignClient')) {
            results.push({ child: file, parent: parentFile, interface: parent });
          }
        }
      }
    }
  }
  return results;
}

// ============================================================================
// 8. 扫描单个服务
// ============================================================================

function scanService(dir) {
  const service = { name: path.basename(dir), path: dir, warnings: [] };

  // POM
  const pomFiles = globSync(`${dir}/pom.xml`);
  if (pomFiles.length > 0) {
    const pom = parsePomXml(pomFiles[0]);
    service.pom = {
      groupId: pom.deps[0]?.groupId || 'unknown',
      hasOpenfeign: pom.deps.some(d => d.artifactId.includes('openfeign')),
      hasSentinel: pom.deps.some(d => d.artifactId.includes('sentinel')),
      hasHystrix: pom.deps.some(d => d.artifactId.includes('hystrix')),
      openfeignDeps: pom.deps.filter(d => d.artifactId.includes('openfeign')),
      nacosDiscoveryDeps: pom.deps.filter(d => d.artifactId.includes('nacos-discovery')),
      nacosConfigDeps: pom.deps.filter(d => d.artifactId.includes('nacos-config')),
      sentinelDeps: pom.deps.filter(d => d.artifactId.includes('sentinel')),
      hystrixDeps: pom.deps.filter(d => d.artifactId.includes('hystrix')),
      resilience4jDeps: pom.deps.filter(d => d.artifactId.includes('resilience4j')),
      allDeps: pom.deps
    };
    service.circuitBreaker = detectCircuitBreaker(pom.deps);
  }

  // YAML 配置
  const yamlFiles = globSync(`${dir}/**/application.yml`).concat(globSync(`${dir}/**/bootstrap.yml`));
  let nacosYaml = {};
  for (const file of yamlFiles) {
    const parsed = parseYamlFile(file);
    if (parsed?.spring?.cloud?.nacos) { nacosYaml = parsed; break; }
  }

  // Properties 配置
  const propFiles = globSync(`${dir}/**/application.properties`).concat(globSync(`${dir}/**/bootstrap.properties`));
  let propertiesConfig = { hasPlaceholders: false, properties: {} };
  for (const file of propFiles) {
    const parsed = parsePropertiesFile(file);
    if (Object.keys(parsed.properties).length > 0) {
      propertiesConfig = parsed;
      if (parsed.hasPlaceholders) service.warnings.push({ type: 'spel_placeholder', message: '配置包含 SpEL 占位符' });
      break;
    }
  }

  service.nacos = extractNacosConfig(nacosYaml, propertiesConfig);
  service.detectedEnvironment = detectEnvironment(service.nacos);

  // Java 文件 - @FeignClient (使用原有解析逻辑)
  const javaFiles = globSync(`${dir}/**/*.java`);
  const allFeignClients = [];

  for (const file of javaFiles) {
    const clients = parseFeignClients(file);
    if (clients.length > 0) {
      for (const client of clients) {
        client.file = path.relative(dir, file);
      }
      allFeignClients.push(...clients);
    }
  }

  // 继承检测
  const inherited = findInheritedFeignClients(dir);
  if (inherited.length > 0) {
    service.warnings.push({ type: 'inherited_feign', message: `发现 ${inherited.length} 个继承 @FeignClient 的接口` });
  }

  // 动态 Feign 检测
  for (const file of javaFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (/Feign\.builder\(\)|FeignClientBuilder|\.target\(/.test(content)) {
      service.warnings.push({ type: 'dynamic_feign', message: '检测到动态 Feign 客户端构建' });
      break;
    }
  }

  service.feignClients = allFeignClients;
  service.summary = {
    totalFeignClients: allFeignClients.length,
    feignWithFallback: allFeignClients.filter(c => c.fallback).length,
    feignWithFallbackFactory: allFeignClients.filter(c => c.fallbackFactory).length,
    feignWithoutFallback: allFeignClients.filter(c => !c.fallback && !c.fallbackFactory).length,
    feignFallbackConfigured: allFeignClients.some(c => c.fallback || c.fallbackFactory),
    hasCircuitBreaker: service.circuitBreaker?.supported || false,
    circuitBreakerProvider: service.circuitBreaker?.provider || 'none'
  };

  return service;
}

// ============================================================================
// 9. 主函数
// ============================================================================

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`
AI-Arch-Guardian — 增强版扫描器 (修复版)

用法:
  node src/enhanced-scanner.js <path-to-java-project> [--output result.json]

功能:
  - 支持 application.properties 配置
  - 继承的 @FeignClient 检测
  - 动态 Feign 构建检测
  - SpEL 占位符支持
  - 环境检测
  - Resilience4j 支持
`);
    process.exit(0);
  }

  const projectPath = path.resolve(args[0]);
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 ? path.resolve(args[outputIdx + 1]) : null;

  console.log(`Scanning: ${projectPath}`);

  const pomFiles = globSync(`${projectPath}/**/pom.xml`);
  const serviceDirs = [...new Set(pomFiles.map(f => path.dirname(f)))]
    .filter(d => !d.includes('node_modules'));

  console.log(`Found ${serviceDirs.length} modules`);

  const services = [];
  for (const dir of serviceDirs) {
    // Convert to absolute path
    const absDir = path.isAbsolute(dir) ? dir : path.resolve(dir);
    console.log(`  Scanning: ${path.basename(absDir)} (${absDir})`);
    services.push(scanService(absDir));
  }

  const globalSummary = {
    projectRoot: projectPath,
    totalModules: services.length,
    totalFeignClients: services.reduce((sum, s) => sum + s.summary.totalFeignClients, 0),
    feignWithFallback: services.reduce((sum, s) => sum + s.summary.feignWithFallback, 0),
    feignWithFallbackFactory: services.reduce((sum, s) => sum + s.summary.feignWithFallbackFactory, 0),
    feignWithoutFallback: services.reduce((sum, s) => sum + s.summary.feignWithoutFallback, 0),
    modulesWithNacosDiscovery: services.filter(s => s.pom?.nacosDiscoveryDeps?.length).length,
    modulesWithNacosConfig: services.filter(s => s.pom?.nacosConfigDeps?.length).length,
    modulesWithFeignFallbackMissing: services.filter(s => s.summary.feignWithoutFallback > 0).length,
    environment: {
      production: services.filter(s => s.detectedEnvironment === 'production').length,
      development: services.filter(s => s.detectedEnvironment === 'development').length,
      testing: services.filter(s => s.detectedEnvironment === 'testing').length,
      unknown: services.filter(s => s.detectedEnvironment === 'unknown').length
    },
    warnings: services.reduce((sum, s) => sum + s.warnings.length, 0)
  };

  const result = {
    projectRoot: projectPath,
    scanTime: new Date().toISOString(),
    services,
    globalSummary
  };

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nResults written to: ${outputPath}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main();