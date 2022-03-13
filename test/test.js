import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const bundle = require('./quantityErrorBundle.json');
const { entry } = bundle;
console.log(JSON.stringify(entry[214], null, 2));
