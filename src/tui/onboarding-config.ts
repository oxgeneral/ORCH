/**
 * Empty-state onboarding tips for each top-level TUI tab.
 *
 * Kept in their own module so non-TUI consumers (regression tests, docs
 * generators) can import them without pulling in the whole React app.
 */

import type { OnboardingConfig } from './components/OnboardingBox.js';

export const ONBOARDING_GOALS: OnboardingConfig = {
  title: 'Goals',
  description: [
    'Define what your team should achieve.',
    'The orchestrator breaks goals into tasks',
    'and assigns them to agents automatically.',
  ],
  hints: [{ key: 'N', label: 'new goal' }, { key: '/', label: 'commands' }],
  nudge: 'Add more goals to keep your team focused.',
};

export const ONBOARDING_TASKS: OnboardingConfig = {
  title: 'Tasks',
  description: [
    'Units of work dispatched to agents.',
    'Create them manually or let goals',
    'generate them automatically.',
  ],
  hints: [{ key: 'N', label: 'new task' }, { key: 'W', label: 'start orchestrator' }],
  nudge: 'Add more tasks to keep agents busy.',
};

export const ONBOARDING_AGENTS: OnboardingConfig = {
  title: 'Agents',
  description: [
    'AI workers that execute your tasks.',
    'Adapters: claude, opencode, codex, cursor,',
    'pi, grok, antigravity, shell.',
  ],
  hints: [{ key: 'N', label: 'new agent' }, { key: 'W', label: 'start orchestrator' }],
  nudge: 'Add more agents to increase parallelism.',
};
