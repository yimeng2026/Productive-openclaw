/**
 * IntentClassifier — 意图识别引擎
 * 支持：规则匹配 + 置信度评分 + 技能路由
 */

export interface IntentRule {
  id: string
  skillId: string
  patterns: string[]        // 匹配模式（关键词/正则）
  confidenceThreshold: number // 置信度阈值 (0-1)
  priority: number          // 优先级（高优先覆盖低优先）
  mode: 'auto' | 'explicit' | 'danger' // 触发模式
}

export interface ClassifiedIntent {
  skillId: string
  confidence: number
  matchedPattern: string
  ruleId: string
  mode: 'auto' | 'explicit' | 'danger'
}

export class IntentClassifier {
  private rules: IntentRule[] = []

  constructor() {
    // 默认意图规则
    this.rules = [
      { id: 'rule-search', skillId: 'skill-search', patterns: ['搜索', '查找', 'google', '百度', '查一下'], confidenceThreshold: 0.6, priority: 1, mode: 'auto' },
      { id: 'rule-media', skillId: 'skill-media', patterns: ['图片', '图像', '生成图', '画图', 'ocr'], confidenceThreshold: 0.6, priority: 1, mode: 'auto' },
      { id: 'rule-code', skillId: 'skill-code', patterns: ['写代码', '编程', 'python', 'javascript', 'js', 'ts'], confidenceThreshold: 0.6, priority: 1, mode: 'auto' },
      { id: 'rule-explicit-search', skillId: 'skill-search', patterns: ['^/search\\s', '^/查找\\s'], confidenceThreshold: 0.95, priority: 10, mode: 'explicit' },
      { id: 'rule-danger-delete', skillId: 'skill-delete', patterns: ['删除', '清空', '销毁', 'drop'], confidenceThreshold: 0.8, priority: 5, mode: 'danger' },
    ]
  }

  /** 添加自定义规则 */
  addRule(rule: IntentRule) {
    this.rules.push(rule)
    // 按优先级排序（高优先在前）
    this.rules.sort((a, b) => b.priority - a.priority)
  }

  /** 删除规则 */
  removeRule(id: string) {
    this.rules = this.rules.filter((r) => r.id !== id)
  }

  /** 获取所有规则 */
  getRules(): IntentRule[] {
    return this.rules
  }

  /** 核心：分类用户输入 */
  classify(input: string): ClassifiedIntent | null {
    const normalized = input.trim().toLowerCase()
    let best: ClassifiedIntent | null = null
    let bestScore = 0

    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        const score = this.matchScore(normalized, pattern)
        if (score >= rule.confidenceThreshold && score > bestScore) {
          bestScore = score
          best = {
            skillId: rule.skillId,
            confidence: score,
            matchedPattern: pattern,
            ruleId: rule.id,
            mode: rule.mode,
          }
        }
      }
    }

    return best
  }

  /** 匹配评分：关键词匹配 / 前缀匹配 / 正则匹配 */
  private matchScore(input: string, pattern: string): number {
    // 正则模式
    if (pattern.startsWith('^')) {
      try {
        const regex = new RegExp(pattern, 'i')
        return regex.test(input) ? 0.95 : 0
      } catch {
        return 0
      }
    }

    // 完全匹配
    if (input === pattern.toLowerCase()) return 1.0

    // 前缀匹配
    if (input.startsWith(pattern.toLowerCase())) return 0.9

    // 包含匹配
    if (input.includes(pattern.toLowerCase())) return 0.7

    // 无匹配
    return 0
  }

  /** 批量分类 */
  classifyBatch(inputs: string[]): (ClassifiedIntent | null)[] {
    return inputs.map((i) => this.classify(i))
  }
}

/** 单例 */
export const intentClassifier = new IntentClassifier()
