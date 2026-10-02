import { test, expect } from 'e2e';

test('adds a todo', async ({ app, screen, agent }) => {
  await app.open();
  await agent.act('Open {destination}, add a todo named {title}, and verify it is listed.', {
    params: { destination: '/todos', title: 'Buy coffee' },
  });
  await expect(screen.getByTestId('todo')).toContainText('Buy coffee');
  await agent.assert('The todo list contains Buy coffee.');
});
