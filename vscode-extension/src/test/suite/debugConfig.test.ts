import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('extension package includes VS Code debug launch and build task configs', () => {
  const launchPath = path.resolve(process.cwd(), '.vscode', 'launch.json');
  const tasksPath = path.resolve(process.cwd(), '.vscode', 'tasks.json');

  assert.equal(fs.existsSync(launchPath), true, 'launch.json should exist');
  assert.equal(fs.existsSync(tasksPath), true, 'tasks.json should exist');

  const launch = JSON.parse(fs.readFileSync(launchPath, 'utf8')) as {
    version: string;
    configurations: Array<{ type?: string; request?: string; name?: string; preLaunchTask?: string }>;
  };
  const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8')) as {
    version: string;
    tasks: Array<{ label?: string; type?: string; script?: string; problemMatcher?: string[] }>;
  };

  assert.equal(launch.version, '0.2.0');
  assert.ok(
    launch.configurations.some((config) =>
      config.type === 'extensionHost'
      && config.request === 'launch'
      && config.preLaunchTask === 'npm: compile'
    ),
    'launch.json should define an extensionHost launch config'
  );

  assert.equal(tasks.version, '2.0.0');
  assert.ok(
    tasks.tasks.some((task) =>
      task.label === 'npm: compile'
      && task.type === 'npm'
      && task.script === 'compile'
    ),
    'tasks.json should define an npm compile task'
  );
});
