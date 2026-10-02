/**
 * Benchmark flow: the same todos as `tests-agent/act.e2e.ts`, but with the
 * values as params. Decision executors choose only among bound choices, so
 * without params there is no type choice to offer and `unsupported` is the
 * only honest answer; the LLM side accepts the same file unchanged.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('parametrized todo flow', async ({ browser, agent, screen }) => {
  await browser.goto('/todos');
  await agent.act('add two todos named {first} and {second}, then mark {first} as done', {
    params: { first: 'Buy milk', second: 'Walk the dog' },
  });
  await expect(screen.getByRole('status')).toHaveText('1 remaining');
  await expect(screen.getByText('Buy milk')).toBeVisible();
  await expect(screen.getByText('Walk the dog')).toBeVisible();
});
