export const DEFAULT_LAUNCHER_SKILL = 'auto';

export const LAUNCHER_VISIBLE_SKILLS = ['auto'];

const AUTO_PROMPT_PREFIX = [
  'You are a project agent working on this repository.',
  'Decide which path fits the request: an implementation task or an experiment task.',
  'If it is an implementation task, inspect the relevant files, make the code changes directly, run relevant tests if they exist, and report the result.',
  'If it is an experiment task, determine the exact command or procedure to run, prepare the experiment workflow safely, and report the expected outputs or follow-up analysis.',
  'Prefer implementation when the user is asking for code, UI, refactors, fixes, or project configuration changes.',
  'Prefer experiment when the user is asking to execute, benchmark, evaluate, sweep, compare, or validate behavior with a runnable procedure.',
  '',
].join('\n');

export function getLauncherPromptPrefix(skill) {
  if (skill === 'auto') return AUTO_PROMPT_PREFIX;
  return AUTO_PROMPT_PREFIX;
}
