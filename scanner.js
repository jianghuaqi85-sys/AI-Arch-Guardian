#!/usr/bin/env node

/**
 * AI-Arch-Guardian — Scanner
 *
 * Recursively traverses a Java microservice project directory and extracts:
 *   1. OpenFeign @FeignClient annotations — fallback / fallbackFactory config
 *   2. Nacos configuration from bootstrap.yml / application.yml
 *   3. pom.xml dependencies (spring-cloud-starter-openfeign, sentinel, hystrix)
 *
 * Usage:
 *   node scanner.js <path-to-java-project>
 *   node scanner.js <path> --output result.json
 */

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');
const yaml = require('js-yaml');
const { XMLParser } = require('fast-xml-parser');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a single YAML file (bootstrap.yml / application.yml). */
function parseYamlFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    // js-yaml can parse multiple documents; we only need the first.
    const docs = yaml.loadAll(raw);
    return docs[0] || {};
  } catch {
    return {};
  }
}

/** Extract Nacos config from a parsed Spring Boot YAML object. */
function extractNacosConfig(yamlObj) {
  const result = {};

  const spring = yamlObj && yamlObj.spring;
  if (!spring) return result;

  const cloud = spring.cloud;
  if (!cloud) return result;

  const nacos = cloud.nacos;
  if (!nacos) return result;

  // discovery
  if (nacos.discovery) {
    if (nacos.discovery['server-addr'] !== undefined) {
      result.discoveryAddr = nacos.discovery['server-addr'];
    } else if (nacos.discovery.serverAddr !== undefined) {
      result.discoveryAddr = nacos.discovery.serverAddr;
    }
    if (nacos.discovery.namespace !== undefined) {
      result.discoveryNamespace = nacos.discovery.namespace;
    }
  }

  // config
  if (nacos.config) {
    if (nacos.config['server-addr'] !== undefined) {
      result.configAddr = nacos.config['server-addr'];
    } else if (nacos.config.serverAddr !== undefined) {
      result.configAddr = nacos.config.serverAddr;
    }
    if (nacos.config.namespace !== undefined) {
      result.configNamespace = nacos.config.namespace;
    }
  }

  // top-level server-addr / namespace (some projects configure this way)
  if (!result.discoveryAddr && nacos['server-addr'] !== undefined) {
    result.discoveryAddr = nacos['server-addr'];
  }
  if (!result.configAddr && nacos['config-server-addr'] !== undefined) {
    result.configAddr = nacos['config-server-addr'];
  }

  return result;
}

/** Parse a pom.xml and extract OpenFeign/Hystrix/Sentinel dependency info. */
function parsePomXml(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const doc = parser.parse(raw);

    const deps = [];
    const plugins = [];

    const project = doc.project;
    if (!project) return { deps, plugins };

    // dependencies
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

    // dependencyManagement
    const dm = project.dependencyManagement && project.dependencyManagement.dependencies && project.dependencyManagement.dependencies.dependency;
    if (dm) {
      const list = Array.isArray(dm) ? dm : [dm];
      for (const d of list) {
        const gid = (d.groupId || '').trim();
        const aid = (d.artifactId || '').trim();
        const ver = (d.version || '').trim();
        if (aid && !deps.some(x => x.artifactId === aid && x.groupId === gid)) {
          deps.push({ groupId: gid, artifactId: aid, version: ver, isManaged: true });
        }
      }
    }

    // plugins
    const rawPlugins = project.build && project.build.plugins && project.build.plugins.plugin;
    if (rawPlugins) {
      const list = Array.isArray(rawPlugins) ? rawPlugins : [rawPlugins];
      for (const p of list) {
        const gid = (p.groupId || '').trim();
        const aid = (p.artifactId || '').trim();
        if (aid) plugins.push({ groupId: gid, artifactId: aid });
      }
    }

    return { deps, plugins };
  } catch {
    return { deps: [], plugins: [] };
  }
}

/**
 * Scan a single Java source file for @FeignClient annotations.
 * Returns an array of extracted annotation details.
 *
 * Regex strategy:
 *   Match @FeignClient(...) across multiple lines, then extract key-value pairs.
 */
function parseFeignClients(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const results = [];

    // Match @FeignClient annotation block — handles multi-line, nested parens.
    // Strategy: find '@FeignClient', then balance parentheses.
    const feignRegex = /@FeignClient\s*\(\s*/g;
    let match;

    while ((match = feignRegex.exec(raw)) !== null) {
      const startIdx = match.index + match[0].length - 1; // position of opening '('
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
        primary: props.primary || null,
      });
    }

    return results;
  } catch {
    return [];
  }
}

/** Extract the balanced parentheses block starting at openParenIdx. */
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

  if (depth !== 0) return null; // unbalanced
  return source.substring(openParenIdx + 1, i - 1);
}

/** Parse key = value pairs from an annotation content string. */
function parseAnnotationProps(content) {
  const props = {};
  // Split on top-level commas (not inside braces/parens)
  const segments = splitTopLevel(content, ',');

  for (const seg of segments) {
    const eqIdx = seg.indexOf('=');
    if (eqIdx === -1) {
      // Implicit 'value' attribute: @FeignClient("name") or @FeignClient(name="x")
      const trimmed = seg.trim();
      if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        props.value = stripQuotes(trimmed);
      }
      continue;
    }

    const key = seg.substring(0, eqIdx).trim();
    let val = seg.substring(eqIdx + 1).trim();

    // Handle class literal: SomeClass.class → strip to class name
    if (val.endsWith('.class')) {
      val = val.slice(0, -6).trim();
    } else if (val.startsWith('{')) {
      // Inline array/object — preserve raw
    } else {
      val = stripQuotes(val);
    }

    props[key] = val;
  }

  return props;
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Split a string by a delimiter, respecting nested brackets and strings. */
function splitTopLevel(str, delim) {
  const parts = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (inString) {
      current += ch;
      if (ch === '\\') { current += str[i + 1] || ''; i++; continue; }
      if (ch === stringChar) inString = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }

    if (ch === '(' || ch === '{' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
    }

    if (ch === delim && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

function scan(targetPath) {
  const absRoot = path.resolve(targetPath);

  if (!fs.existsSync(absRoot)) {
    console.error(`Error: path not found — ${absRoot}`);
    process.exit(1);
  }

  if (!fs.statSync(absRoot).isDirectory()) {
    console.error(`Error: path is not a directory — ${absRoot}`);
    process.exit(1);
  }

  // 1. Find all relevant files
  const pomFiles = globSync('**/pom.xml', { cwd: absRoot, absolute: true, ignore: '**/node_modules/**' });
  const yamlFiles = globSync('**/{bootstrap,application}.yml', { cwd: absRoot, absolute: true, ignore: '**/node_modules/**' });
  const javaFiles = globSync('**/*.java', { cwd: absRoot, absolute: true, ignore: '**/node_modules/**' });

  // 2. Group pom.xml files by module (directory)
  const modules = new Map(); // dirPath → { pom, yamls: [], feignClients: [] }

  for (const pomPath of pomFiles) {
    const dir = path.dirname(pomPath);
    if (!modules.has(dir)) {
      modules.set(dir, { name: path.basename(dir), dir, pomPath, yamls: [], nacos: {}, feignClients: [] });
    }
  }

  // 3. Parse pom.xml files
  for (const [dir, mod] of modules) {
    const parsed = parsePomXml(mod.pomPath);

    const openfeign = parsed.deps.filter(d =>
      d.artifactId === 'spring-cloud-starter-openfeign' ||
      d.artifactId === 'feign-core' ||
      d.artifactId === 'feign-hystrix'
    );

    const sentinel = parsed.deps.filter(d =>
      d.artifactId === 'spring-cloud-starter-alibaba-sentinel' ||
      d.artifactId === 'sentinel-core' ||
      d.artifactId === 'spring-cloud-alibaba-sentinel'
    );

    const hystrix = parsed.deps.filter(d =>
      d.artifactId === 'spring-cloud-starter-netflix-hystrix' ||
      d.artifactId === 'hystrix-core'
    );

    const nacosDiscovery = parsed.deps.filter(d =>
      d.artifactId === 'spring-cloud-starter-alibaba-nacos-discovery'
    );

    const nacosConfig = parsed.deps.filter(d =>
      d.artifactId === 'spring-cloud-starter-alibaba-nacos-config'
    );

    mod.pom = {
      openfeign,
      sentinel,
      hystrix,
      nacosDiscovery,
      nacosConfig,
      allDeps: parsed.deps,
    };
  }

  /** Walk up the directory tree to find the nearest ancestor module. */
  function findAncestorModule(filePath) {
    let dir = path.dirname(filePath);
    while (dir !== absRoot && dir !== path.parse(dir).root) {
      const m = modules.get(dir);
      if (m) return m;
      dir = path.dirname(dir);
    }
    return modules.get(dir) || null;
  }

  // 4. Parse YAML files (bootstrap.yml, application.yml)
  for (const yamlPath of yamlFiles) {
    const mod = findAncestorModule(yamlPath);
    const yamlObj = parseYamlFile(yamlPath);
    const nacos = extractNacosConfig(yamlObj);
    const entry = {
      file: path.relative(absRoot, yamlPath),
      filename: path.basename(yamlPath),
      nacos,
    };

    if (mod) {
      mod.yamls.push(entry);
      // Merge nacos config — first non-empty values win
      if (!mod.nacos.discoveryAddr && nacos.discoveryAddr) mod.nacos.discoveryAddr = nacos.discoveryAddr;
      if (!mod.nacos.discoveryNamespace && nacos.discoveryNamespace) mod.nacos.discoveryNamespace = nacos.discoveryNamespace;
      if (!mod.nacos.configAddr && nacos.configAddr) mod.nacos.configAddr = nacos.configAddr;
      if (!mod.nacos.configNamespace && nacos.configNamespace) mod.nacos.configNamespace = nacos.configNamespace;
    }
  }

  // 5. Parse Java files for @FeignClient
  for (const javaPath of javaFiles) {
    const clients = parseFeignClients(javaPath);
    if (clients.length === 0) continue;

    // Assign to the nearest ancestor module that has a pom.xml
    const mod = findAncestorModule(javaPath);

    const relativePath = path.relative(absRoot, javaPath);

    for (const client of clients) {
      const record = { file: relativePath, ...client };
      if (mod) {
        mod.feignClients.push(record);
      }
    }
  }

  // 6. Build report
  const services = [];
  for (const [, mod] of modules) {
    const hasOpenfeign = mod.pom.openfeign.length > 0;
    const hasSentinel = mod.pom.sentinel.length > 0;
    const hasHystrix = mod.pom.hystrix.length > 0;
    const feignFallbackConfigured = mod.feignClients.some(c => c.fallback || c.fallbackFactory);
    const feignFallbackMissing = mod.feignClients.length > 0 && !feignFallbackConfigured;

    services.push({
      name: mod.name,
      path: path.relative(absRoot, mod.dir) || '.',
      pom: {
        hasOpenfeign,
        hasSentinel,
        hasHystrix,
        openfeignDeps: mod.pom.openfeign,
        sentinelDeps: mod.pom.sentinel,
        hystrixDeps: mod.pom.hystrix,
        nacosDiscoveryDeps: mod.pom.nacosDiscovery,
        nacosConfigDeps: mod.pom.nacosConfig,
      },
      nacos: mod.nacos,
      feignClients: mod.feignClients,
      summary: {
        totalFeignClients: mod.feignClients.length,
        feignWithFallback: mod.feignClients.filter(c => c.fallback).length,
        feignWithFallbackFactory: mod.feignClients.filter(c => c.fallbackFactory).length,
        feignWithoutFallback: mod.feignClients.filter(c => !c.fallback && !c.fallbackFactory).length,
        feignFallbackConfigured,
        feignFallbackMissing,
        nacosDiscoveryConfigured: !!(mod.nacos.discoveryAddr),
        nacosConfigConfigured: !!(mod.nacos.configAddr),
      },
    });
  }

  // Global summary
  const allFeign = services.flatMap(s => s.feignClients);
  const globalSummary = {
    projectRoot: absRoot,
    totalModules: services.length,
    totalFeignClients: allFeign.length,
    feignWithFallback: allFeign.filter(c => c.fallback).length,
    feignWithFallbackFactory: allFeign.filter(c => c.fallbackFactory).length,
    feignWithoutFallback: allFeign.filter(c => !c.fallback && !c.fallbackFactory).length,
    modulesWithNacosDiscovery: services.filter(s => s.summary.nacosDiscoveryConfigured).length,
    modulesWithNacosConfig: services.filter(s => s.summary.nacosConfigConfigured).length,
    modulesWithFeignFallbackMissing: services.filter(s => s.summary.feignFallbackMissing).length,
  };

  return { projectRoot: absRoot, globalSummary, services };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`Usage: node scanner.js <path-to-java-project> [--output result.json]

Options:
  --output <path>   Write JSON output to a file instead of stdout.
  -h, --help        Show this help message.
`);
    process.exit(0);
  }

  const targetPath = args[0];
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : null;

  const report = scan(targetPath);
  const json = JSON.stringify(report, null, 2);

  if (outputPath) {
    fs.writeFileSync(outputPath, json, 'utf8');
    console.log(`Report written to ${outputPath}`);
  } else {
    console.log(json);
  }
}

main();
