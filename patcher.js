#!/usr/bin/env node

/**
 * AI-Arch-Guardian — Patcher
 *
 * Auto-generates fallback implementation classes for @FeignClient interfaces
 * that lack fallback/fallbackFactory configuration.
 *
 * For each affected interface, the patcher:
 *   1. Reads the original Java interface file
 *   2. Parses method signatures (return type, method name, parameters)
 *   3. Generates a XXXFallback.java with sensible default return values
 *   4. Generates a .patch file showing the @FeignClient annotation change
 *
 * Usage:
 *   node patcher.js <audit-report.json> <project-root> [--output-dir patches/]
 *   node patcher.js <audit-report.json> <project-root> --apply   (write .java files)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Java interface parser
// ---------------------------------------------------------------------------

/**
 * Parse a Java source file to extract:
 *   - package declaration
 *   - imports
 *   - @FeignClient annotation attributes
 *   - interface name
 *   - method signatures
 */
function parseJavaInterface(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = {
    package: '',
    imports: [],
    feignAnnotation: {},
    interfaceName: '',
    methods: [],
  };

  // Package
  const pkgMatch = raw.match(/package\s+([\w.]+)\s*;/);
  if (pkgMatch) result.package = pkgMatch[1];

  // Imports
  const importRe = /import\s+([\w.*]+)\s*;/g;
  let im;
  while ((im = importRe.exec(raw)) !== null) {
    result.imports.push(im[1]);
  }

  // @FeignClient annotation
  const feignMatch = raw.match(/@FeignClient\s*\(\s*((?:[^)]|\([^)]*\))*)\)/s);
  if (feignMatch) {
    const props = parseAnnotationPairs(feignMatch[1]);
    result.feignAnnotation = props;
  }

  // Interface name
  const ifaceMatch = raw.match(/(?:public\s+)?interface\s+(\w+)/);
  if (ifaceMatch) result.interfaceName = ifaceMatch[1];

  // Method signatures — robust balanced-parens parsing
  // Steps: find "ReturnType methodName(", balance parens to find closing ")", then capture throws + ;
  const methodStartRe = /(?:(?:@\w+(?:\([^)]*\))?\s*)*)(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:default\s+)?(\w+(?:<[^>]+>)?(?:\s*\[\])?)\s+(\w+)\s*\(/g;
  let ms;
  while ((ms = methodStartRe.exec(raw)) !== null) {
    const returnType = ms[1];
    const methodName = ms[2];
    const openParenPos = ms.index + ms[0].length - 1; // position of '('

    // Find balanced closing ')'
    const closeParenPos = findBalancedClose(raw, openParenPos);
    if (closeParenPos === -1) continue;

    const paramStr = raw.substring(openParenPos + 1, closeParenPos);

    // Find throws clause and terminator after ')'
    const afterParen = raw.substring(closeParenPos + 1);
    const throwsMatch = afterParen.match(/^\s*throws\s+([^{;]+)/);
    const throwsStr = throwsMatch ? throwsMatch[1].trim() : '';

    // Skip default methods (have body with {})
    if (/^\s*\{/.test(afterParen.replace(/^\s*throws\s+[^{;]+/, ''))) continue;

    const params = parseMethodParams(paramStr);

    result.methods.push({
      returnType,
      methodName,
      params,
      throwsClause: throwsStr ? throwsStr.split(/\s*,\s*/) : [],
    });
  }

  return result;
}

function parseAnnotationPairs(content) {
  const pairs = {};
  const parts = splitByTopLevelComma(content);

  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) {
      const trimmed = part.trim();
      if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        pairs.value = stripQuotes(trimmed);
      }
      continue;
    }
    const key = part.substring(0, eqIdx).trim();
    let val = part.substring(eqIdx + 1).trim();
    if (val.endsWith('.class')) {
      val = val.slice(0, -6).trim();
    } else {
      val = stripQuotes(val);
    }
    pairs[key] = val;
  }
  return pairs;
}

function parseMethodParams(paramStr) {
  if (!paramStr.trim()) return [];
  const parts = splitByTopLevelComma(paramStr);
  return parts.map(p => {
    const trimmed = p.trim();
    // Match full annotation including balanced parens: @foo.bar.Baz("val")
    const annoMatch = trimmed.match(/^@[\w.]+(?:\s*\([^)]*\))?\s*/);
    const rest = annoMatch ? trimmed.slice(annoMatch[0].length) : trimmed;
    const lastSpace = rest.lastIndexOf(' ');
    if (lastSpace === -1) return { type: rest, name: '' };
    return {
      type: rest.substring(0, lastSpace).trim(),
      name: rest.substring(lastSpace + 1).trim(),
    };
  });
}

function splitByTopLevelComma(str) {
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
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; current += ch; continue; }
    if (ch === '<' || ch === '(' || ch === '{') depth++;
    if (ch === '>' || ch === ')' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Find the closing ')' that balances an opening '(' at position openIdx. */
function findBalancedClose(str, openIdx) {
  let depth = 1;
  let inString = false;
  let stringChar = '';
  for (let i = openIdx + 1; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Default value inference
// ---------------------------------------------------------------------------

/**
 * Map Java return types to sensible default values.
 */
function defaultReturnValue(returnType) {
  const rt = returnType.trim();

  // Primitives
  if (rt === 'void') return '';
  if (rt === 'int' || rt === 'long' || rt === 'short' || rt === 'byte') return '0';
  if (rt === 'float' || rt === 'double') return '0.0';
  if (rt === 'boolean') return 'false';
  if (rt === 'char') return "'\\0'";

  // String
  if (rt === 'String') return '""';

  // Common Java types
  if (rt === 'Integer' || rt === 'Long' || rt === 'Short' || rt === 'Byte') return 'null';
  if (rt === 'Double' || rt === 'Float') return 'null';
  if (rt === 'Boolean') return 'Boolean.FALSE';
  if (rt === 'BigDecimal') return 'java.math.BigDecimal.ZERO';
  if (rt === 'BigInteger') return 'java.math.BigInteger.ZERO';

  // Collections — need import java.util.Collections
  if (rt.startsWith('List<') || rt.startsWith('ArrayList<') || rt.startsWith('Collection<')) {
    return 'java.util.Collections.emptyList()';
  }
  if (rt.startsWith('Set<') || rt.startsWith('HashSet<')) {
    return 'java.util.Collections.emptySet()';
  }
  if (rt.startsWith('Map<') || rt.startsWith('HashMap<')) {
    return 'java.util.Collections.emptyMap()';
  }

  // Optional
  if (rt.startsWith('Optional<')) {
    return 'java.util.Optional.empty()';
  }

  // ResponseEntity / common Spring types
  if (rt.startsWith('ResponseEntity<')) {
    return 'org.springframework.http.ResponseEntity.notFound().build()';
  }
  if (rt === 'Result' || rt === 'R' || rt.startsWith('Result<') || rt.startsWith('R<')) {
    return 'null'; // generic result wrapper
  }
  if (rt === 'Page' || rt.startsWith('Page<')) {
    return 'org.springframework.data.domain.Page.empty()';
  }

  // Arrays
  if (rt.endsWith('[]')) {
    const base = rt.slice(0, -2).trim();
    return `new ${base}[0]`;
  }

  // Default for objects
  return 'null';
}

/**
 * Determine which imports the fallback class needs.
 */
function collectFallbackImports(parsedIface) {
  const imports = new Set();
  const methods = parsedIface.methods;

  for (const m of methods) {
    const rv = defaultReturnValue(m.returnType);
    if (rv.includes('java.util.Collections')) imports.add('import java.util.Collections;');
    if (rv.includes('java.util.Optional')) imports.add('import java.util.Optional;');
    if (rv.includes('java.math.BigDecimal')) imports.add('import java.math.BigDecimal;');
    if (rv.includes('java.math.BigInteger')) imports.add('import java.math.BigInteger;');
    if (rv.includes('ResponseEntity')) imports.add('import org.springframework.http.ResponseEntity;');
    if (rv.includes('Page.empty()')) imports.add('import org.springframework.data.domain.Page;');
  }

  // Always add these
  imports.add('import org.springframework.stereotype.Component;');

  // Collect param type imports — if a param type contains a package, add it
  for (const m of methods) {
    for (const p of m.params) {
      // Skip import if type contains annotation residue (e.g. "@Something")
      if (p.type.includes('@') || p.type.includes('(')) continue;
      if (p.type.includes('.') && !p.type.startsWith('java.lang.')) {
        imports.add(`import ${p.type};`);
      }
    }
    if (m.returnType.includes('.') && !m.returnType.startsWith('java.lang.')) {
      imports.add(`import ${m.returnType};`);
    }
  }

  return [...imports].sort();
}

// ---------------------------------------------------------------------------
// Fallback class generation
// ---------------------------------------------------------------------------

/**
 * Generate the source code for a fallback implementation class.
 */
function generateFallbackClass(parsedIface, fallbackClassName) {
  const lines = [];
  const pkg = parsedIface.package;
  const ifaceName = parsedIface.interfaceName;
  const methods = parsedIface.methods;

  // Package
  if (pkg) {
    lines.push(`package ${pkg};`);
    lines.push('');
  }

  // Imports
  const neededImports = collectFallbackImports(parsedIface);
  if (neededImports.length > 0) {
    for (const imp of neededImports) {
      lines.push(imp);
    }
    lines.push('');
  }

  // Class declaration
  lines.push(`/**`);
  lines.push(` * Fallback implementation for {@link ${ifaceName}}.`);
  lines.push(` * Auto-generated by AI-Arch-Guardian.`);
  lines.push(` *`);
  lines.push(` * <p>Returns sensible defaults when the remote service is unavailable.`);
  lines.push(` * Replace with domain-specific fallback logic as needed.</p>`);
  lines.push(` */`);
  lines.push(`@Component`);
  lines.push(`public class ${fallbackClassName} implements ${ifaceName} {`);

  // Methods
  for (let i = 0; i < methods.length; i++) {
    if (i > 0) lines.push('');
    const m = methods[i];
    const paramDecls = m.params.map(p => `${p.type} ${p.name}`).join(', ');
    const throwsDecl = m.throwsClause.length > 0 ? ` throws ${m.throwsClause.join(', ')}` : '';
    const retVal = defaultReturnValue(m.returnType);
    const isVoid = m.returnType === 'void';

    lines.push(`    @Override`);
    lines.push(`    public ${m.returnType} ${m.methodName}(${paramDecls})${throwsDecl} {`);

    if (isVoid) {
      lines.push(`        // No fallback action needed for void methods`);
    } else if (retVal === 'null') {
      lines.push(`        // TODO: Replace with meaningful fallback logic`);
      lines.push(`        return ${retVal};`);
    } else {
      lines.push(`        return ${retVal};`);
    }

    lines.push(`    }`);
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate the annotation change patch (shows what to add to @FeignClient).
 */
function generateAnnotationPatch(parsedIface, fallbackClassName, useFactory = false) {
  const lines = [];
  const ifaceName = parsedIface.interfaceName;
  const filePath = parsedIface._sourcePath || `${ifaceName}.java`;

  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);
  lines.push(`@@ -1,5 +1,6 @@`);
  lines.push(` `);
  lines.push(` // Apply this change to the @FeignClient annotation:`);
  lines.push(` //`);
  lines.push(` @FeignClient(`);
  lines.push(`     name = "${parsedIface.feignAnnotation.name || parsedIface.feignAnnotation.value || '???'}",`);

  if (useFactory) {
    lines.push(`+    fallbackFactory = ${fallbackClassName}.class`);
  } else {
    lines.push(`+    fallback = ${fallbackClassName}.class`);
  }

  // Preserve other existing attributes
  for (const [key, val] of Object.entries(parsedIface.feignAnnotation)) {
    if (key === 'name' || key === 'value' || key === 'fallback' || key === 'fallbackFactory') continue;
    if (val.startsWith('{')) {
      lines.push(`     ${key} = ${val},`);
    } else {
      lines.push(`     ${key} = "${val}",`);
    }
  }
  // Fix trailing comma on last line
  if (lines.length > 0 && lines[lines.length - 1].endsWith(',')) {
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
  }

  lines.push(` )`);
  lines.push(` public interface ${ifaceName} {`);
  lines.push(`     // ...`);
  lines.push(` }`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main patcher logic
// ---------------------------------------------------------------------------

/**
 * @param {Object} auditResult — output from auditor.js (contains .findings[])
 * @param {string} projectRoot — root directory of the Java project
 * @param {Object} options — { outputDir: string, mode: 'dry-run' | 'apply' }
 * @returns {Object} { patches: [...], filesGenerated: [...] }
 */
function patch(auditResult, projectRoot, options = {}) {
  const outputDir = options.outputDir || path.join(projectRoot, 'arch-guardian-patches');
  const mode = options.mode || 'dry-run';

  const patches = [];
  const filesGenerated = [];

  // Extract per-client FEIGN-001 findings
  const feignFindings = auditResult.findings.filter(
    f => f.ruleId === 'FEIGN-001' && f.details && f.details.riskAssessment
  );

  // Deduplicate by (service, clientName)
  const seen = new Set();
  const uniqueFindings = [];
  for (const f of feignFindings) {
    const key = `${f.service}::${f.details.feignClient.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFindings.push(f);
    }
  }

  for (const finding of uniqueFindings) {
    const client = finding.details.feignClient;
    const javaFileRel = client.file; // relative from projectRoot
    const javaFileAbs = path.join(projectRoot, javaFileRel);

    if (!fs.existsSync(javaFileAbs)) {
      patches.push({
        service: finding.service,
        clientName: client.name,
        error: `Source file not found: ${javaFileAbs}`,
      });
      continue;
    }

    const parsed = parseJavaInterface(javaFileAbs);
    parsed._sourcePath = javaFileRel;

    if (!parsed.interfaceName) {
      patches.push({
        service: finding.service,
        clientName: client.name,
        error: `Could not parse interface name from ${javaFileRel}`,
      });
      continue;
    }

    // Determine fallback class name
    const baseName = client.name
      ? client.name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
      : parsed.interfaceName;
    const fallbackClassName = `${baseName}Fallback`;

    // Determine output directory for the patch (same package structure)
    const pkgPath = parsed.package ? parsed.package.replace(/\./g, '/') : '';
    const targetDir = path.join(outputDir, pkgPath);

    if (mode === 'apply') {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Generate fallback class
    const fallbackSource = generateFallbackClass(parsed, fallbackClassName);
    const fallbackFile = `${fallbackClassName}.java`;
    const fallbackFullPath = path.join(targetDir, fallbackFile);

    // Generate annotation patch
    const annotationPatch = generateAnnotationPatch(parsed, fallbackClassName);

    const patchResult = {
      service: finding.service,
      clientName: client.name,
      interfaceName: parsed.interfaceName,
      sourceFile: javaFileRel,
      fallbackClassName,
      fallbackFile,
      fallbackFullPath,
      methods: parsed.methods.map(m => ({
        returnType: m.returnType,
        methodName: m.methodName,
        defaultReturn: defaultReturnValue(m.returnType),
      })),
      fallbackSource,
      annotationPatch,
    };

    patches.push(patchResult);

    if (mode === 'apply') {
      fs.writeFileSync(fallbackFullPath, fallbackSource, 'utf8');
      filesGenerated.push(fallbackFullPath);

      // Also write the annotation patch as a .patch file
      const patchFilePath = path.join(targetDir, `${parsed.interfaceName}_annotation.patch`);
      fs.writeFileSync(patchFilePath, annotationPatch, 'utf8');
      filesGenerated.push(patchFilePath);
    }
  }

  return { patches, filesGenerated };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('-h') || args.includes('--help')) {
    console.log(`Usage: node patcher.js <audit-report.json> <project-root> [options]

Auto-generates fallback implementation classes for FeignClients missing fallbacks.

Options:
  --output-dir <path>   Directory to write patches to (default: <project-root>/arch-guardian-patches).
  --apply               Actually write .java files (default: dry-run, prints JSON only).
  -h, --help            Show this help message.
`);
    process.exit(0);
  }

  const auditPath = args[0];
  const projectRoot = path.resolve(args[1]);

  const outputIdx = args.indexOf('--output-dir');
  const outputDir = outputIdx !== -1 ? args[outputIdx + 1] : path.join(projectRoot, 'arch-guardian-patches');
  const mode = args.includes('--apply') ? 'apply' : 'dry-run';

  const auditRaw = fs.readFileSync(auditPath, 'utf8');
  const auditResult = JSON.parse(auditRaw);

  const result = patch(auditResult, projectRoot, { outputDir, mode });

  if (mode === 'apply') {
    console.log(`Generated ${result.filesGenerated.length} files:`);
    for (const f of result.filesGenerated) {
      console.log(`  ${f}`);
    }
  } else {
    // Dry-run: print JSON summary
    const summary = result.patches.map(p => ({
      service: p.service,
      clientName: p.clientName,
      interfaceName: p.interfaceName,
      fallbackClass: p.fallbackClassName,
      methods: p.methods.length,
      wouldGenerate: p.fallbackFullPath,
    }));
    console.log(JSON.stringify({ dryRun: true, patches: summary }, null, 2));
    if (result.patches.length > 0) {
      console.log('\nRun with --apply to generate the files.');
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { patch, generateFallbackClass, parseJavaInterface, defaultReturnValue };
