import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerDoctorCommand } from '../../../src/cli/commands/doctor.js';
import type { Container } from '../../../src/container.js';
import type { DoctorReport } from '../../../src/application/doctor-service.js';

const MOCK_REPORT: DoctorReport = {
  checks: [
    { name: 'claude', status: 'ok', detail: '1.0.0' },
    { name: 'shell', status: 'ok' },
    { name: 'git', status: 'ok', detail: 'git version 2.40' },
    { name: 'node', status: 'ok', detail: 'v20.0.0' },
  ],
  adaptersReady: 2,
  adaptersTotal: 2,
};

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    paths: {
      requireInit: vi.fn(async () => {}),
      isInitialized: vi.fn(async () => true),
    } as any,
    context: { json: false, quiet: false, noColor: false, ascii: false, projectRoot: '/tmp' },
    doctorService: {
      runAll: vi.fn(async () => MOCK_REPORT),
    },
    agentService: {
      list: vi.fn(async () => [{ id: 'agt_1', name: 'A1' }]),
    },
    taskService: {
      list: vi.fn(async () => [{ id: 'tsk_1', title: 'T1' }]),
    },
    ...overrides,
  } as any;
}

describe('doctor command', () => {
  let program: Command;
  let container: Container;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    container = makeContainer();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerDoctorCommand(program, container);
  });

  it('calls doctorService.runAll and prints checks', async () => {
    await program.parseAsync(['doctor'], { from: 'user' });

    expect(container.doctorService.runAll).toHaveBeenCalled();
    // Should print adapter checks and summary
    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any[]) => String(c[0] ?? '')).join('\n');
    expect(allOutput).toContain('2 of 2 adapters ready');
  });

  it('shows project state when initialized', async () => {
    await program.parseAsync(['doctor'], { from: 'user' });

    expect(container.agentService.list).toHaveBeenCalled();
    expect(container.taskService.list).toHaveBeenCalled();
    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any[]) => String(c[0] ?? '')).join('\n');
    expect(allOutput).toContain('1 agents');
    expect(allOutput).toContain('1 tasks');
  });

  it('shows not found when not initialized', async () => {
    container = makeContainer({
      paths: {
        requireInit: vi.fn(async () => {}),
        isInitialized: vi.fn(async () => false),
      } as any,
    });
    program = new Command();
    program.exitOverride();
    registerDoctorCommand(program, container);

    await program.parseAsync(['doctor'], { from: 'user' });

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any[]) => String(c[0] ?? '')).join('\n');
    expect(allOutput).toContain('not found');
  });

  it('outputs JSON when json mode', async () => {
    container = makeContainer({
      context: { json: true, quiet: false, noColor: false, ascii: false, projectRoot: '/tmp' },
    } as any);
    program = new Command();
    program.exitOverride();
    registerDoctorCommand(program, container);

    await program.parseAsync(['doctor'], { from: 'user' });

    const firstJsonCall = (console.log as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      },
    );
    expect(firstJsonCall).toBeDefined();
    const parsed = JSON.parse(firstJsonCall![0]);
    expect(parsed.checks).toBeDefined();
  });

  it('works without a container (pre-init mode)', async () => {
    program = new Command();
    program.exitOverride();
    registerDoctorCommand(program, undefined);

    // This will try to actually run doctor with real adapters
    // which will fail on CI, so we just verify it doesn't throw during registration
    expect(() => registerDoctorCommand(new Command(), undefined)).not.toThrow();
  });

  it('shows failed adapters correctly', async () => {
    const failReport: DoctorReport = {
      checks: [
        { name: 'claude', status: 'fail', detail: 'not found' },
        { name: 'git', status: 'ok', detail: 'git 2.40' },
      ],
      adaptersReady: 0,
      adaptersTotal: 1,
    };
    container = makeContainer({
      doctorService: { runAll: vi.fn(async () => failReport) },
    } as any);
    program = new Command();
    program.exitOverride();
    registerDoctorCommand(program, container);

    await program.parseAsync(['doctor'], { from: 'user' });

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any[]) => String(c[0] ?? '')).join('\n');
    expect(allOutput).toContain('0 of 1 adapters ready');
  });
});
