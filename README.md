# AI-Arch-Guardian

**Java 微服务架构安全审计工具** — 自动化检测 OpenFeign fallback 缺失与 Nacos 配置问题。

---

## 🎯 项目简介

AI-Arch-Guardian 是一款专为 Java 微服务项目设计的静态代码分析工具，能够自动扫描项目中 OpenFeign 接口的 fallback 配置缺失，并检测 Nacos 配置中的潜在风险，帮助开发团队在 CI/CD 流程中提前发现架构问题。

### 核心功能

| 功能 | 说明 |
|------|------|
| 🔍 **OpenFeign Fallback 检测** | 自动扫描 `@FeignClient` 注解，检测是否配置了 fallback 或 fallbackFactory |
| ⚙️ **Nacos 配置分析** | 解析 bootstrap.yml / application.yml，提取服务发现和配置中心的地址、命名空间 |
| 📊 **架构健康评分** | 根据问题严重程度计算综合评分（Critical / High / Medium / Low） |
| 🔧 **自动修复** | 一键生成缺失的 Fallback 实现类 |
| 📝 **报告生成** | 输出 Markdown 格式的审计报告 |
| 🤖 **CI/CD 集成** | 支持 GitHub Actions 工作流 |

---

## 🛠 技术栈

- **Node.js** — 核心运行时
- **JavaParser** — Java AST 语法树解析（增强版）
- **fast-xml-parser** — pom.xml 依赖解析
- **js-yaml** — YAML 配置文件解析
- **Vitest** — 单元测试框架

---

## 📦 安装

```bash
cd arch-guardian
npm install
```

---

## 🚀 快速开始

### 方式一：完整流程（推荐）

```bash
node index.js /path/to/java-project
```

该命令会自动执行：扫描 → 审计 → 报告生成 → 自动修复

### 方式二：分步执行

```bash
# 1. 扫描项目
node src/enhanced-scanner.js /path/to/java-project --output scan.json

# 2. 执行审计
node src/enhanced-auditor.js scan.json --env production --output audit.json

# 3. 生成报告
node reporter.js audit.json scan.json --output ARCH_AUDIT_REPORT.md
```

### 命令行参数

| 参数 | 说明 |
|------|------|
| `--no-patch` | 跳过自动修复步骤 |
| `--output-dir <path>` | 指定输出目录（默认：`项目目录/arch-guardian-output`） |
| `--dry-run` | 预览模式，不写入文件 |
| `--debug` | 调试模式，输出详细日志 |
| `--env <env>` | 指定环境：`production` / `development` / `testing` |

---

## 📊 输出示例

### 审计报告摘要

```
╔════════════════════════════════════════════════════════════════╗
║               AI-Arch-Guardian 架构审计报告                      ║
╠════════════════════════════════════════════════════════════════╣
║ 综合评分：72/100 (B)                                             ║
║ 严重问题：2 🟠  |  警告：5 🟡  |  提示：3 🟢                     ║
╚════════════════════════════════════════════════════════════════╝

🔴 Critical Issues
├── ProductClient 缺少 fallback 实现
└── OrderClient fallback 与接口不兼容

🟠 High Issues
├── Nacos 服务地址配置缺失
└── 未启用 Sentinel 熔断
```

---

## 🔍 检测规则

### OpenFeign Fallback

| 规则 ID | 说明 | 严重程度 |
|---------|------|----------|
| FEIGN_001 | @FeignClient 缺少 fallback 配置 | Critical |
| FEIGN_002 | fallback 类不存在 | Critical |
| FEIGN_003 | fallback 未实现对应接口 | High |
| FEIGN_004 | fallbackFactory 配置错误 | Medium |

### Nacos 配置

| 规则 ID | 说明 | 严重程度 |
|---------|------|----------|
| NACOS_001 | server-addr 未配置 | Critical |
| NACOS_002 | 命名空间配置缺失 | High |
| NACOS_003 | 开发环境使用生产配置 | Medium |

---

## 🔧 自动修复

使用 `--patch` 参数自动生成缺失的 Fallback 类：

```bash
node index.js /path/to/java-project --patch
```

生成文件示例：`ProductClientFallback.java`

---

## 🤖 GitHub Actions 集成

```yaml
name: Architecture Audit

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install & Run
        run: |
          cd arch-guardian
          npm ci --legacy-peer-deps
          node index.js "${{ github.workspace }}"
```

---

## 📁 项目结构

```
arch-guardian/
├── index.js              # 统一入口（CLI）
├── scanner.js            # 标准扫描器
├── enhanced-scanner.js   # 增强扫描器（JavaParser）
├── auditor.js            # 标准审计器
├── enhanced-auditor.js   # 增强审计器
├── reporter.js           # 报告生成器
├── patcher.js            # 自动修复工具
├── rules/
│   └── default-rules.yaml # 默认规则配置
├── src/
│   ├── enhanced-scanner.js
│   ├── enhanced-auditor.js
│   ├── errors.js
│   ├── rules-loader.js
│   └── types.ts
└── tests/                # 单元测试
```

---

## 📈 增强版特性

相比标准版，增强版（enhanced-scanner）提供：

- ✅ **JavaParser AST 解析** — 更准确的代码结构分析
- ✅ **Properties 配置支持** — 同时支持 .yml 和 .properties
- ✅ **继承 @FeignClient 检测** — 发现通过继承方式定义的 Feign Client
- ✅ **动态 Feign 构建检测** — 检测编程式 Feign 创建
- ✅ **置信度评分** — 每条检测结果附带可信度指标（高/中/低）
- ✅ **服务依赖图** — 生成服务调用关系图
- ✅ **单点故障分析** — 识别高风险的服务调用

---

## 📝 License

ISC