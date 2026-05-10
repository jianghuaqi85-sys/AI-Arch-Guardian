#!/usr/bin/env node

/**
 * AI-Arch-Guardian — Error Codes and Error Handling
 *
 * Provides:
 * - Error code system for trackable errors
 * - Debug mode support
 * - Proper exit codes
 * - Actionable error messages
 */

// Error Categories
const ErrorCategory = {
  SCANNER: 'SCANNER',
  AUDITOR: 'AUDITOR',
  REPORTER: 'REPORTER',
  PATCHER: 'PATCHER',
  FILESYSTEM: 'FILESYSTEM',
  VALIDATION: 'VALIDATION',
  CONFIG: 'CONFIG',
  UNKNOWN: 'UNKNOWN'
};

// Exit Codes
const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  SCAN_ERROR: 10,
  AUDIT_ERROR: 20,
  REPORT_ERROR: 30,
  PATCH_ERROR: 40,
  VALIDATION_ERROR: 50,
  FILE_NOT_FOUND: 51,
  INVALID_PATH: 52,
  TIMEOUT: 60,
  PERMISSION_DENIED: 70
};

// Error Definitions
const ERRORS = {
  // Scanner Errors (10xx)
  'SCANNER_001': {
    category: ErrorCategory.SCANNER,
    exitCode: ExitCode.SCAN_ERROR,
    message: '无法读取项目路径',
    suggestion: '请确认路径存在且有读取权限'
  },
  'SCANNER_002': {
    category: ErrorCategory.SCANNER,
    exitCode: ExitCode.SCAN_ERROR,
    message: '项目目录为空，未找到 Java 源文件',
    suggestion: '请确认这是一个 Java 微服务项目'
  },
  'SCANNER_003': {
    category: ErrorCategory.SCANNER,
    exitCode: ExitCode.SCAN_ERROR,
    message: '解析 YAML 配置文件失败',
    suggestion: '请检查 application.yml 或 bootstrap.yml 格式是否正确'
  },
  'SCANNER_004': {
    category: ErrorCategory.SCANNER,
    exitCode: ExitCode.SCAN_ERROR,
    message: '解析 POM.xml 文件失败',
    suggestion: '请检查 pom.xml 格式是否正确'
  },

  // Auditor Errors (20xx)
  'AUDITOR_001': {
    category: ErrorCategory.AUDITOR,
    exitCode: ExitCode.AUDIT_ERROR,
    message: '扫描结果文件不存在或格式错误',
    suggestion: '请先运行扫描 (node scanner.js <project-path>)'
  },
  'AUDITOR_002': {
    category: ErrorCategory.AUDITOR,
    exitCode: ExitCode.AUDIT_ERROR,
    message: '审计规则加载失败',
    suggestion: '请检查 rules 定义是否正确'
  },
  'AUDITOR_003': {
    category: ErrorCategory.AUDITOR,
    exitCode: ExitCode.AUDIT_ERROR,
    message: '审计过程发生未知错误',
    suggestion: '尝试使用 --debug 模式查看详细信息'
  },

  // Reporter Errors (30xx)
  'REPORTER_001': {
    category: ErrorCategory.REPORTER,
    exitCode: ExitCode.REPORT_ERROR,
    message: '审计结果文件不存在',
    suggestion: '请先运行审计 (node auditor.js <scan-result.json>)'
  },
  'REPORTER_002': {
    category: ErrorCategory.REPORTER,
    exitCode: ExitCode.REPORT_ERROR,
    message: '生成报告文件失败',
    suggestion: '请检查输出目录是否有写入权限'
  },

  // Patcher Errors (40xx)
  'PATCHER_001': {
    category: ErrorCategory.PATCHER,
    exitCode: ExitCode.PATCH_ERROR,
    message: '审计结果文件不存在',
    suggestion: '请先运行审计'
  },
  'PATCHER_002': {
    category: ErrorCategory.PATCHER,
    exitCode: ExitCode.PATCH_ERROR,
    message: '解析 Java 源文件失败',
    suggestion: '请检查源文件是否为有效的 Java 代码'
  },
  'PATCHER_003': {
    category: ErrorCategory.PATCHER,
    exitCode: ExitCode.PATCH_ERROR,
    message: '生成 Fallback 代码失败',
    suggestion: '请检查接口定义是否符合规范'
  },

  // Validation Errors (50xx)
  'VALIDATION_001': {
    category: ErrorCategory.VALIDATION,
    exitCode: ExitCode.VALIDATION_ERROR,
    message: '缺少必需的参数',
    suggestion: '请提供项目路径作为第一个参数'
  },
  'VALIDATION_002': {
    category: ErrorCategory.VALIDATION,
    exitCode: ExitCode.VALIDATION_ERROR,
    message: '无效的输出目录路径',
    suggestion: '请指定有效的目录路径'
  },

  // FileSystem Errors (51xx)
  'FILESYSTEM_001': {
    category: ErrorCategory.FILESYSTEM,
    exitCode: ExitCode.FILE_NOT_FOUND,
    message: '文件不存在',
    suggestion: '请检查文件路径是否正确'
  },
  'FILESYSTEM_002': {
    category: ErrorCategory.FILESYSTEM,
    exitCode: ExitCode.PERMISSION_DENIED,
    message: '没有文件访问权限',
    suggestion: '请检查文件权限设置'
  },

  // Config Errors (52xx)
  'CONFIG_001': {
    category: ErrorCategory.CONFIG,
    exitCode: ExitCode.INVALID_PATH,
    message: '配置文件格式错误',
    suggestion: '请检查配置文件格式是否为有效的 JSON/YAML'
  }
};

/**
 * Get error definition by code
 * @param {string} code - Error code (e.g., 'SCANNER_001')
 * @returns {Object|null} Error definition
 */
function getError(code) {
  return ERRORS[code] || null;
}

/**
 * Format error message for display
 * @param {string} code - Error code
 * @param {Object} options - Additional options (details, originalError)
 * @returns {string} Formatted error message
 */
function formatError(code, options = {}) {
  const errorDef = getError(code);
  if (!errorDef) {
    return `未知错误 (${code}): ${options.message || '未知原因'}`;
  }

  const parts = [
    `❌ [${code}] ${errorDef.message}`
  ];

  if (options.details) {
    parts.push(`   详情: ${options.details}`);
  }

  if (options.suggestion !== false) {
    parts.push(`   建议: ${errorDef.suggestion}`);
  }

  if (options.originalError && options.originalError.stack) {
    parts.push(`   堆栈: ${options.originalError.stack}`);
  }

  return parts.join('\n');
}

/**
 * Throw a formatted error (for use in try-catch)
 * @param {string} code - Error code
 * @param {Object} options - Additional options
 */
function throwError(code, options = {}) {
  const errorDef = getError(code);
  const error = new Error(formatError(code, options));
  error.code = code;
  error.category = errorDef?.category || ErrorCategory.UNKNOWN;
  error.exitCode = errorDef?.exitCode || ExitCode.GENERAL_ERROR;
  error.suggestion = errorDef?.suggestion;
  throw error;
}

/**
 * Handle error and exit with proper code
 * @param {Error} error - Error object
 * @param {boolean} debug - Whether debug mode is enabled
 */
function handleError(error, debug = false) {
  const code = error.code || 'UNKNOWN_001';
  const errorDef = getError(code);
  const exitCode = errorDef?.exitCode || ExitCode.GENERAL_ERROR;

  // Always show the error message
  console.error(`\n${error.message}\n`);

  // Show stack trace only in debug mode
  if (debug && error.stack) {
    console.error('--- Stack Trace ---');
    console.error(error.stack);
  }

  // Show suggestion if available
  if (error.suggestion) {
    console.error(`💡 提示: ${error.suggestion}`);
  }

  console.error(`\n[错误码: ${code}] [退出码: ${exitCode}]`);

  process.exit(exitCode);
}

/**
 * Validate that a path exists and is accessible
 * @param {string} filePath - Path to validate
 * @param {string} errorCode - Error code to throw if invalid
 */
function validatePath(filePath, errorCode = 'FILESYSTEM_001') {
  const fs = require('fs');
  try {
    fs.accessSync(filePath);
  } catch (err) {
    throwError(errorCode, { details: filePath, originalError: err });
  }
}

/**
 * Validate required arguments
 * @param {Array} args - Command line arguments
 * @param {number} minArgs - Minimum number of required args
 */
function validateArgs(args, minArgs = 1) {
  if (args.length < minArgs) {
    throwError('VALIDATION_001', {
      details: `需要至少 ${minArgs} 个参数，但只提供了 ${args.length} 个`
    });
  }
}

module.exports = {
  ErrorCategory,
  ExitCode,
  ERRORS,
  getError,
  formatError,
  throwError,
  handleError,
  validatePath,
  validateArgs
};