/**
 * ORCH Org Shop — pre-built AI company templates.
 *
 * Each template defines a team of agents from the Agent Shop,
 * ready to deploy with `orch org deploy <key>`.
 */

import type { AgentShopKey } from './agent-shop.js';

export interface OrgAgentEntry {
  /** Key from AGENT_SHOP_TEMPLATES */
  shop_key: AgentShopKey;
  /** Display name override (e.g., "CTO" instead of "Architect") */
  name: string;
}

export interface OrgTemplate {
  key: string;
  name: string;
  description: string;
  agents: OrgAgentEntry[];
  /** Index into agents[] — which agent is the team lead */
  lead_index: number;
}

export const ORG_TEMPLATES: OrgTemplate[] = [
  // ── Engineering ──
  {
    key: 'startup-mvp',
    name: 'Startup MVP',
    description: 'Ship an MVP in 48 hours',
    lead_index: 0,
    agents: [
      { shop_key: 'architect', name: 'CTO' },
      { shop_key: 'backend-dev', name: 'Backend' },
      { shop_key: 'backend-dev', name: 'Backend 2' },
      { shop_key: 'frontend-dev', name: 'Frontend' },
      { shop_key: 'qa-engineer', name: 'QA' },
      { shop_key: 'code-reviewer', name: 'Reviewer' },
    ],
  },
  {
    key: 'pr-review-corp',
    name: 'PR Review Corp',
    description: 'Automated review for every PR',
    lead_index: 0,
    agents: [
      { shop_key: 'architect', name: 'CTO' },
      { shop_key: 'security-auditor', name: 'Security' },
      { shop_key: 'performance-engineer', name: 'Performance' },
      { shop_key: 'code-reviewer', name: 'Style' },
      { shop_key: 'qa-engineer', name: 'QA' },
    ],
  },
  {
    key: 'migration-squad',
    name: 'Migration Squad',
    description: 'JS-to-TS migration over a weekend',
    lead_index: 0,
    agents: [
      { shop_key: 'architect', name: 'CTO' },
      { shop_key: 'fullstack-dev', name: 'Migrator' },
      { shop_key: 'fullstack-dev', name: 'Migrator 2' },
      { shop_key: 'fullstack-dev', name: 'Migrator 3' },
      { shop_key: 'qa-engineer', name: 'QA' },
      { shop_key: 'code-reviewer', name: 'Reviewer' },
    ],
  },
  {
    key: 'security-dept',
    name: 'Security Department',
    description: 'Multi-layer security audit',
    lead_index: 0,
    agents: [
      { shop_key: 'security-auditor', name: 'Lead Auditor' },
      { shop_key: 'security-auditor', name: 'Scanner' },
      { shop_key: 'security-auditor', name: 'Secrets Auditor' },
      { shop_key: 'bug-hunter', name: 'Hunter' },
      { shop_key: 'code-reviewer', name: 'Reviewer' },
    ],
  },
  {
    key: 'test-factory',
    name: 'Test Factory',
    description: 'Coverage from 40% to 80% overnight',
    lead_index: 0,
    agents: [
      { shop_key: 'qa-engineer', name: 'Coverage Lead' },
      { shop_key: 'backend-dev', name: 'Backend' },
      { shop_key: 'backend-dev', name: 'Backend 2' },
      { shop_key: 'qa-engineer', name: 'QA' },
      { shop_key: 'qa-engineer', name: 'QA 2' },
      { shop_key: 'code-reviewer', name: 'Reviewer' },
    ],
  },

  // ── Beyond Engineering ──
  {
    key: 'content-agency',
    name: 'Content Agency',
    description: 'Content factory: plan, write, edit, optimize',
    lead_index: 0,
    agents: [
      { shop_key: 'marketer', name: 'Strategist' },
      { shop_key: 'content-creator', name: 'Writer' },
      { shop_key: 'content-creator', name: 'Writer 2' },
      { shop_key: 'tech-writer', name: 'Editor' },
      { shop_key: 'growth-hacker', name: 'SEO' },
    ],
  },
  {
    key: 'data-lab',
    name: 'Data Lab',
    description: '3 CSVs to executive report by morning',
    lead_index: 0,
    agents: [
      { shop_key: 'data-engineer', name: 'Lead Analyst' },
      { shop_key: 'data-engineer', name: 'Data Engineer' },
    ],
  },
  {
    key: 'sales-machine',
    name: 'Sales Machine',
    description: 'Outbound pipeline: research, outreach, follow-up, close',
    lead_index: 0,
    agents: [
      { shop_key: 'marketer', name: 'Sales Director' },
      { shop_key: 'content-creator', name: 'SDR' },
      { shop_key: 'content-creator', name: 'SDR 2' },
      { shop_key: 'content-creator', name: 'Copywriter' },
      { shop_key: 'growth-hacker', name: 'Growth Analyst' },
    ],
  },
  {
    key: 'bugfix-dept',
    name: 'Bugfix Department',
    description: '100 issues to 0 in a week',
    lead_index: 0,
    agents: [
      { shop_key: 'architect', name: 'Triager' },
      { shop_key: 'bug-hunter', name: 'Fixer' },
      { shop_key: 'bug-hunter', name: 'Fixer 2' },
      { shop_key: 'bug-hunter', name: 'Fixer 3' },
      { shop_key: 'qa-engineer', name: 'QA' },
      { shop_key: 'code-reviewer', name: 'Reviewer' },
    ],
  },
  {
    key: 'docs-team',
    name: 'Docs Team',
    description: 'Technical docs from codebase analysis',
    lead_index: 0,
    agents: [
      { shop_key: 'architect', name: 'Docs Lead' },
      { shop_key: 'tech-writer', name: 'Writer' },
      { shop_key: 'tech-writer', name: 'Writer 2' },
      { shop_key: 'tech-writer', name: 'Editor' },
      { shop_key: 'code-reviewer', name: 'Reviewer' },
    ],
  },
];

export function getOrgTemplateByKey(key: string): OrgTemplate | undefined {
  return ORG_TEMPLATES.find((t) => t.key === key);
}
