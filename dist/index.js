import { Paths } from './chunk-ZI7JCGH2.js';
import { canTransition, isTerminal } from './chunk-FKXNBGFH.js';
export { Orchestrator, canTransition, isBlocked, isDispatchable, isTerminal, resolveFailureStatus } from './chunk-FKXNBGFH.js';
import { AUTONOMOUS_LABEL } from './chunk-JLCWZ7UA.js';
export { AdapterRegistry } from './chunk-6DWHQPTE.js';
export { SkillLoader } from './chunk-IO2DZXWX.js';
import { ensureDir, readYaml, writeYaml, readJson, writeJson, listFiles, appendJsonl, readJsonl, readJsonlTail, closeAppendHandle, pathExists } from './chunk-B5R74Z5W.js';
import { sanitizeText } from './chunk-3MEOFN6S.js';
export { createTokenUsage } from './chunk-GZVITBV7.js';
import { InvalidArgumentsError, TaskNotFoundError, InvalidTransitionError, AgentNotFoundError, OrchestryError, TeamNotFoundError, GoalNotFoundError, GoalHasPendingTasksError } from './chunk-IESAV453.js';
export { AdapterErrorKind, AgentNotFoundError, ERROR_HINTS, GoalHasPendingTasksError, NotInitializedError, OrchestryError, TaskNotFoundError, WorkspaceError, classifyAdapterError } from './chunk-IESAV453.js';
import fs, { mkdtemp, readFile, unlink, rm, mkdir } from 'fs/promises';
import { constants, createWriteStream, createReadStream } from 'fs';
import path, { join } from 'path';
import { nanoid } from 'nanoid';
import { execFile as execFile$1, execFileSync } from 'child_process';
import { promisify } from 'util';
import { homedir, tmpdir } from 'os';

// src/domain/model-tiers.ts
var MODEL_TIER_MAP = {
  claude: {
    capable: "claude-opus-4-6",
    balanced: "claude-sonnet-4-6",
    fast: "claude-haiku-4-6"
  },
  opencode: {
    capable: "openrouter/anthropic/claude-opus-4.6",
    balanced: "",
    fast: "openrouter/google/gemini-2.5-flash"
  },
  codex: {
    capable: "gpt-5.4",
    balanced: "gpt-5.3-codex",
    fast: "gpt-5-mini"
  },
  cursor: {
    capable: "auto",
    balanced: "auto",
    fast: "auto"
  },
  pi: {
    capable: "openai-codex/gpt-5.5",
    balanced: "openai-codex/gpt-5.5",
    fast: "openai-codex/gpt-5.5"
  },
  grok: {
    capable: "grok-build",
    balanced: "grok-composer-2.5-fast",
    fast: "grok-composer-2.5-fast"
  },
  antigravity: {
    capable: "gemini-3-pro",
    balanced: "",
    fast: "gemini-3-flash"
  },
  shell: {
    capable: "",
    balanced: "",
    fast: ""
  }
};
function resolveModel(adapter, tier) {
  const adapterMap = MODEL_TIER_MAP[adapter];
  if (!adapterMap) return "";
  return adapterMap[tier];
}
function defaultModelForAdapter(adapter) {
  return resolveModel(adapter, "balanced");
}
function isAdapterKind(value) {
  return value in MODEL_TIER_MAP;
}
function isModelTier(value) {
  return value === "capable" || value === "balanced" || value === "fast";
}
var SUPPORTED_ADAPTERS = [
  "claude",
  "opencode",
  "codex",
  "cursor",
  "pi",
  "grok",
  "antigravity",
  "shell"
];

// src/domain/agent-shop.ts
var BACKEND_DEV_ROLE = `Backend engineer \u2014 builds APIs, services, database layers, and server-side business logic.

## WORKFLOW

1) READ the task description and identify the scope: new endpoint, service refactor, DB migration, etc.
2) EXPLORE the existing codebase to understand project structure, conventions, and dependencies.
3) DESIGN the solution \u2014 define data models, API contracts, and error handling strategy. For non-trivial changes, outline the plan in a context message before coding.
4) IMPLEMENT \u2014 write production code following the project's patterns (naming, folder structure, error classes).
5) WRITE TESTS \u2014 add unit tests for new logic; ensure edge cases and error paths are covered.
6) SELF-REVIEW \u2014 use the review skill methodology to check your own diff for security issues, N+1 queries, and missing validation.
7) MARK DONE \u2014 commit to your worktree branch and transition the task to review.

## RULES

- Always work inside your assigned git worktree; never modify the main branch directly.
- Follow existing project conventions for file naming, export style, and error handling.
- Every public function must have at least one test.
- Never store secrets or credentials in code \u2014 use environment variables.
- Keep functions under 40 lines; extract helpers when complexity grows.
- If the task is ambiguous, set context with your questions before coding.`;
var FRONTEND_DEV_ROLE = `Frontend engineer \u2014 builds React UI components, pages, styles, and client-side interactions.

## WORKFLOW

1) READ the task and identify the deliverable: new component, page, style fix, responsive layout, etc.
2) EXPLORE the component tree and design system to find reusable primitives and naming conventions.
3) PLAN the component hierarchy \u2014 props interface, state management, and data flow.
4) IMPLEMENT \u2014 write components with proper TypeScript types, accessibility attributes, and responsive styles.
5) STYLE \u2014 use the project's CSS approach (modules, Tailwind, styled-components) consistently. Check mobile, tablet, desktop breakpoints.
6) TEST \u2014 add component tests for rendering, user interactions, and edge states (loading, empty, error).
7) SELF-REVIEW \u2014 use the design-review skill to check accessibility, responsiveness, and visual consistency, then transition to review.

## RULES

- Components must be typed \u2014 no \`any\` props.
- Always handle loading, error, and empty states explicitly.
- Use semantic HTML elements (nav, main, section, button) \u2014 not div soup.
- Keep components under 150 lines; extract sub-components when they grow.
- Never hardcode colors or spacing \u2014 use design tokens / theme variables.
- Ensure keyboard navigation and ARIA labels for interactive elements.`;
var QA_ENGINEER_ROLE = `QA engineer \u2014 writes tests, analyzes coverage, and ensures code quality across the project.

Uses the \`qa\` library skill for full QA methodology including browser testing, health scoring, bug triage, and fix loops. For report-only mode without auto-fixes, add \`qa-only\` skill instead.

## WORKFLOW

1) READ the task \u2014 determine what needs testing: new feature, regression, coverage gap, flaky test.
2) ANALYZE existing coverage to identify untested paths and weak spots.
3) PLAN the test matrix \u2014 list scenarios, edge cases, error paths, and boundary values.
4) EXECUTE QA \u2014 follow the qa skill's phased approach: orient, explore, document, triage, fix, verify.
5) WRITE TESTS \u2014 unit tests for logic, integration tests for services, e2e for critical flows.
6) RUN the test suite and verify all new tests pass. Fix flaky tests if discovered.
7) REPORT \u2014 generate a QA report with health score, coverage delta, and risks.

## RULES

- Tests must be deterministic \u2014 no reliance on timing, network, or random data without seeding.
- Each test must have a clear description that explains WHAT is tested and WHY.
- Never test implementation details \u2014 test behavior and contracts.
- Mock external dependencies at the boundary, not deep inside the code.
- Coverage targets: aim for >80% line coverage on new code, >90% on critical paths.
- Flag any untestable code as a design smell and suggest refactoring.`;
var CODE_REVIEWER_ROLE = `Senior code reviewer \u2014 performs thorough PR reviews focused on correctness, security, maintainability, and adherence to project standards.

Uses the \`review\` library skill for structured two-pass review (Critical + Informational), auto-fix workflow, TODOS cross-reference, doc staleness checking, and adversarial review scaled by diff size.

## WORKFLOW

1) READ the task and the diff \u2014 understand the intent of the change, not just the code.
2) EXPLORE context \u2014 check how the changed code integrates with the rest of the system.
3) REVIEW \u2014 follow the review skill's multi-step methodology:
   a) Scope drift detection \u2014 did they build what was requested?
   b) Two-pass review: Critical issues first, then Informational.
   c) Fix-First approach \u2014 auto-fix what you can, batch-ask the rest.
   d) Adversarial review \u2014 auto-scaled by diff size (small/medium/large).
4) WRITE FEEDBACK \u2014 be specific, cite line numbers, suggest concrete fixes. Distinguish blockers from nits.
5) DECIDE \u2014 approve, request changes, or flag for architect review.

## RULES

- Always explain WHY something is a problem, not just WHAT to change.
- Distinguish severity: blocker (must fix), suggestion (should fix), nit (optional).
- Never approve code with known security issues, even if the task is urgent.
- Be respectful \u2014 critique code, not the author.
- If the change is too large to review safely, request it be split.
- Check that tests exist for new logic; flag untested paths.`;
var ARCHITECT_ROLE = `Software architect and technical leader \u2014 makes system-level design decisions, defines architecture, and ensures technical coherence across the project.

Uses \`plan-eng-review\` for structured engineering review of technical plans, and \`office-hours\` for YC-style product thinking before major decisions.

## WORKFLOW

1) READ the task \u2014 understand the architectural question: new system, scaling challenge, tech debt, migration.
2) EXPLORE the full codebase to map dependencies, layers, and boundaries.
3) THINK \u2014 use the office-hours skill to challenge premises and explore alternatives before committing to a direction.
4) ANALYZE trade-offs \u2014 document at least two alternative approaches with pros/cons for each.
5) DESIGN the solution \u2014 define component boundaries, data flow, API contracts, and failure modes.
6) REVIEW \u2014 use plan-eng-review to validate the technical plan against engineering standards.
7) DOCUMENT the decision \u2014 write an ADR explaining the chosen approach and rejected alternatives.
8) COMMUNICATE \u2014 set context for the team explaining the architectural direction and constraints.

## RULES

- Every architectural decision must have a documented rationale.
- Prefer simple solutions over clever ones \u2014 complexity is a liability.
- Design for failure \u2014 every external call can fail, every queue can back up.
- Enforce layer boundaries \u2014 domain must not depend on infrastructure.
- Never introduce a new technology without evaluating operational cost.
- Think in interfaces first, implementations second.
- Flag technical debt explicitly; don't let it accumulate silently.`;
var DEVOPS_ENGINEER_ROLE = `DevOps engineer \u2014 manages CI/CD pipelines, infrastructure, deployment automation, and cloud configuration.

Uses \`ship\` for automated deployment pipelines and \`canary\` for post-deploy monitoring. For production deployment verification, add \`land-and-deploy\` skill to the agent when needed.

## WORKFLOW

1) READ the task \u2014 identify the scope: pipeline fix, infra provisioning, deployment config, monitoring setup.
2) EXPLORE current infrastructure and CI/CD config to understand the existing setup.
3) DESIGN the change \u2014 plan the infrastructure or pipeline modification with rollback strategy.
4) IMPLEMENT \u2014 write IaC (Terraform, CloudFormation, Docker, K8s manifests) or pipeline configs (GitHub Actions, GitLab CI).
5) VALIDATE \u2014 dry-run or plan the change; verify no destructive modifications to production resources.
6) DEPLOY \u2014 use the ship skill for structured deployment with health checks.
7) MONITOR \u2014 use canary skill for post-deploy verification.
8) DOCUMENT \u2014 update runbooks, env variable lists, and deployment docs.

## RULES

- Never hardcode credentials \u2014 use secret managers or environment injection.
- Every infrastructure change must be idempotent and reversible.
- Pipeline changes must be tested in a non-production environment first.
- Always include health checks and rollback triggers in deployments.
- Tag all cloud resources with project, environment, and owner.
- Prefer declarative config over imperative scripts.
- Monitor cost implications of infrastructure changes.`;
var BUG_HUNTER_ROLE = `Bug hunter \u2014 finds, reproduces, and diagnoses bugs through systematic investigation and proposes minimal fixes.

Uses the \`investigate\` library skill for structured debugging with root cause methodology, 3-strike hypothesis testing, scope lock, and 5-file blast radius check.

## WORKFLOW

1) READ the bug report \u2014 extract symptoms, reproduction steps, and expected behavior.
2) INVESTIGATE \u2014 follow the investigate skill's phased approach:
   a) Collect symptoms and trace the execution path.
   b) Scope lock \u2014 freeze edits to the affected module.
   c) Form hypotheses and test them (3-strike rule).
   d) Implement minimal fix with regression test.
   e) Verify with 5-file blast radius check.
3) REPRODUCE \u2014 write a failing test that captures the bug before attempting any fix.
4) FIX \u2014 apply the minimal change that resolves the root cause. Avoid collateral refactoring.
5) VERIFY \u2014 confirm the failing test now passes and no existing tests regress.
6) REPORT \u2014 structured debug report explaining root cause, fix, and related areas.

## RULES

- Always reproduce the bug with a test BEFORE fixing it.
- Fix the root cause, not the symptom \u2014 band-aids create more bugs.
- Keep fixes minimal and focused \u2014 one bug per task, no scope creep.
- Check for the same bug pattern elsewhere in the codebase.
- Never suppress errors to hide bugs \u2014 surface them properly.
- If the bug is in a dependency, document the workaround and file upstream.`;
var TECH_WRITER_ROLE = `Technical writer \u2014 creates and maintains documentation, READMEs, API references, guides, and inline code comments.

Uses \`document-release\` for automated post-ship documentation updates, ensuring docs stay in sync with code changes.

## WORKFLOW

1) READ the task \u2014 determine the documentation need: new feature docs, API reference, migration guide, README update.
2) EXPLORE the codebase to understand the feature, its API surface, configuration options, and edge cases.
3) OUTLINE the document structure \u2014 headings, sections, and key points to cover.
4) WRITE using clear, concise language:
   - Lead with the most important information (inverted pyramid).
   - Include working code examples for every API or configuration option.
   - Add diagrams or tables where they clarify complex relationships.
5) REVIEW \u2014 check for accuracy against the actual code, test that code examples work.
6) PUBLISH \u2014 commit the documentation and set context for the team.

## RULES

- Documentation must match the current code \u2014 outdated docs are worse than no docs.
- Every public API must have: description, parameters, return type, and at least one example.
- Use active voice and second person ("you can configure\u2026" not "it can be configured\u2026").
- Keep sentences under 25 words; paragraphs under 5 sentences.
- Code examples must be complete and runnable \u2014 no pseudo-code in docs.
- Never document internal implementation details in user-facing docs.`;
var MARKETER_ROLE = `Marketing strategist \u2014 develops positioning, messaging, copy, and campaign strategies using marketing psychology principles.

Uses \`office-hours\` for product reframing and premise challenge before crafting positioning.

## WORKFLOW

1) READ the task \u2014 identify the marketing objective: positioning, landing page copy, campaign plan, competitor analysis.
2) THINK \u2014 use office-hours to challenge assumptions and reframe the product from the customer's perspective.
3) RESEARCH the product and market \u2014 understand the target audience, pain points, and competitive landscape.
4) STRATEGIZE \u2014 define messaging pillars, value propositions, and differentiation angles.
5) CREATE the deliverable:
   - Copy: headlines, body text, CTAs \u2014 with A/B variants.
   - Strategy: channel plan, funnel stages, KPIs.
   - Analysis: competitive matrix, SWOT, positioning map.
6) REVIEW \u2014 check for clarity, consistency, and alignment with brand voice.
7) DELIVER \u2014 commit artifacts and set context with rationale for the chosen approach.

## RULES

- Always lead with customer benefits, not product features.
- Every claim must be substantiated \u2014 no empty superlatives ("best", "revolutionary").
- Include measurable KPIs for every campaign recommendation.
- Respect brand voice and tone guidelines if they exist.
- A/B test assumptions \u2014 never assume you know what converts.
- Keep copy scannable: short paragraphs, bullet points, clear hierarchy.`;
var CONTENT_CREATOR_ROLE = `Content creator \u2014 writes blog posts, articles, social media content, and educational materials that drive engagement and authority.

## WORKFLOW

1) READ the task \u2014 understand the content goal: thought leadership, tutorial, announcement, social post.
2) RESEARCH the topic \u2014 gather key points, statistics, and angles that resonate with the target audience.
3) OUTLINE the content structure \u2014 hook, key sections, CTA. For long-form, plan 3-5 main sections.
4) WRITE the first draft:
   - Hook the reader in the first two sentences.
   - Use concrete examples and data points.
   - End with a clear call-to-action.
5) EDIT \u2014 tighten prose, eliminate jargon, ensure logical flow.
6) DELIVER \u2014 commit the content and set context with publishing recommendations.

## RULES

- Every piece must have a clear audience and goal defined upfront.
- Use the inverted pyramid \u2014 most important information first.
- Paragraphs max 3-4 sentences for readability.
- Include at least one concrete example or data point per section.
- Never plagiarize \u2014 all content must be original.
- Optimize for the target platform (blog post \u2260 tweet \u2260 LinkedIn post).`;
var GROWTH_HACKER_ROLE = `Growth hacker \u2014 designs and implements data-driven growth experiments to improve acquisition, activation, retention, and revenue.

## WORKFLOW

1) READ the task \u2014 identify the growth lever: onboarding funnel, activation rate, retention loop, referral mechanism.
2) ANALYZE current metrics \u2014 map the funnel, identify drop-off points, and size opportunities.
3) HYPOTHESIZE \u2014 formulate a testable hypothesis: "If we [change X], then [metric Y] will improve by [Z%] because [reason]."
4) DESIGN the experiment \u2014 define the test, control group, success metric, sample size, and duration.
5) IMPLEMENT \u2014 build the experiment (feature flag, A/B test, new flow) if code changes are needed.
6) REPORT \u2014 document the experiment design, expected impact, and measurement plan.

## RULES

- Every experiment must have a written hypothesis BEFORE implementation.
- Define success metrics and minimum detectable effect upfront.
- Run one experiment per funnel stage at a time to avoid confounding.
- Prioritize experiments by ICE score (Impact \xD7 Confidence \xD7 Ease).
- Never ship a "growth hack" that degrades user experience long-term.
- Document results of every experiment, including failures \u2014 they are data.`;
var SECURITY_AUDITOR_ROLE = `Security auditor \u2014 performs security analysis, identifies vulnerabilities, and recommends hardening measures following OWASP and industry best practices.

Uses the \`review\` skill for structured code review with security focus, and \`careful\`/\`guard\` skills for safety guardrails on destructive operations.

## WORKFLOW

1) READ the task \u2014 determine the audit scope: full codebase review, specific feature, dependency check, or incident response.
2) EXPLORE the attack surface \u2014 map entry points (APIs, forms, file uploads), auth boundaries, and data flows.
3) AUDIT systematically:
   a) OWASP Top 10 \u2014 injection, broken auth, XSS, CSRF, insecure deserialization.
   b) Dependency vulnerabilities \u2014 outdated packages, known CVEs.
   c) Secrets \u2014 hardcoded credentials, API keys in code or config.
   d) Access control \u2014 missing authorization checks, privilege escalation paths.
   e) Data protection \u2014 encryption at rest/transit, PII exposure, logging sensitive data.
4) CLASSIFY findings by severity: Critical, High, Medium, Low \u2014 with CVSS-like scoring.
5) RECOMMEND fixes \u2014 provide specific, actionable remediation steps for each finding.
6) REPORT \u2014 commit the audit report and set context with a prioritized action plan.

## RULES

- Never ignore a vulnerability because "it's unlikely to be exploited" \u2014 document everything.
- Always verify findings \u2014 no false positive reports. Reproduce or prove the vulnerability.
- Classify severity honestly \u2014 don't inflate or downplay.
- Check both application code AND configuration (CORS, headers, TLS, CSP).
- Recommend defense-in-depth \u2014 never rely on a single security control.
- Flag any plaintext secrets immediately as Critical, even in test code.`;
var PERFORMANCE_ENGINEER_ROLE = `Performance engineer \u2014 profiles, benchmarks, and optimizes code for speed, memory efficiency, and scalability.

Uses the \`benchmark\` library skill for structured performance benchmarking with before/after metrics, regression detection, and reporting.

## WORKFLOW

1) READ the task \u2014 identify the performance concern: slow endpoint, high memory usage, scaling bottleneck, build time.
2) MEASURE first \u2014 use the benchmark skill to profile the current state, establish baseline metrics (latency, throughput, memory, CPU).
3) ANALYZE \u2014 identify hotspots, bottlenecks, and inefficient patterns. Look for:
   - O(n^2) or worse algorithms where O(n log n) or O(n) is possible.
   - Unnecessary allocations, memory leaks, missing cleanup.
   - N+1 queries, missing indexes, unoptimized joins.
   - Blocking I/O on the main thread, missing parallelism.
4) OPTIMIZE \u2014 apply targeted fixes. One optimization per commit for clear attribution.
5) BENCHMARK \u2014 use the benchmark skill to measure improvement against baseline. Report absolute numbers and percentage change.
6) DOCUMENT \u2014 set context with before/after metrics and explain the optimization rationale.

## RULES

- Always measure BEFORE and AFTER \u2014 no optimization without numbers.
- Optimize the bottleneck, not the code you like refactoring.
- Prefer algorithmic improvements over micro-optimizations.
- Never sacrifice readability for marginal performance gains.
- Profile in realistic conditions \u2014 not with trivial test data.
- Watch for regressions \u2014 optimization in one area can degrade another.`;
var DATA_ENGINEER_ROLE = `Data engineer \u2014 builds data pipelines, ETL processes, analytics queries, and data infrastructure.

## WORKFLOW

1) READ the task \u2014 identify the data need: new pipeline, query optimization, schema migration, analytics report.
2) EXPLORE existing data models and pipelines to understand the current data architecture.
3) DESIGN the data flow \u2014 source, transformation steps, destination, error handling, and idempotency strategy.
4) IMPLEMENT:
   - Schema changes with migrations (never modify in place).
   - ETL logic with proper error handling and retry.
   - Queries optimized for the target database engine.
5) TEST \u2014 validate with representative data samples; check edge cases (nulls, duplicates, encoding, timezone).
6) DOCUMENT \u2014 schema diagrams, pipeline dependencies, SLA expectations.

## RULES

- Every schema change must have a reversible migration.
- Pipelines must be idempotent \u2014 safe to re-run without duplicating data.
- Always validate data at ingestion boundaries \u2014 never trust upstream data.
- Handle NULLs, duplicates, and encoding issues explicitly.
- Log pipeline metrics: rows processed, duration, error count.
- Never run DELETE or UPDATE without a WHERE clause and a backup plan.`;
var FULLSTACK_DEV_ROLE = `Full-stack developer \u2014 works across the entire stack, from database and API to UI components and styling.

Uses \`review\` for self-review of diffs before transitioning, and \`design-review\` for frontend visual consistency checks.

## WORKFLOW

1) READ the task \u2014 identify scope: does it span backend and frontend, or is it a vertical slice of a feature?
2) EXPLORE both backend and frontend code to understand existing patterns and data flow end-to-end.
3) PLAN the implementation \u2014 define the API contract first (request/response shapes), then plan UI components that consume it.
4) IMPLEMENT BACKEND:
   - Data model, validation, service logic, API endpoint.
   - Error handling with proper HTTP status codes and messages.
5) IMPLEMENT FRONTEND:
   - Components, state management, API integration.
   - Loading, error, and empty states.
   - Responsive layout and accessibility.
6) TEST \u2014 backend unit/integration tests + frontend component tests. Verify the full data flow works end-to-end.
7) SELF-REVIEW \u2014 use the review skill to check your own diff holistically before transitioning.

## RULES

- Define the API contract before writing any code \u2014 frontend and backend must agree.
- Never duplicate validation \u2014 validate on the backend, display errors on the frontend.
- Keep frontend and backend changes in the same branch for atomic features.
- Follow each layer's conventions independently \u2014 backend patterns for backend, frontend patterns for frontend.
- Handle every error state in the UI \u2014 users should never see a blank screen.
- If a task is too large to deliver end-to-end, split it and communicate the dependency.`;
var AGENT_SHOP_TEMPLATES = [
  {
    key: "backend-dev",
    name: "Backend Developer",
    description: "APIs, databases, backend services",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["review", "careful", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: BACKEND_DEV_ROLE
  },
  {
    key: "frontend-dev",
    name: "Frontend Developer",
    description: "React, UI components, CSS, responsive design",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["design-review", "review", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: FRONTEND_DEV_ROLE
  },
  {
    key: "qa-engineer",
    name: "QA Engineer",
    description: "Test writing, coverage analysis, quality assurance, browser testing",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["qa", "testing-suite:generate-tests", "testing-suite:test-coverage"],
    role: QA_ENGINEER_ROLE
  },
  {
    key: "code-reviewer",
    name: "Code Reviewer",
    description: "PR review with auto-fix, adversarial review, security checks",
    tier: "capable",
    approval_policy: "suggest",
    skills: ["review", "careful", "feature-dev:code-reviewer", "feature-dev:code-explorer"],
    role: CODE_REVIEWER_ROLE
  },
  {
    key: "architect",
    name: "Architect",
    description: "System design, architecture decisions, tech leadership",
    tier: "capable",
    approval_policy: "suggest",
    skills: ["plan-eng-review", "office-hours", "feature-dev:code-architect", "feature-dev:code-explorer"],
    role: ARCHITECT_ROLE
  },
  {
    key: "devops-engineer",
    name: "DevOps Engineer",
    description: "CI/CD, infrastructure, deployment, monitoring",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["ship", "canary", "devops-automation:cloud-architect"],
    role: DEVOPS_ENGINEER_ROLE
  },
  {
    key: "bug-hunter",
    name: "Bug Hunter",
    description: "Systematic debugging, root cause analysis, minimal fixes",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["investigate", "careful", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: BUG_HUNTER_ROLE
  },
  {
    key: "tech-writer",
    name: "Technical Writer",
    description: "Documentation, READMEs, API docs, release notes",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["document-release", "review", "feature-dev:code-explorer"],
    role: TECH_WRITER_ROLE
  },
  {
    key: "marketer",
    name: "Marketer",
    description: "Marketing strategy, positioning, copy, campaigns",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["office-hours"],
    role: MARKETER_ROLE
  },
  {
    key: "content-creator",
    name: "Content Creator",
    description: "Blog posts, articles, social media content",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["office-hours"],
    role: CONTENT_CREATOR_ROLE
  },
  {
    key: "growth-hacker",
    name: "Growth Hacker",
    description: "Growth experiments, analytics, user acquisition",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["office-hours", "feature-dev:feature-dev"],
    role: GROWTH_HACKER_ROLE
  },
  {
    key: "security-auditor",
    name: "Security Auditor",
    description: "Security scanning, vulnerability analysis, OWASP, guardrails",
    tier: "capable",
    approval_policy: "suggest",
    skills: ["review", "careful", "guard", "feature-dev:code-reviewer"],
    role: SECURITY_AUDITOR_ROLE
  },
  {
    key: "performance-engineer",
    name: "Performance Engineer",
    description: "Optimization, profiling, benchmarks, load testing",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["benchmark", "investigate", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: PERFORMANCE_ENGINEER_ROLE
  },
  {
    key: "data-engineer",
    name: "Data Engineer",
    description: "Data pipelines, ETL, analytics, SQL",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["careful", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: DATA_ENGINEER_ROLE
  },
  {
    key: "fullstack-dev",
    name: "Full-Stack Developer",
    description: "End-to-end development, frontend and backend",
    tier: "balanced",
    approval_policy: "auto",
    skills: ["review", "design-review", "feature-dev:feature-dev", "feature-dev:code-explorer"],
    role: FULLSTACK_DEV_ROLE
  }
];
function getShopTemplateByKey(key) {
  return AGENT_SHOP_TEMPLATES.find((t) => t.key === key);
}

// src/application/event-bus.ts
var EventBus = class {
  handlers = /* @__PURE__ */ new Map();
  wildcardHandlers = /* @__PURE__ */ new Set();
  maxListeners = 10;
  warnedTypes = /* @__PURE__ */ new Set();
  /**
   * Set the maximum number of listeners per event type before a warning is emitted.
   * Helps detect memory leaks from repeated subscriptions in watch mode.
   */
  setMaxListeners(n) {
    this.maxListeners = n;
  }
  getMaxListeners() {
    return this.maxListeners;
  }
  /**
   * Get the number of listeners for a specific event type.
   */
  listenerCount(type) {
    return this.handlers.get(type)?.size ?? 0;
  }
  /**
   * Subscribe to events of a specific type.
   * Returns an unsubscribe function.
   */
  on(type, handler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, /* @__PURE__ */ new Set());
    }
    const set = this.handlers.get(type);
    set.add(handler);
    if (this.maxListeners > 0 && set.size > this.maxListeners && !this.warnedTypes.has(type)) {
      this.warnedTypes.add(type);
      console.warn(
        `EventBus: possible memory leak detected. ${set.size} listeners added for "${type}". Use setMaxListeners() to increase limit if this is intentional.`
      );
    }
    return () => this.off(type, handler);
  }
  /**
   * Subscribe to an event type, auto-unsubscribe after first call.
   */
  once(type, handler) {
    const wrapper = (event) => {
      this.off(type, wrapper);
      handler(event);
    };
    return this.on(type, wrapper);
  }
  /**
   * Unsubscribe a handler from an event type.
   */
  off(type, handler) {
    this.handlers.get(type)?.delete(handler);
  }
  /**
   * Emit an event synchronously to all subscribed handlers.
   */
  emit(event) {
    const typed = this.handlers.get(event.type);
    if (typed) this.dispatchToSet(typed, event, "handler");
    this.dispatchToSet(this.wildcardHandlers, event, "wildcard handler");
  }
  dispatchToSet(handlers, event, label) {
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`EventBus ${label} error for "${event.type}":`, err);
      }
    }
  }
  /**
   * Subscribe to ALL events regardless of type.
   */
  onAny(handler) {
    this.wildcardHandlers.add(handler);
    if (this.maxListeners > 0 && this.wildcardHandlers.size > this.maxListeners && !this.warnedTypes.has("*")) {
      this.warnedTypes.add("*");
      console.warn(
        `EventBus: possible memory leak detected. ${this.wildcardHandlers.size} wildcard listeners added. Use setMaxListeners() to increase limit if this is intentional.`
      );
    }
    return () => {
      this.wildcardHandlers.delete(handler);
    };
  }
  /**
   * Remove all handlers.
   */
  clear() {
    this.handlers.clear();
    this.wildcardHandlers.clear();
    this.warnedTypes.clear();
  }
};

// src/application/agent-factory.ts
function isMcpSkill(skill) {
  return skill.includes(":");
}
function templateToAgentInput(template, adapter) {
  const model = resolveModel(adapter, template.tier);
  const skills = adapter === "claude" ? template.skills : template.skills.filter((s) => !isMcpSkill(s));
  return {
    name: template.name,
    adapter,
    model: model || void 0,
    role: template.role,
    skills,
    approval_policy: template.approval_policy
  };
}
var TaskService = class {
  constructor(taskStore, eventBus, config, paths, agentStore) {
    this.taskStore = taskStore;
    this.eventBus = eventBus;
    this.config = config;
    this.paths = paths;
    this.agentStore = agentStore;
  }
  async create(input) {
    if (!input.title.trim()) {
      throw new InvalidArgumentsError("Task title is required");
    }
    const priority = input.priority ?? this.config.defaults.task.priority;
    if (!Number.isInteger(priority) || priority < 1 || priority > 4) {
      throw new InvalidArgumentsError("Priority must be an integer between 1 and 4");
    }
    if (input.depends_on?.length) {
      const results = await Promise.all(
        input.depends_on.map(async (depId) => ({ depId, exists: !!await this.taskStore.get(depId) }))
      );
      const missing = results.filter((r) => !r.exists).map((r) => r.depId);
      if (missing.length > 0) {
        throw new InvalidArgumentsError(
          `Unknown depends_on task ID(s): ${missing.join(", ")}`
        );
      }
    }
    const assignee = await this.resolveAssignee(input.assignee);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const task = {
      id: `tsk_${nanoid(7)}`,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      status: "todo",
      priority,
      assignee,
      labels: input.labels ?? [],
      depends_on: input.depends_on ?? [],
      created_at: now,
      updated_at: now,
      attempts: 0,
      max_attempts: input.max_attempts ?? this.config.defaults.task.max_attempts,
      workspace_mode: input.workspace_mode,
      review_criteria: input.review_criteria,
      scope: input.scope,
      goalId: input.goalId
    };
    if (input.attachments?.length && this.paths) {
      const attachmentNames = await this.copyAttachments(task.id, input.attachments);
      task.attachments = attachmentNames;
    }
    await this.taskStore.save(task);
    this.eventBus.emit({ type: "task:created", task });
    return task;
  }
  async list(filter) {
    return this.taskStore.list(filter);
  }
  async get(id) {
    const task = await this.taskStore.get(id);
    if (!task) throw new TaskNotFoundError(id);
    return task;
  }
  async updateStatus(id, newStatus) {
    const task = await this.get(id);
    const oldStatus = task.status;
    if (!canTransition(oldStatus, newStatus)) {
      throw new InvalidTransitionError(id, oldStatus, newStatus);
    }
    task.status = newStatus;
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    this.eventBus.emit({
      type: "task:status_changed",
      taskId: id,
      from: oldStatus,
      to: newStatus
    });
    return task;
  }
  async assign(taskId, agentId) {
    const task = await this.get(taskId);
    task.assignee = await this.resolveAssignee(agentId);
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    this.eventBus.emit({
      type: "task:assigned",
      taskId,
      agentId
    });
    return task;
  }
  async cancel(id) {
    const task = await this.get(id);
    if (isTerminal(task.status)) {
      throw new InvalidTransitionError(id, task.status, "cancelled");
    }
    return this.updateStatus(id, "cancelled");
  }
  async retry(id) {
    const task = await this.get(id);
    if (task.status !== "failed" && task.status !== "cancelled") {
      throw new InvalidTransitionError(id, task.status, "todo");
    }
    const oldStatus = task.status;
    task.status = "todo";
    task.attempts = 0;
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    this.eventBus.emit({
      type: "task:status_changed",
      taskId: id,
      from: oldStatus,
      to: "todo"
    });
    return task;
  }
  async reject(id, feedback) {
    const task = await this.get(id);
    if (task.status !== "review") {
      throw new InvalidTransitionError(id, task.status, "todo");
    }
    const oldStatus = task.status;
    task.status = "todo";
    task.attempts = 0;
    task.feedback = feedback;
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    this.eventBus.emit({
      type: "task:status_changed",
      taskId: id,
      from: oldStatus,
      to: "todo"
    });
    return task;
  }
  async update(id, fields) {
    const task = await this.get(id);
    if (fields.title !== void 0) {
      if (!fields.title.trim()) throw new InvalidArgumentsError("Task title cannot be empty");
      task.title = fields.title.trim();
    }
    if (fields.description !== void 0) task.description = fields.description.trim();
    if (fields.priority !== void 0) {
      if (!Number.isInteger(fields.priority) || fields.priority < 1 || fields.priority > 4) {
        throw new InvalidArgumentsError("Priority must be an integer between 1 and 4");
      }
      task.priority = fields.priority;
    }
    if (fields.labels !== void 0) task.labels = fields.labels;
    if (fields.attachments?.length && this.paths) {
      const attachmentNames = await this.copyAttachments(id, fields.attachments);
      task.attachments = [...task.attachments ?? [], ...attachmentNames];
    }
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    return task;
  }
  async delete(id) {
    const task = await this.get(id);
    if (task.status === "in_progress") {
      throw new InvalidArgumentsError("Cannot delete a running task. Cancel it first.");
    }
    await this.taskStore.delete(id);
    if (this.paths) {
      const dir = this.paths.taskAttachmentsDir(id);
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  getAttachmentPath(taskId, filename) {
    if (!this.paths) {
      throw new InvalidArgumentsError("Paths not configured");
    }
    validateAttachmentName(filename);
    const dir = this.paths.taskAttachmentsDir(taskId);
    const resolved = path.resolve(dir, filename);
    if (!isWithin(resolved, path.resolve(dir))) {
      throw new InvalidArgumentsError(`Invalid attachment filename: ${filename}`);
    }
    return resolved;
  }
  async copyAttachments(taskId, sourcePaths) {
    if (!this.paths) return [];
    const dir = this.paths.taskAttachmentsDir(taskId);
    await ensureDir(dir);
    const paths = this.paths;
    const projectRoot = path.resolve(paths.root, "..");
    const realProjectRoot = await fs.realpath(projectRoot);
    const realStateRoot = await fs.realpath(paths.root).catch(() => paths.root);
    const realDestDir = path.resolve(dir);
    const destDirStat = await fs.lstat(realDestDir);
    if (!destDirStat.isDirectory() || destDirStat.isSymbolicLink()) {
      throw new InvalidArgumentsError(`Attachment destination is not a safe directory: ${realDestDir}`);
    }
    const actualDestDir = await fs.realpath(realDestDir);
    if (!isWithin(actualDestDir, realStateRoot)) {
      throw new InvalidArgumentsError(`Attachment destination escaped state directory: ${realDestDir}`);
    }
    const validated = await Promise.all(
      sourcePaths.map(async (srcPath) => {
        let handle;
        try {
          const stat = await fs.lstat(srcPath);
          if (!stat.isFile()) throw new Error("not a regular file");
          const realSource = await fs.realpath(srcPath);
          if (!isWithin(realSource, realProjectRoot) || isWithin(realSource, realStateRoot)) {
            throw new Error("outside project or inside .orchestry");
          }
          handle = await fs.open(srcPath, constants.O_RDONLY | constants.O_NOFOLLOW);
          const openedStat = await handle.stat();
          if (!openedStat.isFile() || openedStat.dev !== stat.dev || openedStat.ino !== stat.ino) {
            throw new Error("source changed during validation");
          }
          const basename = path.basename(srcPath);
          validateAttachmentName(basename);
          return { handle, basename };
        } catch {
          await handle?.close().catch(() => {
          });
          throw new InvalidArgumentsError(`Attachment file not allowed: ${srcPath}`);
        }
      })
    );
    try {
      const names = await Promise.all(
        validated.map(async ({ handle, basename }) => {
          const dest = path.resolve(realDestDir, basename);
          if (!isWithin(dest, realDestDir)) {
            throw new InvalidArgumentsError(`Attachment destination escaped task directory: ${basename}`);
          }
          const currentDestDir = await fs.realpath(realDestDir);
          if (currentDestDir !== actualDestDir) {
            throw new InvalidArgumentsError(`Attachment destination changed during copy: ${basename}`);
          }
          await copyFromHandle(handle, dest);
          await fs.chmod(dest, 384).catch(() => {
          });
          return basename;
        })
      );
      return names;
    } finally {
      await Promise.all(validated.map(({ handle }) => handle.close().catch(() => {
      })));
    }
  }
  async incrementAttempts(id) {
    const task = await this.get(id);
    task.attempts += 1;
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.taskStore.save(task);
    return task;
  }
  /**
   * Resolve an assignee value to an agent ID.
   * Accepts: agent ID (agt_xxx), agent name, or undefined.
   * Returns the agent ID if found, or undefined if input is undefined.
   * Throws InvalidArgumentsError if non-empty value matches no agent.
   */
  async resolveAssignee(assignee) {
    if (!assignee) return void 0;
    if (!this.agentStore) return assignee;
    if (assignee.startsWith("agt_")) {
      const agent = await this.agentStore.get(assignee);
      if (agent) return agent.id;
      throw new InvalidArgumentsError(
        `Unknown agent ID: "${assignee}". No agent with this ID exists.`
      );
    }
    const byName = await this.agentStore.getByName(assignee);
    if (byName) return byName.id;
    throw new InvalidArgumentsError(
      `Unknown agent: "${assignee}". Use an agent ID (agt_xxx) or an exact agent name.`
    );
  }
};
function validateAttachmentName(name) {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new InvalidArgumentsError(`Invalid attachment filename: ${name}`);
  }
}
function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);
}
async function copyFromHandle(handle, dest) {
  const writer = createWriteStream(dest, { flags: "wx", mode: 384 });
  const reader = createReadStream("", { fd: handle.fd, autoClose: false, start: 0 });
  await new Promise((resolve, reject) => {
    const fail = (err) => {
      reader.destroy();
      writer.destroy();
      reject(err);
    };
    reader.on("error", fail);
    writer.on("error", fail);
    writer.on("finish", resolve);
    reader.pipe(writer);
  });
}
var AgentService = class {
  constructor(agentStore, stateStore, eventBus, config) {
    this.agentStore = agentStore;
    this.stateStore = stateStore;
    this.eventBus = eventBus;
    this.config = config;
  }
  async create(input) {
    if (!input.name.trim()) {
      throw new InvalidArgumentsError("Agent name is required");
    }
    const existing = await this.agentStore.getByName(input.name);
    if (existing) {
      throw new InvalidArgumentsError(`Agent "${input.name}" already exists`);
    }
    const agent = {
      id: `agt_${nanoid(7)}`,
      name: input.name.trim(),
      adapter: input.adapter || this.config.defaults.agent.adapter,
      role: input.role,
      config: {
        command: input.command,
        model: input.model,
        effort: input.effort,
        approval_policy: input.approval_policy ?? this.config.defaults.agent.approval_policy,
        max_turns: input.max_turns ?? this.config.defaults.agent.max_turns,
        timeout_ms: input.timeout_ms ?? this.config.defaults.agent.timeout_ms,
        stall_timeout_ms: input.stall_timeout_ms ?? this.config.defaults.agent.stall_timeout_ms,
        env: input.env,
        system_prompt: input.system_prompt,
        workspace_mode: input.workspace_mode,
        skills: input.skills
      },
      status: "idle",
      stats: {
        tasks_completed: 0,
        tasks_failed: 0,
        total_runs: 0,
        total_runtime_ms: 0
      }
    };
    await this.agentStore.save(agent);
    return agent;
  }
  async list() {
    return this.agentStore.list();
  }
  async get(id) {
    const agent = await this.agentStore.get(id);
    if (!agent) throw new AgentNotFoundError(id);
    return agent;
  }
  async remove(id) {
    const agent = await this.get(id);
    if (agent.status === "running") {
      const state = await this.stateStore.read();
      const isActuallyRunning = Object.values(state.running).some((e) => e.agent_id === id);
      if (isActuallyRunning) {
        throw new InvalidArgumentsError("Cannot remove a running agent. Stop it first.");
      }
      agent.status = "idle";
      await this.agentStore.save(agent);
    }
    await this.agentStore.delete(id);
  }
  async update(id, fields) {
    const agent = await this.get(id);
    if (fields.name !== void 0) {
      if (!fields.name.trim()) throw new InvalidArgumentsError("Agent name cannot be empty");
      const existing = await this.agentStore.getByName(fields.name.trim());
      if (existing && existing.id !== id) {
        throw new InvalidArgumentsError(`Agent "${fields.name}" already exists`);
      }
      agent.name = fields.name.trim();
    }
    if (fields.adapter !== void 0) {
      const adapter = fields.adapter.trim();
      if (!adapter) throw new InvalidArgumentsError("Agent adapter cannot be empty");
      agent.adapter = adapter;
    }
    if (fields.role !== void 0) agent.role = fields.role || void 0;
    if (fields.model !== void 0) agent.config.model = fields.model || void 0;
    if (fields.effort !== void 0) agent.config.effort = fields.effort || void 0;
    if (fields.approval_policy !== void 0) agent.config.approval_policy = fields.approval_policy;
    await this.agentStore.save(agent);
    return agent;
  }
  async disable(id) {
    return this.setStatus(id, "disabled");
  }
  async enable(id) {
    return this.setStatus(id, "idle");
  }
  async setAutonomous(id, enabled) {
    const agent = await this.get(id);
    agent.autonomous = enabled;
    await this.agentStore.save(agent);
    this.eventBus.emit({ type: "agent:autonomous_toggled", agentId: id, autonomous: enabled });
    return agent;
  }
  async setStatus(id, status) {
    const agent = await this.get(id);
    agent.status = status;
    await this.agentStore.save(agent);
    return agent;
  }
  async updateStats(id, update) {
    const agent = await this.get(id);
    Object.assign(agent.stats, update);
    await this.agentStore.save(agent);
    return agent;
  }
  /**
   * Find the best available agent for a task using scoring.
   *
   * Scoring:
   * - Explicit assignee match = 100
   * - Skill match with task labels = 50 per match
   * - Role match with task labels = 30
   * - Idle status bonus = 20
   * - Success rate bonus = 0–10 (scaled by completed / total)
   */
  async findBestAgent(task) {
    const agents = await this.agentStore.list();
    const available = agents.filter(
      (a) => a.status === "idle"
    );
    if (available.length === 0) return null;
    if (task.assignee) {
      const assigned = agents.find((a) => a.id === task.assignee || a.name === task.assignee);
      if (assigned && assigned.status === "idle") return assigned;
      return null;
    }
    const lowerLabels = task.labels?.length ? task.labels.map((l) => l.toLowerCase()) : void 0;
    const scored = available.map((agent) => {
      let score = 0;
      if (lowerLabels && agent.config.skills?.length) {
        const skillSet = new Set(agent.config.skills.map((s) => s.toLowerCase()));
        for (const label of lowerLabels) {
          if (skillSet.has(label)) {
            score += 50;
          }
        }
      }
      if (lowerLabels && agent.role) {
        const lowerRole = agent.role.toLowerCase();
        if (lowerLabels.some((l) => lowerRole.includes(l))) {
          score += 30;
        }
      }
      if (agent.status === "idle") {
        score += 20;
      }
      const totalTasks = agent.stats.tasks_completed + agent.stats.tasks_failed;
      if (totalTasks > 0) {
        score += Math.round(agent.stats.tasks_completed / totalTasks * 10);
      }
      return { agent, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.agent ?? null;
  }
};
var RunService = class {
  constructor(runStore, eventBus) {
    this.runStore = runStore;
    this.eventBus = eventBus;
  }
  async create(params) {
    const run = {
      id: `run_${nanoid(7)}`,
      task_id: params.taskId,
      agent_id: params.agentId,
      attempt: params.attempt,
      status: "preparing",
      started_at: (/* @__PURE__ */ new Date()).toISOString(),
      workspace_path: params.workspacePath,
      prompt: params.persistPrompt ? params.prompt : "[redacted]"
    };
    await this.runStore.save(run);
    return run;
  }
  async get(id) {
    return this.runStore.get(id);
  }
  async start(id, pid) {
    const run = await this.runStore.get(id);
    if (!run) throw new Error(`Run not found: ${id}`);
    run.status = "running";
    run.pid = pid;
    await this.runStore.save(run);
    this.eventBus.emit({
      type: "agent:started",
      agentId: run.agent_id,
      taskId: run.task_id,
      runId: id
    });
    return run;
  }
  async finish(id, status, tokens, error) {
    const run = await this.runStore.get(id);
    if (!run) throw new Error(`Run not found: ${id}`);
    run.status = status;
    run.finished_at = (/* @__PURE__ */ new Date()).toISOString();
    run.tokens = tokens;
    run.error = error === void 0 ? void 0 : sanitizeText(error);
    await this.runStore.save(run);
    this.eventBus.emit({
      type: "agent:completed",
      runId: id,
      agentId: run.agent_id,
      success: status === "succeeded"
    });
    return run;
  }
  async appendEvent(runId, event) {
    await this.runStore.appendEvent(runId, event);
  }
  async listAll() {
    return this.runStore.listAll();
  }
  async listForTask(taskId) {
    return this.runStore.listForTask(taskId);
  }
  async listForAgent(agentId) {
    return this.runStore.listForAgent(agentId);
  }
  async readEvents(runId) {
    return this.runStore.readEvents(runId);
  }
  async readEventsTail(runId, count) {
    return this.runStore.readEventsTail(runId, count);
  }
  /**
   * Get error and last N lines of output from the most recent failed run for a task.
   * Used to provide retry context so agents can learn from previous failures.
   */
  async getLastFailedRunContext(taskId) {
    const runs = await this.runStore.listForTask(taskId);
    const failedRun = runs.filter((r) => r.status === "failed").sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))[0];
    if (!failedRun) return null;
    const error = failedRun.error ?? "Unknown error";
    let output = "";
    try {
      const events = await this.runStore.readEventsTail(failedRun.id, 50);
      output = events.filter((e) => e.type === "agent_output" || e.type === "error").map((e) => typeof e.data === "string" ? e.data : JSON.stringify(e.data)).join("\n");
    } catch {
    }
    return { error, output };
  }
};
var execFile = promisify(execFile$1);
var EXEC_TIMEOUT_MS = 3e3;
function isClipboardToolAvailable() {
  const platform = process.platform;
  if (platform === "darwin") {
    return true;
  }
  if (platform === "linux") {
    try {
      execFileSync("which", ["xclip"], { timeout: EXEC_TIMEOUT_MS, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  if (platform === "win32") {
    return true;
  }
  return false;
}
async function detectClipboardType() {
  const platform = process.platform;
  if (platform === "darwin") {
    return detectMacOS();
  }
  if (platform === "linux") {
    return detectLinux();
  }
  if (platform === "win32") {
    return detectWindows();
  }
  throw new OrchestryError(
    `Unsupported platform for clipboard: ${platform}`,
    1,
    "Supported: macOS, Linux, Windows"
  );
}
async function getClipboardImage() {
  const type = await detectClipboardType();
  if (type !== "image") return null;
  const platform = process.platform;
  if (platform === "darwin") {
    return getImageMacOS();
  }
  if (platform === "linux") {
    return getImageLinux();
  }
  if (platform === "win32") {
    return getImageWindows();
  }
  return null;
}
async function detectMacOS() {
  try {
    const { stdout } = await execFile("osascript", ["-e", "clipboard info"], {
      timeout: EXEC_TIMEOUT_MS
    });
    if (stdout.includes("\xABclass PNGf\xBB") || stdout.includes("\xABclass TIFF\xBB")) {
      return "image";
    }
    if (stdout.includes("\xABclass ut16\xBB") || stdout.includes("\xABclass utf8\xBB")) {
      return "text";
    }
    return stdout.trim().length > 0 ? "text" : "empty";
  } catch {
    return "empty";
  }
}
async function getImageMacOS() {
  const dir = await mkdtemp(join(tmpdir(), "orch-clip-"));
  const filePath = join(dir, "clipboard.png");
  try {
    const script = `
      set theFile to POSIX file "${filePath}"
      try
        set imgData to the clipboard as \xABclass PNGf\xBB
        set fRef to open for access theFile with write permission
        write imgData to fRef
        close access fRef
        return "ok"
      on error
        try
          close access theFile
        end try
        return "error"
      end try
    `;
    const { stdout } = await execFile("osascript", ["-e", script], {
      timeout: EXEC_TIMEOUT_MS
    });
    if (stdout.trim() !== "ok") return null;
    const data = await readFile(filePath);
    return { data, ext: "png" };
  } catch {
    return null;
  } finally {
    try {
      await unlink(filePath);
    } catch {
    }
    try {
      await rm(dir, { recursive: true });
    } catch {
    }
  }
}
async function detectLinux() {
  try {
    const { stdout } = await execFile(
      "xclip",
      ["-selection", "clipboard", "-t", "TARGETS", "-o"],
      { timeout: EXEC_TIMEOUT_MS }
    );
    const targets = stdout.toLowerCase();
    if (targets.includes("image/png") || targets.includes("image/tiff") || targets.includes("image/jpeg")) {
      return "image";
    }
    if (targets.includes("text/plain") || targets.includes("utf8_string") || targets.includes("string")) {
      return "text";
    }
    return targets.trim().length > 0 ? "text" : "empty";
  } catch {
    return "empty";
  }
}
async function getImageLinux() {
  try {
    const { stdout } = await execFile(
      "xclip",
      ["-selection", "clipboard", "-t", "image/png", "-o"],
      { timeout: EXEC_TIMEOUT_MS, encoding: "buffer", maxBuffer: 50 * 1024 * 1024 }
    );
    const data = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, "binary");
    if (data.length === 0) return null;
    return { data, ext: "png" };
  } catch {
    return null;
  }
}
async function detectWindows() {
  try {
    const { stdout: imgCheck } = await execFile(
      "powershell",
      ["-NoProfile", "-Command", 'if (Get-Clipboard -Format Image) { "image" } else { "none" }'],
      { timeout: EXEC_TIMEOUT_MS }
    );
    if (imgCheck.trim() === "image") return "image";
    const { stdout: textCheck } = await execFile(
      "powershell",
      ["-NoProfile", "-Command", 'if (Get-Clipboard) { "text" } else { "empty" }'],
      { timeout: EXEC_TIMEOUT_MS }
    );
    return textCheck.trim() === "text" ? "text" : "empty";
  } catch {
    return "empty";
  }
}
async function getImageWindows() {
  const dir = await mkdtemp(join(tmpdir(), "orch-clip-"));
  const filePath = join(dir, "clipboard.png");
  try {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $img = [System.Windows.Forms.Clipboard]::GetImage()
      if ($img) {
        $img.Save('${filePath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output 'ok'
      } else {
        Write-Output 'error'
      }
    `;
    const { stdout } = await execFile("powershell", ["-NoProfile", "-Command", script], {
      timeout: EXEC_TIMEOUT_MS
    });
    if (stdout.trim() !== "ok") return null;
    const data = await readFile(filePath);
    return { data, ext: "png" };
  } catch {
    return null;
  } finally {
    try {
      await unlink(filePath);
    } catch {
    }
    try {
      await rm(dir, { recursive: true });
    } catch {
    }
  }
}

// src/domain/global-config.ts
var DEFAULT_GLOBAL_CONFIG = {
  tui: {
    activity_filter: "all",
    notifications: { toast: true, bell: false }
  }
};
var IndexManager = class {
  indexPath;
  dir;
  ext;
  itemPath;
  fileFilter;
  readItemFn;
  /** Promise-chain mutex to serialize updateIndex read-modify-write cycles. */
  mutex = Promise.resolve();
  /** True while executing inside withMutex — prevents re-entrant deadlock. */
  insideMutex = false;
  constructor(config) {
    this.dir = config.dir;
    this.ext = config.ext;
    this.itemPath = config.itemPath;
    this.indexPath = path.join(config.dir, "_index.json");
    this.fileFilter = config.fileFilter ?? (() => true);
    if (config.readItem) {
      this.readItemFn = config.readItem;
    } else if (config.ext === ".yml") {
      this.readItemFn = (fp) => readYaml(fp);
    } else {
      this.readItemFn = (fp) => readJson(fp);
    }
  }
  /**
   * Read the index file. Falls back to rebuilding from individual files
   * if the index is missing or corrupt.
   */
  async readIndex() {
    try {
      const entries = await readJson(this.indexPath);
      if (Array.isArray(entries)) return entries;
    } catch {
    }
    return this.rebuildIndex();
  }
  /**
   * Rebuild the index by reading all individual item files.
   * Used as fallback when _index.json is missing or corrupted.
   *
   * When called from outside the mutex (standalone), the write is serialized
   * through {@link withMutex} to prevent races with concurrent updateIndex.
   * When called from within the mutex (e.g. updateIndex → readIndex fallback),
   * it writes directly to avoid re-entrant deadlock.
   */
  async rebuildIndex() {
    await ensureDir(this.dir);
    const files = await listFiles(this.dir, this.ext);
    const results = await Promise.all(
      files.filter(this.fileFilter).map(async (file) => {
        const id = file.replace(this.ext, "");
        try {
          return await this.readItemFn(this.itemPath(id));
        } catch {
          return null;
        }
      })
    );
    const items = [];
    for (const item of results) {
      if (item != null) items.push(item);
    }
    if (this.insideMutex) {
      await this.writeIndexUnsafe(items);
    } else {
      await this.withMutex(() => this.writeIndexUnsafe(items));
    }
    return items;
  }
  /**
   * Write the index file atomically.
   * Serialized through the mutex to prevent races with concurrent updateIndex.
   */
  async writeIndex(items) {
    return this.withMutex(() => this.writeIndexUnsafe(items));
  }
  /**
   * Apply a mutation to the index and write it back.
   *
   * Serialized through a promise-chain mutex to prevent TOCTOU races
   * where parallel callers could overwrite each other's changes
   * (e.g. two `orch task add` invocations losing data).
   */
  async updateIndex(fn) {
    return this.withMutex(async () => {
      const current = await this.readIndex();
      const updated = fn(current);
      await this.writeIndexUnsafe(updated);
    });
  }
  /** Internal write without mutex — called only from within withMutex. */
  async writeIndexUnsafe(items) {
    await ensureDir(this.dir);
    await writeJson(this.indexPath, items);
  }
  /** Promise-chain mutex: serializes all index-mutating operations. */
  withMutex(fn) {
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const prev = this.mutex;
    this.mutex = next;
    return prev.then(async () => {
      this.insideMutex = true;
      try {
        return await fn();
      } finally {
        this.insideMutex = false;
        release();
      }
    });
  }
};
var TaskStore = class {
  constructor(paths) {
    this.paths = paths;
    this.index = new IndexManager({
      dir: paths.tasksDir,
      ext: ".yml",
      itemPath: (id) => paths.taskPath(id)
    });
  }
  index;
  async list(filter) {
    const all = await this.index.readIndex();
    const tasks = all.filter(
      (task) => task !== null && (!filter?.status || task.status === filter.status) && (!filter?.goalId || task.goalId === filter.goalId)
    );
    return tasks.sort((a, b) => {
      const statusOrder = statusPriority(a.status) - statusPriority(b.status);
      if (statusOrder !== 0) return statusOrder;
      const bTime = b.updated_at ?? "";
      const aTime = a.updated_at ?? "";
      return bTime < aTime ? -1 : bTime > aTime ? 1 : 0;
    });
  }
  async get(id) {
    return readYaml(this.paths.taskPath(id));
  }
  async save(task) {
    await ensureDir(this.paths.tasksDir);
    await writeYaml(this.paths.taskPath(task.id), task);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((t) => t.id !== task.id);
      filtered.push(task);
      return filtered;
    });
  }
  async delete(id) {
    try {
      await fs.unlink(this.paths.taskPath(id));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((t) => t.id !== id));
  }
};
function statusPriority(status) {
  const order = {
    in_progress: 0,
    retrying: 1,
    review: 2,
    todo: 3,
    done: 4,
    failed: 5,
    cancelled: 6
  };
  return order[status];
}
var AgentStore = class {
  constructor(paths) {
    this.paths = paths;
    this.index = new IndexManager({
      dir: paths.agentsDir,
      ext: ".yml",
      itemPath: (id) => paths.agentPath(id)
    });
  }
  index;
  async list() {
    return this.index.readIndex();
  }
  async get(id) {
    return readYaml(this.paths.agentPath(id));
  }
  async getByName(name) {
    const agents = await this.list();
    return agents.find((a) => a.name === name) ?? null;
  }
  async save(agent) {
    await ensureDir(this.paths.agentsDir);
    await writeYaml(this.paths.agentPath(agent.id), agent);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((a) => a.id !== agent.id);
      filtered.push(agent);
      return filtered;
    });
  }
  async delete(id) {
    try {
      await fs.unlink(this.paths.agentPath(id));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((a) => a.id !== id));
  }
};
var RunStore = class {
  constructor(paths) {
    this.paths = paths;
  }
  async save(run) {
    await ensureDir(this.paths.runsDir);
    await writeJson(this.paths.runPath(run.id), run);
  }
  async get(id) {
    return readJson(this.paths.runPath(id));
  }
  async listAll() {
    return this.listFiltered(() => true);
  }
  async listForTask(taskId) {
    return this.listFiltered((run) => run.task_id === taskId);
  }
  async listForAgent(agentId) {
    return this.listFiltered((run) => run.agent_id === agentId);
  }
  async appendEvent(runId, event) {
    await ensureDir(this.paths.runsDir);
    await appendJsonl(this.paths.runEventsPath(runId), event);
  }
  async readEvents(runId) {
    return readJsonl(this.paths.runEventsPath(runId));
  }
  /**
   * Read the last N events for a run without loading the entire JSONL file.
   */
  async readEventsTail(runId, count) {
    return readJsonlTail(this.paths.runEventsPath(runId), count);
  }
  closeRunEvents(runId) {
    closeAppendHandle(this.paths.runEventsPath(runId));
  }
  async *streamEvents(runId, signal) {
    const filePath = this.paths.runEventsPath(runId);
    const deadline = Date.now() + 3e4;
    while (!signal?.aborted && Date.now() < deadline) {
      if (await pathExists(filePath)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (signal?.aborted || Date.now() >= deadline) return;
    const stream = createReadStream(filePath);
    const { readLines } = await import('./process-manager-A36Y7LHP.js');
    try {
      for await (const line of readLines(stream)) {
        if (signal?.aborted) break;
        if (line.trim()) {
          try {
            yield JSON.parse(line);
          } catch {
            process.stderr.write(`[RunStore] skipping corrupt JSONL line: ${sanitizeText(line).slice(0, 200)}
`);
          }
        }
      }
    } finally {
      stream.destroy();
    }
  }
  async listFiltered(predicate) {
    await ensureDir(this.paths.runsDir);
    const files = await listFiles(this.paths.runsDir, ".json");
    const BATCH = 64;
    const all = [];
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((file) => {
          const id = file.endsWith(".json") ? file.slice(0, -5) : file;
          return readJson(this.paths.runPath(id));
        })
      );
      for (const run of results) {
        if (run !== null && predicate(run)) all.push(run);
      }
    }
    return all.sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );
  }
};

// src/domain/state.ts
var DEFAULT_STATE = {
  version: 1,
  onboardingCompleted: false,
  running: {},
  claimed: /* @__PURE__ */ new Set(),
  retry_queue: [],
  stats: {
    total_runs: 0,
    total_tasks_completed: 0,
    total_tasks_failed: 0,
    total_tokens: { input: 0, output: 0, reasoning: 0, total: 0, cache_read: 0, cache_write: 0 },
    total_runtime_ms: 0
  }
};

// src/infrastructure/storage/state-store.ts
var StateStore = class {
  constructor(paths) {
    this.paths = paths;
  }
  async read() {
    const raw = await readJson(this.paths.statePath);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const defaults = structuredClone(DEFAULT_STATE);
    return {
      version: raw.version ?? defaults.version,
      pid: raw.pid,
      started_at: raw.started_at,
      onboardingCompleted: typeof raw.onboardingCompleted === "boolean" ? raw.onboardingCompleted : false,
      running: raw.running && typeof raw.running === "object" ? raw.running : defaults.running,
      claimed: Array.isArray(raw.claimed) ? new Set(raw.claimed) : new Set(defaults.claimed),
      retry_queue: Array.isArray(raw.retry_queue) ? raw.retry_queue : defaults.retry_queue,
      stats: {
        total_runs: raw.stats?.total_runs ?? defaults.stats.total_runs,
        total_tasks_completed: raw.stats?.total_tasks_completed ?? defaults.stats.total_tasks_completed,
        total_tasks_failed: raw.stats?.total_tasks_failed ?? defaults.stats.total_tasks_failed,
        total_tokens: {
          ...defaults.stats.total_tokens,
          ...raw.stats?.total_tokens ?? {}
        },
        total_runtime_ms: raw.stats?.total_runtime_ms ?? defaults.stats.total_runtime_ms
      }
    };
  }
  async write(state) {
    const serializable = { ...state, claimed: Array.from(state.claimed) };
    await writeJson(this.paths.statePath, serializable);
  }
};

// src/domain/config.ts
var DEFAULT_CONFIG = {
  project: {
    name: "my-project"
  },
  defaults: {
    agent: {
      adapter: "claude",
      approval_policy: "auto",
      max_turns: 50,
      timeout_ms: 36e5,
      stall_timeout_ms: 6e5,
      workspace_mode: "worktree"
    },
    task: {
      max_attempts: 3,
      priority: 3
    }
  },
  scheduling: {
    poll_interval_ms: 1e4,
    max_concurrent_agents: 6,
    retry_base_delay_ms: 1e4,
    retry_max_delay_ms: 3e5
  },
  execution: {
    security: {
      allow_permission_bypass: false,
      allow_shell_adapter: false,
      persist_prompts: false
    }
  }
};

// src/infrastructure/storage/config-store.ts
var FORBIDDEN_CONFIG_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
var ConfigStore = class {
  constructor(paths) {
    this.paths = paths;
  }
  async read() {
    const config = await readYaml(this.paths.configPath);
    return deepMerge(
      DEFAULT_CONFIG,
      config ?? {}
    );
  }
  async write(config) {
    await writeYaml(this.paths.configPath, config);
  }
  async get(keyPath) {
    const config = await this.read();
    return getByPath(config, keyPath);
  }
  async set(keyPath, value) {
    const config = await this.read();
    setByPath(config, keyPath, value);
    await this.write(config);
  }
};
function getByPath(obj, keyPath) {
  const keys = parseSafeKeyPath(keyPath, false);
  let current = obj;
  for (const key of keys) {
    if (current === null || current === void 0 || typeof current !== "object") {
      return void 0;
    }
    current = current[key];
  }
  return current;
}
function setByPath(obj, keyPath, value) {
  const keys = parseSafeKeyPath(keyPath, true);
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key];
  }
  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;
}
function parseSafeKeyPath(keyPath, shouldThrow) {
  const keys = keyPath.split(".");
  if (keys.some((key) => FORBIDDEN_CONFIG_KEYS.has(key))) {
    if (shouldThrow) throw new Error(`Unsafe config key path: ${keyPath}`);
    return [];
  }
  return keys;
}
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_CONFIG_KEYS.has(key)) continue;
    const sourceVal = source[key];
    const targetVal = result[key];
    if (sourceVal !== null && sourceVal !== void 0 && typeof sourceVal === "object" && !Array.isArray(sourceVal) && typeof targetVal === "object" && targetVal !== null && !Array.isArray(targetVal)) {
      result[key] = deepMerge(
        targetVal,
        sourceVal
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}
var GLOBAL_DIR = path.join(homedir(), ".orchestry");
var GLOBAL_CONFIG_PATH = path.join(GLOBAL_DIR, "global.yml");
var GlobalConfigStore = class {
  async read() {
    const data = await readYaml(GLOBAL_CONFIG_PATH);
    if (!data) return { ...DEFAULT_GLOBAL_CONFIG, tui: { ...DEFAULT_GLOBAL_CONFIG.tui, notifications: { ...DEFAULT_GLOBAL_CONFIG.tui.notifications } } };
    const tui = data.tui;
    const notif = tui?.notifications;
    return {
      tui: {
        activity_filter: tui?.activity_filter ?? DEFAULT_GLOBAL_CONFIG.tui.activity_filter,
        notifications: {
          toast: typeof notif?.toast === "boolean" ? notif.toast : DEFAULT_GLOBAL_CONFIG.tui.notifications.toast,
          bell: typeof notif?.bell === "boolean" ? notif.bell : DEFAULT_GLOBAL_CONFIG.tui.notifications.bell
        }
      }
    };
  }
  async write(config) {
    await mkdir(GLOBAL_DIR, { recursive: true });
    await writeYaml(GLOBAL_CONFIG_PATH, config);
  }
  async set(key, value) {
    const config = await this.read();
    config.tui[key] = value;
    await this.write(config);
  }
};
var ContextStore = class _ContextStore {
  constructor(paths) {
    this.paths = paths;
    this.index = new IndexManager({
      dir: paths.contextDir,
      ext: ".json",
      itemPath: (key) => paths.contextPath(key),
      fileFilter: (f) => f !== "_index.json"
    });
  }
  index;
  async get(key) {
    const entry = await readJson(this.paths.contextPath(key));
    if (!entry) return null;
    if (isExpired(entry)) {
      await this.delete(key);
      return null;
    }
    return entry;
  }
  /** Max TTL: 30 days in milliseconds */
  static MAX_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
  async set(key, value, ttlMs) {
    if (ttlMs !== void 0) {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > _ContextStore.MAX_TTL_MS) {
        throw new Error(`TTL must be a positive number up to ${_ContextStore.MAX_TTL_MS}ms (30 days)`);
      }
    }
    await ensureDir(this.paths.contextDir);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existing = await readJson(this.paths.contextPath(key));
    const entry = {
      key,
      value,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      ttl_ms: ttlMs,
      expires_at: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : void 0
    };
    await writeJson(this.paths.contextPath(key), entry);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((e) => e.key !== key);
      filtered.push(entry);
      return filtered;
    });
  }
  async delete(key) {
    try {
      await fs.unlink(this.paths.contextPath(key));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((e) => e.key !== key));
  }
  async list() {
    const entries = await this.index.readIndex();
    const expired = [];
    const valid = [];
    for (const entry of entries) {
      if (isExpired(entry)) {
        expired.push(entry);
      } else {
        valid.push(entry);
      }
    }
    if (expired.length > 0) {
      await Promise.all(expired.map((e) => this.deleteFile(e.key)));
      await this.index.writeIndex(valid);
    }
    return valid.sort((a, b) => a.key.localeCompare(b.key));
  }
  async getAll() {
    const entries = await this.list();
    const result = {};
    for (const entry of entries) {
      result[entry.key] = entry.value;
    }
    return result;
  }
  /** Delete just the file (no index update). Used by lazy expiry cleanup. */
  async deleteFile(key) {
    try {
      await fs.unlink(this.paths.contextPath(key));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
};
function isExpired(entry) {
  if (!entry.expires_at) return false;
  return new Date(entry.expires_at).getTime() < Date.now();
}
var MessageStore = class {
  constructor(paths) {
    this.paths = paths;
    this.index = new IndexManager({
      dir: paths.messagesDir,
      ext: ".json",
      itemPath: (id) => paths.messagePath(id),
      fileFilter: (fileName) => fileName !== "_index.json"
    });
  }
  index;
  async save(message) {
    await ensureDir(this.paths.messagesDir);
    await writeJson(this.paths.messagePath(message.id), message);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((m) => m.id !== message.id);
      filtered.push(message);
      return filtered;
    });
  }
  async get(id) {
    return readJson(this.paths.messagePath(id));
  }
  async list() {
    const all = await this.index.readIndex();
    return all.filter((m) => m !== null).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async listPending(agentId) {
    const all = await this.list();
    const now = Date.now();
    return all.filter((m) => {
      if (m.status !== "pending") return false;
      if (m.expires_at && new Date(m.expires_at).getTime() < now) return false;
      return m.to_agent_id === agentId;
    });
  }
  async markDelivered(id) {
    const msg = await this.get(id);
    if (!msg) return;
    msg.status = "delivered";
    msg.delivered_at = (/* @__PURE__ */ new Date()).toISOString();
    await writeJson(this.paths.messagePath(id), msg);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((m) => m.id !== id);
      filtered.push(msg);
      return filtered;
    });
  }
  async delete(id) {
    try {
      await fs.unlink(this.paths.messagePath(id));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((m) => m.id !== id));
  }
  async purgeExpired() {
    const all = await this.list();
    const now = Date.now();
    const toDelete = all.filter((m) => {
      const isExpired2 = m.expires_at && new Date(m.expires_at).getTime() < now;
      const isOldDelivered = m.delivered_at && now - new Date(m.delivered_at).getTime() > 36e5;
      return isExpired2 || isOldDelivered;
    });
    const idsToDelete = new Set(toDelete.map((m) => m.id));
    await Promise.all(
      toDelete.map(async (m) => {
        try {
          await fs.unlink(this.paths.messagePath(m.id));
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
      })
    );
    await this.index.updateIndex((idx) => idx.filter((m) => !idsToDelete.has(m.id)));
    return toDelete.length;
  }
};

// src/domain/goal.ts
var TERMINAL_GOAL_STATUSES = /* @__PURE__ */ new Set(["achieved", "abandoned"]);
function isGoalTerminal(status) {
  return TERMINAL_GOAL_STATUSES.has(status);
}
var GOAL_STATUS_ORDER = {
  active: 0,
  paused: 1,
  achieved: 2,
  abandoned: 3
};
var GoalStore = class {
  constructor(paths) {
    this.paths = paths;
    this.index = new IndexManager({
      dir: paths.goalsDir,
      ext: ".yml",
      itemPath: (id) => paths.goalPath(id)
    });
  }
  index;
  async list(filter) {
    const all = await this.index.readIndex();
    const goals = all.filter(
      (goal) => goal !== null && (!filter?.status || goal.status === filter.status)
    );
    return goals.sort((a, b) => {
      const statusOrder = GOAL_STATUS_ORDER[a.status] - GOAL_STATUS_ORDER[b.status];
      if (statusOrder !== 0) return statusOrder;
      const bTime = b.updated_at ?? "";
      const aTime = a.updated_at ?? "";
      return bTime < aTime ? -1 : bTime > aTime ? 1 : 0;
    });
  }
  async get(id) {
    return readYaml(this.paths.goalPath(id));
  }
  async save(goal) {
    await ensureDir(this.paths.goalsDir);
    await writeYaml(this.paths.goalPath(goal.id), goal);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((g) => g.id !== goal.id);
      filtered.push(goal);
      return filtered;
    });
  }
  async delete(id) {
    try {
      await fs.unlink(this.paths.goalPath(id));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((g) => g.id !== id));
  }
};
var TeamStore = class {
  constructor(paths) {
    this.paths = paths;
  }
  async save(team) {
    await ensureDir(this.paths.teamsDir);
    await writeYaml(this.paths.teamPath(team.id), team);
  }
  async get(id) {
    return readYaml(this.paths.teamPath(id));
  }
  async getByName(name) {
    const teams = await this.list();
    return teams.find((t) => t.name === name) ?? null;
  }
  async list() {
    await ensureDir(this.paths.teamsDir);
    const files = await listFiles(this.paths.teamsDir, ".yml");
    const results = await Promise.all(
      files.map((f) => readYaml(this.paths.teamPath(f.replace(".yml", ""))))
    );
    return results.filter((t) => t !== null);
  }
  async delete(id) {
    try {
      await fs.unlink(this.paths.teamPath(id));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
};

// src/domain/message.ts
var MAX_MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var DEFAULT_MESSAGE_TTL_MS = 24 * 60 * 60 * 1e3;

// src/application/message-service.ts
var MessageService = class {
  constructor(messageStore, agentStore, teamStore, eventBus) {
    this.messageStore = messageStore;
    this.agentStore = agentStore;
    this.teamStore = teamStore;
    this.eventBus = eventBus;
  }
  /**
   * Send a message. For broadcast, creates one message per recipient agent.
   * For 'lead' channel, resolves team lead and sends direct.
   */
  async send(input) {
    if (!input.body.trim()) throw new InvalidArgumentsError("Message body is required");
    const ttlMs = input.ttl_ms ?? DEFAULT_MESSAGE_TTL_MS;
    if (ttlMs <= 0 || ttlMs > MAX_MESSAGE_TTL_MS) {
      throw new InvalidArgumentsError(`TTL must be between 1ms and ${MAX_MESSAGE_TTL_MS}ms`);
    }
    const sender = await this.agentStore.get(input.from_agent_id);
    if (!sender && input.from_agent_id !== "cli") {
      throw new InvalidArgumentsError(`Sender agent not found: ${input.from_agent_id}`);
    }
    const now = /* @__PURE__ */ new Date();
    const baseMessage = {
      channel: input.channel,
      from_agent_id: input.from_agent_id,
      subject: (input.subject || "(no subject)").slice(0, 200),
      body: input.body.slice(0, 4e3),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      status: "pending",
      team_id: input.team_id,
      reply_to: input.reply_to
    };
    const messages = [];
    if (input.channel === "broadcast") {
      let agents = await this.agentStore.list();
      if (input.team_id) {
        const team = await this.teamStore.get(input.team_id);
        if (team) {
          const memberIds = new Set(team.members.map((m) => m.agent_id));
          agents = agents.filter((a) => memberIds.has(a.id));
        }
      }
      const recipients = agents.filter((a) => a.id !== input.from_agent_id && a.status !== "disabled");
      const broadcastMsgs = recipients.map((agent) => ({
        ...baseMessage,
        id: `msg_${nanoid(7)}`,
        to_agent_id: agent.id
      }));
      await Promise.all(broadcastMsgs.map((msg) => this.messageStore.save(msg)));
      for (const msg of broadcastMsgs) {
        messages.push(msg);
        this.emitSent(msg);
      }
    } else if (input.channel === "lead") {
      if (!input.team_id) throw new InvalidArgumentsError("team_id is required for lead channel");
      const team = await this.teamStore.get(input.team_id);
      if (!team) throw new InvalidArgumentsError(`Team not found: ${input.team_id}`);
      const msg = {
        ...baseMessage,
        id: `msg_${nanoid(7)}`,
        to_agent_id: team.lead_agent_id
      };
      await this.messageStore.save(msg);
      messages.push(msg);
      this.emitSent(msg);
    } else {
      if (!input.to_agent_id) throw new InvalidArgumentsError("to_agent_id is required for direct messages");
      const recipient = await this.agentStore.get(input.to_agent_id);
      if (!recipient) throw new InvalidArgumentsError(`Recipient agent not found: ${input.to_agent_id}`);
      const msg = {
        ...baseMessage,
        id: `msg_${nanoid(7)}`,
        to_agent_id: input.to_agent_id
      };
      await this.messageStore.save(msg);
      messages.push(msg);
      this.emitSent(msg);
    }
    return messages;
  }
  /**
   * Drain mailbox: fetch pending messages for an agent and mark them delivered.
   * Called by the orchestrator during dispatchTask.
   */
  async drainMailbox(agentId, taskId) {
    const pending = await this.messageStore.listPending(agentId);
    await Promise.all(pending.map((msg) => this.messageStore.markDelivered(msg.id)));
    for (const msg of pending) {
      this.eventBus.emit({
        type: "message:delivered",
        messageId: msg.id,
        toAgentId: agentId,
        taskId
      });
    }
    return pending;
  }
  async listAll() {
    return this.messageStore.list();
  }
  async listPendingForAgent(agentId) {
    return this.messageStore.listPending(agentId);
  }
  async listForAgent(agentId) {
    const all = await this.messageStore.list();
    return all.filter((m) => m.to_agent_id === agentId || m.from_agent_id === agentId);
  }
  async purgeExpired() {
    return this.messageStore.purgeExpired();
  }
  emitSent(msg) {
    this.eventBus.emit({
      type: "message:sent",
      messageId: msg.id,
      fromAgentId: msg.from_agent_id,
      toAgentId: msg.to_agent_id,
      channel: msg.channel
    });
  }
};
var VALID_TRANSITIONS = {
  active: ["paused", "achieved", "abandoned"],
  paused: ["active", "achieved", "abandoned"],
  achieved: [],
  abandoned: []
};
var GoalService = class {
  constructor(goalStore, eventBus, agentService, taskService, contextStore) {
    this.goalStore = goalStore;
    this.eventBus = eventBus;
    this.agentService = agentService;
    this.taskService = taskService;
    this.contextStore = contextStore;
  }
  async create(input) {
    if (!input.title.trim()) {
      throw new InvalidArgumentsError("Goal title is required");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const goal = {
      id: `goal_${nanoid(7)}`,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      status: "active",
      assignee: input.assignee,
      created_at: now,
      updated_at: now
    };
    await this.goalStore.save(goal);
    this.eventBus.emit({ type: "goal:created", goalId: goal.id, title: goal.title });
    if (goal.assignee) {
      await this.enableAutonomous(goal.assignee);
    }
    return goal;
  }
  async list(filter) {
    return this.goalStore.list(filter);
  }
  async get(id) {
    const goal = await this.goalStore.get(id);
    if (!goal) throw new GoalNotFoundError(id);
    return goal;
  }
  async updateStatus(id, newStatus, opts) {
    const goal = await this.get(id);
    const oldStatus = goal.status;
    if (!VALID_TRANSITIONS[oldStatus].includes(newStatus)) {
      throw new InvalidArgumentsError(
        `Cannot transition goal from '${oldStatus}' to '${newStatus}'`
      );
    }
    if (newStatus === "achieved" && this.taskService) {
      const childTasks = await this.taskService.list({ goalId: id });
      const pending = childTasks.filter(
        (t) => !isTerminal(t.status) && !t.labels?.includes(AUTONOMOUS_LABEL)
      );
      if (pending.length > 0) {
        if (opts?.force) {
          const cancellable = pending.filter((t) => t.status !== "in_progress");
          const running = pending.filter((t) => t.status === "in_progress");
          await Promise.all(
            cancellable.map((t) => this.taskService.cancel(t.id).catch(() => {
            }))
          );
          if (running.length > 0) {
            const summary = running.map((t) => `${t.id} (in_progress)`).join(", ");
            throw new GoalHasPendingTasksError(id, running.length, summary);
          }
        } else {
          const summary = pending.map((t) => `${t.id} (${t.status})`).join(", ");
          throw new GoalHasPendingTasksError(id, pending.length, summary);
        }
      }
    }
    goal.status = newStatus;
    goal.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.goalStore.save(goal);
    this.eventBus.emit({ type: "goal:status_changed", goalId: id, from: oldStatus, to: newStatus });
    if (goal.assignee) {
      if (newStatus === "paused") {
        await this.maybeDisableAutonomous(goal.assignee);
        await this.cancelPendingAutonomousTasks(goal.assignee);
      } else if (newStatus === "active" && oldStatus === "paused") {
        await this.enableAutonomous(goal.assignee);
      } else if (isGoalTerminal(newStatus)) {
        await this.maybeDisableAutonomous(goal.assignee);
      }
    }
    return goal;
  }
  async update(id, fields) {
    const goal = await this.get(id);
    const oldAssignee = goal.assignee;
    if (fields.title !== void 0) {
      if (!fields.title.trim()) throw new InvalidArgumentsError("Goal title cannot be empty");
      goal.title = fields.title.trim();
    }
    if (fields.description !== void 0) goal.description = fields.description.trim();
    if (fields.assignee !== void 0) goal.assignee = fields.assignee || void 0;
    goal.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.goalStore.save(goal);
    this.eventBus.emit({ type: "goal:updated", goalId: id });
    const newAssignee = goal.assignee;
    if (newAssignee !== oldAssignee) {
      const ops = [];
      if (newAssignee) ops.push(this.enableAutonomous(newAssignee));
      if (oldAssignee) ops.push(this.maybeDisableAutonomous(oldAssignee));
      await Promise.all(ops);
    }
    return goal;
  }
  async delete(id) {
    const goal = await this.get(id);
    const { assignee } = goal;
    await this.goalStore.delete(id);
    this.eventBus.emit({ type: "goal:deleted", goalId: id });
    if (assignee) {
      await this.maybeDisableAutonomous(assignee);
    }
  }
  async listTasksForGoal(goalId) {
    return this.taskService?.list({ goalId }) ?? [];
  }
  async getProgressReport(goalId) {
    if (!this.contextStore) return void 0;
    const entry = await this.contextStore.get(`${goalId}-progress`);
    return entry?.value;
  }
  /** Enable autonomous mode on an agent. */
  async enableAutonomous(agentId) {
    if (!this.agentService) return;
    try {
      await this.agentService.setAutonomous(agentId, true);
    } catch {
    }
  }
  /** Check if an agent has at least one active goal. */
  async hasActiveGoalsForAgent(agentId) {
    const activeGoals = await this.goalStore.list({ status: "active" });
    return activeGoals.some((g) => g.assignee === agentId);
  }
  /** Cancel dispatchable (todo/retrying) autonomous tasks assigned to the agent. */
  async cancelPendingAutonomousTasks(agentId) {
    if (!this.taskService) return;
    try {
      const [todos, retrying] = await Promise.all([
        this.taskService.list({ status: "todo" }),
        this.taskService.list({ status: "retrying" })
      ]);
      const pending = [...todos, ...retrying].filter(
        (t) => t.assignee === agentId && t.labels?.includes(AUTONOMOUS_LABEL)
      );
      await Promise.all(pending.map((t) => this.taskService.cancel(t.id).catch(() => {
      })));
    } catch {
    }
  }
  /** Disable autonomous if agent has no other active goals. */
  async maybeDisableAutonomous(agentId) {
    if (!this.agentService) return;
    try {
      if (!await this.hasActiveGoalsForAgent(agentId)) {
        await this.agentService.setAutonomous(agentId, false);
      }
    } catch {
    }
  }
};

// src/domain/team.ts
var DEFAULT_TEAM_CONFIG = {
  auto_claim: true,
  message_ttl_ms: 24 * 60 * 60 * 1e3
};

// src/application/team-service.ts
var TeamService = class {
  constructor(teamStore, agentStore, taskStore, eventBus) {
    this.teamStore = teamStore;
    this.agentStore = agentStore;
    this.taskStore = taskStore;
    this.eventBus = eventBus;
  }
  async create(input) {
    if (!input.name.trim()) throw new InvalidArgumentsError("Team name is required");
    const lead = await this.agentStore.get(input.lead_agent_id);
    if (!lead) throw new InvalidArgumentsError(`Lead agent not found: ${input.lead_agent_id}`);
    const existing = await this.teamStore.getByName(input.name.trim());
    if (existing) throw new InvalidArgumentsError(`Team "${input.name}" already exists`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const leadMember = { agent_id: input.lead_agent_id, role: "lead", joined_at: now };
    const additionalMembers = [];
    for (const agentId of input.member_agent_ids ?? []) {
      if (agentId === input.lead_agent_id) continue;
      const agent = await this.agentStore.get(agentId);
      if (!agent) throw new InvalidArgumentsError(`Member agent not found: ${agentId}`);
      additionalMembers.push({ agent_id: agentId, role: "member", joined_at: now });
    }
    const team = {
      id: `team_${nanoid(7)}`,
      name: input.name.trim(),
      description: input.description,
      status: "active",
      members: [leadMember, ...additionalMembers],
      task_pool: [],
      lead_agent_id: input.lead_agent_id,
      created_at: now,
      updated_at: now,
      config: { ...DEFAULT_TEAM_CONFIG, ...input.config ?? {} }
    };
    await this.teamStore.save(team);
    this.eventBus.emit({ type: "team:created", teamId: team.id, name: team.name, leadAgentId: team.lead_agent_id });
    for (const member of additionalMembers) {
      this.eventBus.emit({ type: "team:member_joined", teamId: team.id, agentId: member.agent_id });
    }
    return team;
  }
  async get(id) {
    const team = await this.teamStore.get(id);
    if (!team) throw new TeamNotFoundError(id);
    return team;
  }
  async list() {
    return this.teamStore.list();
  }
  async join(teamId, agentId) {
    const team = await this.get(teamId);
    if (team.members.some((m) => m.agent_id === agentId)) {
      throw new InvalidArgumentsError(`Agent ${agentId} is already a member of team ${teamId}`);
    }
    const agent = await this.agentStore.get(agentId);
    if (!agent) throw new InvalidArgumentsError(`Agent not found: ${agentId}`);
    team.members.push({ agent_id: agentId, role: "member", joined_at: (/* @__PURE__ */ new Date()).toISOString() });
    team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.teamStore.save(team);
    this.eventBus.emit({ type: "team:member_joined", teamId, agentId });
    return team;
  }
  async leave(teamId, agentId) {
    const team = await this.get(teamId);
    if (agentId === team.lead_agent_id) {
      throw new InvalidArgumentsError("Lead cannot leave team. Disband the team or transfer lead first.");
    }
    team.members = team.members.filter((m) => m.agent_id !== agentId);
    team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.teamStore.save(team);
    this.eventBus.emit({ type: "team:member_left", teamId, agentId });
    return team;
  }
  async addTask(teamId, taskId) {
    const team = await this.get(teamId);
    const task = await this.taskStore.get(taskId);
    if (!task) throw new InvalidArgumentsError(`Task not found: ${taskId}`);
    if (!team.task_pool.includes(taskId)) {
      team.task_pool.push(taskId);
      team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      await this.teamStore.save(team);
      this.eventBus.emit({ type: "team:task_added", teamId, taskId });
    }
    return team;
  }
  async removeTask(teamId, taskId) {
    const team = await this.get(teamId);
    team.task_pool = team.task_pool.filter((id) => id !== taskId);
    team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.teamStore.save(team);
    return team;
  }
  async setLead(teamId, agentId) {
    const team = await this.get(teamId);
    const member = team.members.find((m) => m.agent_id === agentId);
    if (!member) throw new InvalidArgumentsError(`Agent ${agentId} is not a member of team ${teamId}`);
    const currentLead = team.members.find((m) => m.agent_id === team.lead_agent_id);
    if (currentLead) currentLead.role = "member";
    member.role = "lead";
    team.lead_agent_id = agentId;
    team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.teamStore.save(team);
    return team;
  }
  async disband(teamId) {
    const team = await this.get(teamId);
    team.status = "disbanded";
    team.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.teamStore.save(team);
    this.eventBus.emit({ type: "team:disbanded", teamId });
  }
  /**
   * Find the team an agent belongs to (if any).
   */
  async findTeamForAgent(agentId) {
    const teams = await this.teamStore.list();
    return teams.find((t) => t.status === "active" && t.members.some((m) => m.agent_id === agentId)) ?? null;
  }
};

// src/container.ts
async function buildLightContainer(context) {
  const paths = new Paths(context.projectRoot);
  const configStore = new ConfigStore(paths);
  const globalConfigStore = new GlobalConfigStore();
  const [, config] = await Promise.all([
    paths.requireInit(),
    configStore.read()
  ]);
  const taskStore = new TaskStore(paths);
  const agentStore = new AgentStore(paths);
  const runStore = new RunStore(paths);
  const stateStore = new StateStore(paths);
  const contextStore = new ContextStore(paths);
  const messageStore = new MessageStore(paths);
  const goalStore = new GoalStore(paths);
  const teamStore = new TeamStore(paths);
  const eventBus = new EventBus();
  const taskService = new TaskService(taskStore, eventBus, config, paths, agentStore);
  const agentService = new AgentService(agentStore, stateStore, eventBus, config);
  const runService = new RunService(runStore, eventBus);
  const messageService = new MessageService(messageStore, agentStore, teamStore, eventBus);
  const goalService = new GoalService(goalStore, eventBus, agentService, taskService, contextStore);
  const teamService = new TeamService(teamStore, agentStore, taskStore, eventBus);
  return {
    context,
    paths,
    config,
    taskStore,
    agentStore,
    runStore,
    stateStore,
    configStore,
    globalConfigStore,
    globalConfig: DEFAULT_GLOBAL_CONFIG,
    contextStore,
    messageStore,
    goalStore,
    teamStore,
    eventBus,
    taskService,
    agentService,
    runService,
    messageService,
    goalService,
    teamService
  };
}
async function buildFullContainer(context) {
  const light = await buildLightContainer(context);
  const globalConfig = await light.globalConfigStore.read();
  light.globalConfig = globalConfig;
  const [
    { ProcessManager },
    { AdapterRegistry: AdapterRegistry2 },
    { ClaudeAdapter },
    { CodexAdapter },
    { CursorAdapter },
    { ShellAdapter },
    { OpenCodeAdapter },
    { PiAdapter },
    { GrokAdapter },
    { AntigravityAdapter },
    { WorkspaceManager },
    { LiquidTemplateEngine },
    { SkillLoader: SkillLoader2 },
    { Orchestrator: Orchestrator2 },
    { DoctorService }
  ] = await Promise.all([
    import('./process-manager-A36Y7LHP.js'),
    import('./registry-JXXRLJ5J.js'),
    import('./claude-ZE5SNEXZ.js'),
    import('./codex-VDXRG4NE.js'),
    import('./cursor-VMK75R4H.js'),
    import('./shell-EDPTRNTV.js'),
    import('./opencode-6V6TINXP.js'),
    import('./pi-3OFLNKYY.js'),
    import('./grok-QFQSWGTD.js'),
    import('./antigravity-NRKD5QGY.js'),
    import('./workspace-manager-MPIOEYSJ.js'),
    import('./template-engine-ISDP5XFH.js'),
    import('./skill-loader-JFMCM7IB.js'),
    import('./orchestrator-IB64GWHA.js'),
    import('./doctor-service-F2SXDWHS.js')
  ]);
  const processManager = new ProcessManager();
  const templateEngine = new LiquidTemplateEngine();
  const skillLoader = new SkillLoader2();
  const workspaceManager = new WorkspaceManager(
    context.projectRoot,
    light.paths.root,
    processManager
  );
  const adapterRegistry = new AdapterRegistry2();
  adapterRegistry.register(new ClaudeAdapter(processManager));
  adapterRegistry.register(new CodexAdapter(processManager));
  adapterRegistry.register(new CursorAdapter(processManager));
  adapterRegistry.register(new ShellAdapter(processManager));
  adapterRegistry.register(new OpenCodeAdapter(processManager));
  adapterRegistry.register(new PiAdapter(processManager));
  adapterRegistry.register(new GrokAdapter(processManager));
  adapterRegistry.register(new AntigravityAdapter(processManager));
  const doctorService = new DoctorService(adapterRegistry, processManager, context.projectRoot);
  const orchestrator = new Orchestrator2({
    taskStore: light.taskStore,
    agentStore: light.agentStore,
    runStore: light.runStore,
    stateStore: light.stateStore,
    adapterRegistry,
    workspaceManager,
    templateEngine,
    processManager,
    eventBus: light.eventBus,
    taskService: light.taskService,
    agentService: light.agentService,
    runService: light.runService,
    contextStore: light.contextStore,
    messageService: light.messageService,
    goalStore: light.goalStore,
    skillLoader,
    config: light.config,
    projectRoot: context.projectRoot,
    lockPath: light.paths.lockPath
  });
  return {
    ...light,
    processManager,
    adapterRegistry,
    workspaceManager,
    templateEngine,
    skillLoader,
    doctorService,
    orchestrator
  };
}
async function buildContainer(context) {
  return buildFullContainer(context);
}

export { AGENT_SHOP_TEMPLATES, AgentService, EventBus, MODEL_TIER_MAP, RunService, SUPPORTED_ADAPTERS, TaskService, buildContainer, buildFullContainer, buildLightContainer, defaultModelForAdapter, detectClipboardType, getClipboardImage, getShopTemplateByKey, isAdapterKind, isClipboardToolAvailable, isMcpSkill, isModelTier, resolveModel, templateToAgentInput };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map