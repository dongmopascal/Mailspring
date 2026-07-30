import fs from 'node:fs';
import path from 'node:path';
import Handlebars from 'handlebars';

export class TemplateRenderer {
  constructor(templatesDir) {
    this.templatesDir = templatesDir;
    this.cache = new Map();
  }

  _compile(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const filePath = path.join(this.templatesDir, `${name}.hbs`);
    const source = fs.readFileSync(filePath, 'utf8');
    const compiled = Handlebars.compile(source);
    this.cache.set(name, compiled);
    return compiled;
  }

  render(name, variables = {}) {
    const compiled = this._compile(name);
    return compiled(variables);
  }
}
