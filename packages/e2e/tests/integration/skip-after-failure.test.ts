import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Report1Document } from '../../src/report/build.ts';
import { assertValidReport } from '../helpers/report-schema.ts';
import { createProject, type FixtureProject } from '../helpers/run-project.ts';

const CLI = fileURLToPath(new URL('../../dist/cli/bin.js', import.meta.url));
const projects: FixtureProject[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

function runSkipped(source: string, policy = '', retries = 0, engineMembers = '') {
  const project = createProject({
    'e2e.config.ts': `import { defineEngine } from 'e2e/engine';
      export default {
        targets: [{ name: 'headless', platform: 'test', engine: defineEngine({ name: 'noop', version: '1', spiVersion: 1, ${engineMembers} }) }],
        workers: 1, retries: ${retries}, ${policy}
      };`,
    'tests/skip.e2e.ts': `import { test, expect } from 'e2e';
      import { existsSync, writeFileSync } from 'node:fs';
      ${source}`,
  });
  projects.push(project);
  const cli = spawnSync(process.execPath, [CLI, 'run'], {
    cwd: project.dir,
    env: { ...process.env, CI: '', E2E_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
    encoding: 'utf8',
    timeout: 20_000,
  });
  expect(cli.error).toBeUndefined();
  const output = cli.stdout + cli.stderr;
  expect(output).not.toContain('Run Errors');
  const report = JSON.parse(readFileSync(path.join(project.dir, '.e2e/report.json'), 'utf8')) as Report1Document;
  assertValidReport(report);
  return { project, output, report, exitCode: cli.status };
}

const SOFT_SKIP = `
  test.afterEach(() => writeFileSync('teardown.txt', 'ran'));
  test('soft then skip', () => {
    expect.soft(1, 'the count').toBe(2);
    expect.soft('old', 'the version').toBe('new');
    test.skip('feature disabled');
    throw new Error('unreachable');
  });`;

const RETRY_SKIP = `
  test('fails then skips its retry', { retries: 2 }, () => {
    if (existsSync('first-attempt.txt')) test.skip('feature disabled on retry');
    writeFileSync('first-attempt.txt', 'ran');
    expect(1, 'original failure').toBe(2);
  });`;

describe('a runtime skip after a failure', () => {
  it('keeps soft failures and prints them without changing the default exit code', () => {
    const { report, output, project, exitCode } = runSkipped(SOFT_SKIP);
    expect(exitCode).toBe(0);
    const result = report.run.results[0]!;
    expect(result.status).toBe('skipped');
    expect(result.skip?.reason).toBe('feature disabled');
    expect(result.attempts[0]?.secondaryErrors).toMatchObject([
      { code: 'ASSERTION_FAILED', phase: 'body', message: '2 soft assertions failed\n1. the count: expected 1 to be 2\n2. the version: expected "old" to be "new"' },
    ]);
    expect(output).toContain('Skipped After Failure 1');
    expect(output).toContain('the count: expected 1 to be 2');
    expect(output).toContain('the version: expected "old" to be "new"');
    expect(readFileSync(path.join(project.dir, 'teardown.txt'), 'utf8')).toBe('ran');
  });

  it('can fail CI on a soft failure followed by skip without retrying the skip', () => {
    const { report, exitCode, output } = runSkipped(SOFT_SKIP, 'failOnSkippedFailure: true,', 2);
    expect(exitCode).toBe(1);
    expect(report.run.status).toBe('failed');
    expect(report.run.results[0]?.attempts).toHaveLength(1);
    expect(report.run.results[0]?.status).toBe('skipped');
    expect(output).toContain('Skipped After Failure 1');
  });

  it.each(['', 'failOnSkippedFailure: true,'])('shows the original failure when a retry skips (%s)', (policy) => {
    const { report, output, exitCode } = runSkipped(RETRY_SKIP, policy);
    expect(exitCode).toBe(policy === '' ? 0 : 1);
    expect(report.run.results[0]?.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'skipped']);
    expect(output).toContain('Skipped After Failure 1');
    expect(output).toContain('original failure: expected 1 to be 2');
  });

  it('keeps clean skips and passing soft assertions green with the policy enabled', () => {
    const { report, output, exitCode } = runSkipped(`
      test('clean skip', () => { expect.soft(1).toBe(1); test.skip('not applicable'); });
      test('false condition', () => { test.skip(false); expect(1).toBe(1); });
      test('soft failure then recovery', { retries: 1 }, () => {
        if (existsSync('recovery.txt')) return;
        writeFileSync('recovery.txt', 'ran');
        expect.soft(1).toBe(2);
      });`, 'failOnSkippedFailure: true,');
    expect(exitCode).toBe(0);
    expect(report.run.results.map((result) => result.status)).toEqual(['skipped', 'passed', 'flaky']);
    expect(output).not.toContain('Skipped After Failure');
  });

  it('finds a serial member failure without blaming another skipped member', () => {
    const { report, output, exitCode } = runSkipped(`
      test.describe('serial', { serial: true }, () => {
        test('clean skip', () => { test.skip('not applicable'); });
        test('soft skip', () => { expect.soft(1).toBe(2); test.skip('feature disabled'); });
        test('next member', () => { expect(1).toBe(1); });
      });`, 'failOnSkippedFailure: true,');
    expect(exitCode).toBe(1);
    expect(report.run.results.map((result) => result.status)).toEqual(['skipped', 'skipped', 'passed']);
    expect(output).toContain('Skipped After Failure 1');
    expect(output).toContain('1 soft assertion failed');
  });

  it('does not turn post-skip cleanup diagnostics into a test failure', () => {
    const { report, output, exitCode } = runSkipped(
      `test('clean skip', () => { test.skip('not applicable'); });`,
      'failOnSkippedFailure: true,',
      0,
      `async endAttempt() { throw new Error('cleanup failed'); },`,
    );
    expect(report.run.results[0]?.attempts[0]?.secondaryErrors).toMatchObject([{ phase: 'cleanup' }]);
    expect(exitCode).toBe(0);
    expect(output).not.toContain('Skipped After Failure');
  });

  it('shows the original failure even when the skipped retry also fails cleanup', () => {
    const { output, exitCode } = runSkipped(
      RETRY_SKIP,
      'failOnSkippedFailure: true,',
      0,
      `async endAttempt() { throw new Error('cleanup failed'); },`,
    );
    expect(exitCode).toBe(1);
    expect(output).toContain('original failure: expected 1 to be 2');
  });
});
