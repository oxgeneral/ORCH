/**
 * Tests for org shop templates.
 */
import { describe, it, expect } from 'vitest';
import { ORG_TEMPLATES, getOrgTemplateByKey } from '../../../src/domain/org-shop.js';
import { getShopTemplateByKey } from '../../../src/domain/agent-shop.js';

describe('ORG_TEMPLATES', () => {
  it('has 10 templates', () => {
    expect(ORG_TEMPLATES.length).toBe(10);
  });

  it('all templates have unique keys', () => {
    const keys = ORG_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('all templates have at least 2 agents', () => {
    for (const t of ORG_TEMPLATES) {
      expect(t.agents.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('lead_index is valid for all templates', () => {
    for (const t of ORG_TEMPLATES) {
      expect(t.lead_index).toBeGreaterThanOrEqual(0);
      expect(t.lead_index).toBeLessThan(t.agents.length);
    }
  });

  it('all agent shop_keys reference valid shop templates', () => {
    for (const t of ORG_TEMPLATES) {
      for (const entry of t.agents) {
        const shopTemplate = getShopTemplateByKey(entry.shop_key);
        expect(shopTemplate, `${t.key} → ${entry.shop_key}`).toBeDefined();
      }
    }
  });

  it('all agents have non-empty names', () => {
    for (const t of ORG_TEMPLATES) {
      for (const entry of t.agents) {
        expect(entry.name.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('all templates have required fields', () => {
    for (const t of ORG_TEMPLATES) {
      expect(t.key).toBeDefined();
      expect(t.name).toBeDefined();
      expect(t.description).toBeDefined();
      expect(t.agents).toBeDefined();
      expect(typeof t.lead_index).toBe('number');
    }
  });
});

describe('getOrgTemplateByKey()', () => {
  it('finds startup-mvp', () => {
    const t = getOrgTemplateByKey('startup-mvp');
    expect(t).toBeDefined();
    expect(t!.name).toBe('Startup MVP');
  });

  it('returns undefined for unknown key', () => {
    expect(getOrgTemplateByKey('nonexistent')).toBeUndefined();
  });

  it('startup-mvp has 6 agents with architect as lead', () => {
    const t = getOrgTemplateByKey('startup-mvp')!;
    expect(t.agents).toHaveLength(6);
    expect(t.agents[t.lead_index]!.shop_key).toBe('architect');
    expect(t.agents[t.lead_index]!.name).toBe('CTO');
  });
});
