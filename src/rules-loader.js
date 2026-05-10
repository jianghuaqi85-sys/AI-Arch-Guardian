#!/usr/bin/env node

/**
 * AI-Arch-Guardian — External Rules Loader
 *
 * Loads rules from external YAML/JSON configuration files.
 *
 * Usage:
 *   const rulesLoader = require('./src/rules-loader.js');
 *   const rules = rulesLoader.loadRules('./rules/custom-rules.yaml');
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Load rules from external configuration file
 * @param {string} rulesFilePath - Path to rules YAML file
 * @returns {Object} { rules: [], overrides: {}, environment: {} }
 */
function loadRules(rulesFilePath) {
  if (!rulesFilePath) {
    return { rules: [], overrides: {}, environment: null, error: null };
  }

  const absolutePath = path.resolve(rulesFilePath);

  if (!fs.existsSync(absolutePath)) {
    return {
      rules: [],
      overrides: {},
      environment: null,
      error: `Rules file not found: ${absolutePath}`
    };
  }

  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    const config = yaml.load(content);

    return {
      rules: config.rules || [],
      overrides: config.overrides || {},
      environments: config.environments || {},
      metadata: config.metadata || {},
      error: null
    };
  } catch (err) {
    return {
      rules: [],
      overrides: {},
      environments: null,
      error: `Failed to parse rules file: ${err.message}`
    };
  }
}

/**
 * Get environment-specific configuration
 * @param {Object} config - Loaded config
 * @param {string} env - Environment name (development/staging/production)
 * @returns {Object} Environment settings
 */
function getEnvironmentConfig(config, env) {
  const environments = config.environments || {};
  return environments[env] || null;
}

/**
 * Apply overrides to built-in rules
 * @param {Array} builtInRules - Original STANDARDS array
 * @param {Array} overrides - Override configurations
 * @returns {Array} Modified rules array
 */
function applyOverrides(builtInRules, overrides) {
  if (!overrides || !overrides.length) {
    return builtInRules;
  }

  const rulesMap = new Map(builtInRules.map(r => [r.id, r]));
  const result = [...builtInRules];

  for (const override of overrides) {
    const { ruleId, action, value, reason } = override;

    switch (action) {
      case 'disable':
        // Mark rule as disabled
        if (rulesMap.has(ruleId)) {
          const rule = rulesMap.get(ruleId);
          rule._disabled = true;
          rule._disabledReason = reason || 'Disabled by external configuration';
        }
        break;

      case 'setSeverity':
        // Change rule severity
        if (rulesMap.has(ruleId) && ['critical', 'high', 'medium', 'low', 'info'].includes(value)) {
          const rule = rulesMap.get(ruleId);
          rule.severity = value;
          rule._overridden = true;
        }
        break;

      case 'setCategory':
        // Change rule category
        if (rulesMap.has(ruleId)) {
          const rule = rulesMap.get(ruleId);
          rule.category = value;
          rule._overridden = true;
        }
        break;

      default:
        console.warn(`Unknown override action: ${action}`);
    }
  }

  return result.filter(r => !r._disabled);
}

/**
 * Convert external rule to audit rule format
 * @param {Object} externalRule - Rule from external config
 * @returns {Object} Audit rule object
 */
function convertToAuditRule(externalRule) {
  return {
    id: externalRule.id,
    category: externalRule.category || 'custom',
    severity: externalRule.severity || 'medium',
    title: externalRule.title,
    description: externalRule.description,
    rationale: externalRule.rationale || externalRule.description || '',
    enabled: externalRule.enabled !== false,
    tags: externalRule.tags || [],
    isExternal: true,
    // Note: checkExpression requires eval() which has security implications
    // For safety, external rules with checkExpression should be reviewed carefully
    customCheck: externalRule.checkExpression
      ? new Function('service', `return ${externalRule.checkExpression}`)
      : null
  };
}

/**
 * Merge built-in and external rules
 * @param {Array} builtInRules - Original STANDARDS array
 * @param {Array} externalRules - Rules from external config
 * @returns {Array} Merged rules array
 */
function mergeRules(builtInRules, externalRules) {
  if (!externalRules || !externalRules.length) {
    return builtInRules;
  }

  const externalAuditRules = externalRules
    .filter(r => r.enabled !== false)
    .map(convertToAuditRule);

  // Filter out any external rules that match built-in IDs
  const builtInIds = new Set(builtInRules.map(r => r.id));
  const newExternalRules = externalAuditRules.filter(r => !builtInIds.has(r.id));

  return [...builtInRules, ...newExternalRules];
}

module.exports = {
  loadRules,
  getEnvironmentConfig,
  applyOverrides,
  convertToAuditRule,
  mergeRules
};