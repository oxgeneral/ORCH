/**
 * Agent factory — converts shop templates into CreateAgentInput.
 *
 * Resolves adapter-specific model from the template's semantic tier
 * and filters MCP skills (colon-format) for non-Claude adapters.
 */

import type { AgentShopTemplate } from '../domain/agent-shop.js';
import type { CreateAgentInput } from '../domain/agent.js';
import { resolveModel } from '../domain/model-tiers.js';

/** MCP skills use colon-separated names (e.g. `package:skill-name`). */
export function isMcpSkill(skill: string): boolean {
  return skill.includes(':');
}

/**
 * Convert a shop template into CreateAgentInput for the given adapter.
 *
 * - Resolves the concrete model string from adapter + tier
 * - Filters out MCP skills for non-Claude adapters (they only work with Claude CLI)
 */
export function templateToAgentInput(
  template: AgentShopTemplate,
  adapter: string,
): CreateAgentInput {
  const model = resolveModel(adapter, template.tier);
  const skills = adapter === 'claude'
    ? template.skills
    : template.skills.filter((s) => !isMcpSkill(s));

  return {
    name: template.name,
    adapter,
    model: model || undefined,
    role: template.role,
    skills,
    approval_policy: template.approval_policy,
  };
}
