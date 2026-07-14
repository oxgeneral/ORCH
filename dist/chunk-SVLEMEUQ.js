import { pathExists } from './chunk-MGX3XJQL.js';
import { NotInitializedError } from './chunk-BBYWS5VU.js';
import path from 'path';
import 'fs';
import fs from 'fs/promises';

var ORCHESTRY_DIR = ".orchestry";
var ID_PATTERN = /^[A-Za-z0-9._-]+$/;
var Paths = class {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }
  /** Root .orchestry/ directory */
  get root() {
    return path.join(this.projectRoot, ORCHESTRY_DIR);
  }
  get configPath() {
    return path.join(this.root, "config.yml");
  }
  get statePath() {
    return path.join(this.root, "state.json");
  }
  get lockPath() {
    return path.join(this.root, "orchestry.lock");
  }
  get tasksDir() {
    return path.join(this.root, "tasks");
  }
  get agentsDir() {
    return path.join(this.root, "agents");
  }
  get runsDir() {
    return path.join(this.root, "runs");
  }
  get templatesDir() {
    return path.join(this.root, "templates");
  }
  get logsDir() {
    return path.join(this.root, "logs");
  }
  get contextDir() {
    return path.join(this.root, "context");
  }
  contextPath(key) {
    return path.join(this.contextDir, `${sanitizeId(key)}.json`);
  }
  get messagesDir() {
    return path.join(this.root, "messages");
  }
  messagePath(id) {
    return path.join(this.messagesDir, `${sanitizeId(id)}.json`);
  }
  get goalsDir() {
    return path.join(this.root, "goals");
  }
  goalPath(id) {
    return path.join(this.goalsDir, `${sanitizeId(id)}.yml`);
  }
  get teamsDir() {
    return path.join(this.root, "teams");
  }
  get attachmentsDir() {
    return path.join(this.root, "attachments");
  }
  taskAttachmentsDir(taskId) {
    return path.join(this.attachmentsDir, sanitizeId(taskId));
  }
  teamPath(id) {
    return path.join(this.teamsDir, `${sanitizeId(id)}.yml`);
  }
  get gitignorePath() {
    return path.join(this.root, ".gitignore");
  }
  get workspaceExcludePath() {
    return path.join(this.root, "workspace-exclude");
  }
  taskPath(id) {
    return path.join(this.tasksDir, `${sanitizeId(id)}.yml`);
  }
  agentPath(id) {
    return path.join(this.agentsDir, `${sanitizeId(id)}.yml`);
  }
  runPath(id) {
    return path.join(this.runsDir, `${sanitizeId(id)}.json`);
  }
  runEventsPath(id) {
    return path.join(this.runsDir, `${sanitizeId(id)}.jsonl`);
  }
  defaultTemplatePath() {
    return path.join(this.templatesDir, "default.md");
  }
  async isInitialized() {
    return pathExists(this.root);
  }
  async requireInit() {
    if (!await this.isInitialized()) {
      throw new NotInitializedError();
    }
    await this.validateStateRoot();
  }
  async validateStateRoot() {
    const expected = path.resolve(this.root);
    const stat = await fs.lstat(expected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Unsafe .orchestry directory: ${expected}`);
    }
    const realRoot = await fs.realpath(expected);
    const realProjectRoot = await fs.realpath(this.projectRoot);
    const relative = path.relative(realProjectRoot, realRoot);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Unsafe .orchestry directory location: ${expected}`);
    }
    await fs.chmod(expected, 448).catch(() => {
    });
  }
};
function sanitizeId(id) {
  if (id === "." || id === "..") {
    throw new Error(`Invalid identifier: "${id}"`);
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid identifier: "${id}"`);
  }
  return id;
}
function validateWorkspacePath(workspacePath, projectRoot) {
  const resolved = path.resolve(workspacePath);
  const root = path.resolve(projectRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Workspace path "${workspacePath}" is outside project root`);
  }
}

export { Paths, sanitizeId, validateWorkspacePath };
//# sourceMappingURL=chunk-SVLEMEUQ.js.map
//# sourceMappingURL=chunk-SVLEMEUQ.js.map