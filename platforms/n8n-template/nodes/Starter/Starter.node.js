const { transform } = require('./helpers');

class Starter {
  constructor() {
    this.description = {
      displayName: '{{title}}',
      name: 'starter',
      group: ['transform'],
      version: 1,
      description: 'Node for {{topic}}',
      defaults: { name: '{{title}}' },
      inputs: ['main'],
      outputs: ['main'],
      properties: [
        { displayName: 'Input', name: 'input', type: 'string', default: '', description: 'Value to process' },
      ],
    };
  }

  async execute() {
    const items = this.getInputData();
    return [items.map((item, i) => ({ json: { result: transform(this.getNodeParameter('input', i)) } }))];
  }
}

module.exports = { Starter };
