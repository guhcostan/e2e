import { experimental_evaluate } from 'ai';
import { clef, evaluationModel } from '@e2e-dev/decision';

const model = evaluationModel(clef({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
  apiKey: process.env.CLOUDFLARE_AUTH_TOKEN ?? '',
}));

const result = await experimental_evaluate({
  model,
  state: { message: 'I was charged twice.' },
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which team should handle this?',
      criteria: { billing: 'Payments and refunds', support: 'Other requests' },
    },
  },
});

console.log(result.answers.department.choice, result.answers.department.probabilities);
