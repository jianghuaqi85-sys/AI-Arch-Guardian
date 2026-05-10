# AI-Arch-Guardian 快速入门

## 安装

```bash
cd arch-guardian
npm install
```

## 使用方式

### 方式一：标准版（原有功能）

```bash
# 完整流程
node index.js /path/to/java-project

# 仅扫描
npm run scan -- /path/to/java-project
```

### 方式二：增强版（推荐）

增强版包含：
- ✅ JavaParser AST 解析（更准确）
- ✅ 支持 properties 配置文件
- ✅ 检测继承的 @FeignClient
- ✅ 检测动态 Feign 构建
- ✅ 环境感知规则
- ✅ 置信度评分
- ✅ 服务依赖图

```bash
# 1. 安装依赖后执行扫描
node src/enhanced-scanner.js /path/to/java-project --output scan.json

# 2. 执行审计（可指定环境：production/development/testing）
node src/enhanced-auditor.js scan.json --env production --output audit.json

# 3. 生成报告（可选）
node reporter.js audit.json scan.json --output ARCH_AUDIT_REPORT.md
```

### 快速命令

```bash
# 完整增强版流程（需要先安装依赖）
npm run full:enhanced -- "C:\Users\86198\Desktop\java项目文档\microservice-mall"
```

## 输出示例

### 审计结果包含：
- 综合评分和等级
- 问题按严重程度分类
- 环境分布统计
- 置信度评分（高/中/低）
- 服务依赖图
- 单点故障分析

### 字段说明

| 字段 | 说明 |
|------|------|
| confidence.score | 0-100，检测结果可信度 |
| confidence.level | high(≥80) / medium(≥50) / low(<50) |
| serviceGraph.nodes | 服务节点 |
| serviceGraph.edges | 服务调用关系 |
| metrics.singlePointsOfFailure | 调用≥3次的服务（单点故障风险） |

## 环境说明

| 环境 | 规则严格程度 |
|------|-------------|
| development | 宽松，允许 localhost |
| testing | 中等 |
| production | 严格，Critical 问题会失败 |
| unknown | 默认生产级严格度 |

## 注意事项

1. **首次使用需运行 `npm install`** 安装 javaparser 依赖
2. 增强版扫描速度比标准版稍慢，但准确性更高
3. 置信度为 "low" 的结果建议人工复核