import type { ExecutorNode, StepExecutorContext } from 'e2e';

/**
 * An atomic operation whose arguments come only from the latest tree and
 * test params. The description names the verb, target, and arguments as
 * text; `run` dispatches the bound operation, never parsed model output.
 */
export interface Candidate {
  readonly description: string;
  run(): Promise<void>;
}

const tappable = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'checkbox', 'radio', 'switch', 'option', 'treeitem']);
const editable = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox']);
/** Roles the runner authorizes as secret sinks: spinbuttons carry a value but take no typed secret fill. */
const secretEditable = new Set(['textbox', 'searchbox', 'combobox']);

/** Enumerates the bounded grammar supported by the target without generating values or selectors. */
export function candidates(ctx: StepExecutorContext, tree: ExecutorNode): Candidate[] {
  const result: Candidate[] = [];
  const values = Object.entries(ctx.step.params ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  /** Names a node the way the screen text does, plus its stable id. */
  const label = (node: ExecutorNode): string =>
    `${node.role ?? 'node'} ${JSON.stringify(node.name ?? node.text ?? '')} [${node.id}]`;
  /** Walks the redacted tree, omitting hidden and disabled targets. */
  const visit = (node: ExecutorNode): void => {
    if (!node.states?.disabled && !node.states?.hidden) {
      const target = { id: node.id };
      if (ctx.target.verbs.has('tap') && tappable.has(node.role ?? '')) {
        result.push({ description: `tap ${label(node)}`, run: () => ctx.actions.tap(target) });
      }
      const readonlyAttr = node.attributes?.['readonly'];
      const ariaReadonly = node.attributes?.['aria-readonly'];
      if (editable.has(node.role ?? '') && readonlyAttr === undefined && ariaReadonly !== 'true') {
        if (node.inputPurpose !== 'password' && !node.states?.secure && ctx.target.verbs.has('type')) {
          for (const [param, value] of values) {
            if (node.value !== value) {
              result.push({ description: `type param ${JSON.stringify(param)} (${JSON.stringify(value)}) into ${label(node)}`, run: () => ctx.actions.type(target, value) });
            }
          }
        }
        if (secretEditable.has(node.role ?? '') && ctx.target.verbs.has('typeSecret')) {
          for (const secret of ctx.step.secrets) {
            if (secret.purpose !== 'password' || node.inputPurpose === 'password') {
              result.push({ description: `typeSecret ${JSON.stringify(secret.name)} into ${label(node)}`, run: () => ctx.actions.typeSecret(target, secret.name) });
            }
          }
        }
        if (ctx.target.verbs.has('press')) {
          for (const key of ['Enter', 'Tab', 'Escape']) {
            result.push({ description: `press ${JSON.stringify(key)} on ${label(node)}`, run: () => ctx.actions.press(target, key) });
          }
        }
      }
      if (ctx.target.verbs.has('check') && ['checkbox', 'radio', 'switch'].includes(node.role ?? '')) {
        for (const checked of [true, false]) {
          if (node.states?.checked !== checked) {
            result.push({ description: `check ${label(node)} as ${checked ? 'checked' : 'unchecked'}`, run: () => ctx.actions.check(target, checked) });
          }
        }
      }
      if (ctx.target.verbs.has('select') && node.role === 'combobox') {
        for (const [param, value] of values) {
          // An empty label is no choice: the runner rejects it with
          // INVALID_ARGUMENT and aborts the step instead of re-aiming.
          if (value === '') continue;
          result.push({ description: `select param ${JSON.stringify(param)} (${JSON.stringify(value)}) in ${label(node)}`, run: () => ctx.actions.select(target, value) });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  if (ctx.target.verbs.has('navigate')) {
    for (const [param, url] of values) {
      // A blank destination is no choice: the runner rejects it with
      // INVALID_ARGUMENT and aborts the step instead of re-aiming.
      if (url.trim() === '') continue;
      result.push({ description: `navigate to param ${JSON.stringify(param)} (${JSON.stringify(url)})`, run: () => ctx.actions.navigate(url) });
    }
  }
  if (ctx.target.verbs.has('back')) result.push({ description: 'back one step in history', run: () => ctx.actions.back() });
  if (ctx.target.verbs.has('scroll')) {
    for (const direction of ['up', 'down'] as const) result.push({ description: `scroll viewport ${direction}`, run: () => ctx.actions.scroll(direction) });
  }
  if (ctx.target.verbs.has('dismissKeyboard')) {
    result.push({ description: 'dismissKeyboard', run: () => ctx.actions.dismissKeyboard() });
  }
  return result;
}
