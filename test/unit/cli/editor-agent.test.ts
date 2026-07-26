import { describe, it, expect } from 'vitest';
import {
  agentToEditorContent,
  agentFromEditorContent,
} from '../../../src/cli/editor.js';

describe('agentToEditorContent', () => {
  it('serializes all fields into YAML frontmatter + role body', () => {
    const result = agentToEditorContent({
      name: 'Backend Agent',
      command: 'npm test',
      model: 'claude-sonnet-4-6',
      role: 'You are a backend developer.',
    });

    expect(result).toContain('---');
    expect(result).toContain('name: Backend Agent');
    expect(result).toContain('command: npm test');
    expect(result).toContain('model: claude-sonnet-4-6');
    expect(result).toContain('You are a backend developer.');
    // Comments should be present
    expect(result).toContain('# Edit agent configuration.');
    expect(result).toContain('# Lines starting with # are ignored.');
  });

  it('handles missing model (empty string)', () => {
    const result = agentToEditorContent({ name: 'Test', role: 'A role' });
    expect(result).toContain('model: ');
    expect(result).toContain('command: ');
    expect(result).toContain('name: Test');
    expect(result).toContain('A role');
  });

  it('handles missing role (empty string)', () => {
    const result = agentToEditorContent({ name: 'Test' });
    expect(result).toContain('name: Test');
    // Role part should be empty string at the end
    const lines = result.split('\n');
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toBe('');
  });

  it('preserves multiline role descriptions', () => {
    const role = 'Line 1\nLine 2\nLine 3';
    const result = agentToEditorContent({ name: 'Test', role });
    expect(result).toContain(role);
  });
});

describe('agentFromEditorContent', () => {
  it('parses complete content with comments, frontmatter and role', () => {
    const content = [
      '# Edit agent configuration.',
      '# Lines starting with # are ignored.',
      '# Role description goes below the second --- separator.',
      '---',
      'name: Backend Agent',
      'command: npm test',
      'model: claude-sonnet-4-6',
      '---',
      '',
      'You are a backend developer.',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    expect(parsed.name).toBe('Backend Agent');
    expect(parsed.command).toBe('npm test');
    expect(parsed.model).toBe('claude-sonnet-4-6');
    expect(parsed.role).toBe('You are a backend developer.');
  });

  it('strips comment lines before first --- but preserves # in body', () => {
    const content = [
      '# This is a comment',
      '# Another comment',
      '---',
      'name: Agent',
      'model: gpt-4',
      '---',
      '# This is a markdown heading in the role',
      'The real role.',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    expect(parsed.name).toBe('Agent');
    expect(parsed.model).toBe('gpt-4');
    // # lines in body are preserved (markdown headings, shell comments)
    expect(parsed.role).toBe('# This is a markdown heading in the role\nThe real role.');
  });

  it('returns role only when no frontmatter present', () => {
    const content = 'Just a plain role description.';
    const parsed = agentFromEditorContent(content);
    expect(parsed.name).toBeUndefined();
    expect(parsed.model).toBeUndefined();
    expect(parsed.role).toBe('Just a plain role description.');
  });

  it('handles empty role (body is empty)', () => {
    const content = [
      '---',
      'name: EmptyRole',
      'model: claude-sonnet-4-6',
      '---',
      '',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    expect(parsed.name).toBe('EmptyRole');
    expect(parsed.model).toBe('claude-sonnet-4-6');
    expect(parsed.role).toBe('');
  });

  it('handles empty model (value is blank)', () => {
    const content = [
      '---',
      'name: NoModel',
      'model: ',
      '---',
      '',
      'Some role',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    expect(parsed.name).toBe('NoModel');
    expect(parsed.model).toBe('');
    expect(parsed.role).toBe('Some role');
  });

  it('handles empty name (value is blank)', () => {
    const content = [
      '---',
      'name: ',
      'model: gpt-4',
      '---',
      '',
      'A role',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    expect(parsed.name).toBe('');
    expect(parsed.model).toBe('gpt-4');
    expect(parsed.role).toBe('A role');
  });

  it('handles completely empty content', () => {
    const parsed = agentFromEditorContent('');
    expect(parsed.name).toBeUndefined();
    expect(parsed.model).toBeUndefined();
    expect(parsed.role).toBeUndefined();
  });

  it('handles content with only comments', () => {
    const content = '# just a comment\n# another comment';
    const parsed = agentFromEditorContent(content);
    // After stripping comments, content is empty
    expect(parsed.role).toBeUndefined();
  });

  it('handles multiline role body', () => {
    const content = [
      '---',
      'name: Multi',
      'model: claude',
      '---',
      '',
      'Line 1',
      'Line 2',
      'Line 3',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    expect(parsed.role).toBe('Line 1\nLine 2\nLine 3');
  });

  it('ignores unknown frontmatter keys', () => {
    const content = [
      '---',
      'name: Agent',
      'model: claude',
      'unknown_key: some_value',
      '---',
      '',
      'Role here',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    expect(parsed.name).toBe('Agent');
    expect(parsed.model).toBe('claude');
    expect(parsed.role).toBe('Role here');
    // unknown_key should not appear
    expect(parsed).not.toHaveProperty('unknown_key');
  });

  it('roundtrips agentToEditorContent -> agentFromEditorContent', () => {
    const original = {
      name: 'Roundtrip Agent',
      model: 'claude-sonnet-4-6',
      role: 'You handle roundtrip tests.',
    };

    const content = agentToEditorContent(original);
    const parsed = agentFromEditorContent(content);

    expect(parsed.name).toBe(original.name);
    expect(parsed.model).toBe(original.model);
    expect(parsed.role).toBe(original.role);
  });

  it('roundtrips with empty optional fields', () => {
    const original = { name: 'Minimal' };
    const content = agentToEditorContent(original);
    const parsed = agentFromEditorContent(content);

    expect(parsed.name).toBe('Minimal');
    expect(parsed.command).toBe('');
    expect(parsed.model).toBe('');
    expect(parsed.role).toBe('');
  });

  // ── Regression tests for bug fixes ──────────────────────────

  // Bug#1 regression: agent add --edit must expose parsed.name and parsed.model
  // (previously only parsed.role was used, name/model from editor were ignored)
  it('Bug#1: parsed result contains name and model from editor for agent add --edit', () => {
    const content = [
      '# comment',
      '---',
      'name: OverriddenName',
      'model: overridden-model',
      '---',
      '',
      'Some role',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    // These fields must be present so agent add can use them
    expect(parsed.name).toBe('OverriddenName');
    expect(parsed.model).toBe('overridden-model');
    expect(parsed.role).toBe('Some role');
  });

  // Bug#2 regression: clearing fields returns '' (not undefined)
  // so agentService.update() can clear fields
  it('Bug#2: empty name/model in frontmatter returns empty string, not undefined', () => {
    const content = [
      '---',
      'name: ',
      'command: ',
      'model: ',
      '---',
      '',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    // Must be '' not undefined — '' allows clearing via update()
    expect(parsed.name).toBe('');
    expect(parsed.command).toBe('');
    expect(parsed.model).toBe('');
    expect(parsed.role).toBe('');
  });

  // Bug#3 regression: # lines in role body are preserved (markdown headings)
  it('Bug#3: markdown headings and shell comments in role body are NOT stripped', () => {
    const content = [
      '# This comment should be stripped',
      '---',
      'name: TestAgent',
      'model: claude',
      '---',
      '',
      '# Heading 1',
      '## Heading 2',
      'Normal text',
      '# Another heading',
      '#!/bin/bash',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    expect(parsed.role).toBe('# Heading 1\n## Heading 2\nNormal text\n# Another heading\n#!/bin/bash');
  });

  // Bug#4 regression: blank lines before --- after comment stripping don't break parsing
  it('Bug#4: blank lines between comments and --- do not break frontmatter parsing', () => {
    const content = [
      '# comment line 1',
      '# comment line 2',
      '',
      '',
      '---',
      'name: BlankLineAgent',
      'model: test-model',
      '---',
      '',
      'Role text here',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    expect(parsed.name).toBe('BlankLineAgent');
    expect(parsed.model).toBe('test-model');
    expect(parsed.role).toBe('Role text here');
  });

  it('Bug#4: single blank line before --- after comment removal', () => {
    const content = [
      '# only comment',
      '',
      '---',
      'name: X',
      'model: Y',
      '---',
      'role',
    ].join('\n');

    const parsed = agentFromEditorContent(content);
    expect(parsed.name).toBe('X');
    expect(parsed.model).toBe('Y');
    expect(parsed.role).toBe('role');
  });
});
