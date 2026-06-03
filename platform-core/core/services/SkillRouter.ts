/**
 * SkillRouter — 技能路由器
 * 根据意图分类结果，路由到对应技能，并支持上下文回注
 */

import { intentClassifier, type ClassifiedIntent } from './IntentClassifier'

export interface SkillHandler {
  skillId: string
  name: string
  handler: (input: string, context: SkillContext) => Promise<SkillResult>
}

export interface SkillContext {
  agentId: string
  userId: string
  sessionId: string
  previousSkills: string[]    // 已调用过的技能历史
  memory: Record<string, any>  // 记忆池
}

export interface SkillResult {
  success: boolean
  output: string
  skillId: string
  metadata?: Record<string, any>
}

export class SkillRouter {
  private handlers = new Map<string, SkillHandler>()

  /** 注册技能处理器 */
  register(handler: SkillHandler) {
    this.handlers.set(handler.skillId, handler)
  }

  /** 获取已注册技能 */
  getRegisteredSkills(): SkillHandler[] {
    return Array.from(this.handlers.values())
  }

  /** 路由：输入 → 意图识别 → 技能调用 → 结果 */
  async route(input: string, context: SkillContext): Promise<SkillResult | null> {
    // 1. 意图识别
    const intent = intentClassifier.classify(input)
    if (!intent) return null

    // 2. 危险模式 → 需要确认（不直接执行）
    if (intent.mode === 'danger') {
      return {
        success: false,
        output: `[危险操作确认] 检测到 "${intent.matchedPattern}" 操作，需要人工确认。请回复 "确认" 继续执行。`,
        skillId: intent.skillId,
        metadata: { requiresConfirmation: true, intent },
      }
    }

    // 3. 显式模式 → 直接执行（高置信度）
    // 4. 自动模式 → 执行
    const handler = this.handlers.get(intent.skillId)
    if (!handler) {
      return {
        success: false,
        output: `技能 "${intent.skillId}" 未注册`,
        skillId: intent.skillId,
      }
    }

    // 5. 执行技能
    const result = await handler.handler(input, context)

    // 6. 上下文回注：记录已调用技能
    context.previousSkills.push(intent.skillId)

    return result
  }

  /** 混合模式处理 */
  async routeHybrid(input: string, context: SkillContext): Promise<SkillResult | null> {
    // 优先级：显式口令 > 危险确认 > 自动识别

    // 检查是否包含显式口令（如 /search, /skill-xxx）
    const explicitMatch = input.match(/^\/(\w+)\s/)
    if (explicitMatch) {
      const skillId = `skill-${explicitMatch[1]}`
      const handler = this.handlers.get(skillId)
      if (handler) {
        return handler.handler(input.slice(explicitMatch[0].length), context)
      }
    }

    // 走正常意图识别路由
    return this.route(input, context)
  }
}

/** 单例 */
export const skillRouter = new SkillRouter()
