import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import util from 'util';

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const __dirname = dirname(fileURLToPath(import.meta.url));

const pathForSavedTempFile = path.join(__dirname, 'version_template.mjs');
const pathForSavedFile = path.join(__dirname, 'version.mjs');
const readJSONfile = path.join(__dirname, '..', 'package.json');

async function main() {
  const template = await readFile(pathForSavedTempFile);
  const package_json = await readFile(readJSONfile);

  const package_json_data = JSON.parse(package_json.toString());
  const template_string = template.toString();

  const version = template_string.replace('{{version}}', package_json_data.version);

  writeFile(pathForSavedFile, version);
}

main();
