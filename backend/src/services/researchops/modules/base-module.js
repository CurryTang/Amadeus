class BaseModule {
  constructor(moduleType) {
    this.moduleType = moduleType;
  }

  // eslint-disable-next-line class-methods-use-this
  validate(step) {
    if (!step || typeof step !== 'object') {
      throw new Error('Invalid step');
    }
    if (!step.id || typeof step.id !== 'string') {
      throw new Error('step.id is required');
    }
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async run(step, context) {
    throw new Error(`${this.moduleType} module run() not implemented`);
  }
}

module.exports = BaseModule;
