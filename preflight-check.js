#!/usr/bin/env node
'use strict';

/**
 * Static release gate for the RDF billing app.
 *
 * This intentionally uses only Node's standard library, so it can run before
 * every backend push without installing test tooling or touching live data.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const frontendPath = path.join(root, 'app.js');
const htmlPath = path.join(root, 'index.html');
const backendPath = path.join(root, 'backend');
const backendEntryPath = path.join(backendPath, 'Code.gs');
const backendConfigPath = path.join(backendPath, 'Config.gs');

let failures = 0;
let warnings = 0;

function pass(message) {
  console.log(`PASS  ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`FAIL  ${message}`);
}

function warn(message) {
  warnings += 1;
  console.warn(`WARN  ${message}`);
}

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing required file: ${path.relative(root, filePath)}`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function unique(values) {
  return [...new Set(values)];
}

function matches(source, regex, group = 1) {
  return unique([...source.matchAll(regex)].map(match => match[group]));
}

function checkSyntax(filePath, source) {
  try {
    new vm.Script(source, { filename: path.relative(root, filePath) });
    pass(`Syntax: ${path.relative(root, filePath)}`);
  } catch (error) {
    fail(`Syntax: ${path.relative(root, filePath)} — ${error.message}`);
  }
}

function main() {
  const app = readFile(frontendPath);
  const html = readFile(htmlPath);
  const backendEntry = readFile(backendEntryPath);
  const backendConfig = readFile(backendConfigPath);

  if (!app || !html || !backendEntry || !backendConfig) return finish();

  checkSyntax(frontendPath, app);
  checkSyntax(path.join(root, 'thai-baht.js'), readFile(path.join(root, 'thai-baht.js')));
  checkSyntax(path.join(root, 'local-dev-server.js'), readFile(path.join(root, 'local-dev-server.js')));

  const backendFiles = fs.readdirSync(backendPath)
    .filter(name => name.endsWith('.gs'))
    .sort();
  if (backendFiles.length === 0) {
    fail('No .gs backend files found.');
  } else {
    backendFiles.forEach(name => checkSyntax(path.join(backendPath, name), readFile(path.join(backendPath, name))));
  }

  const ids = matches(html, /\bid\s*=\s*["']([^"']+)["']/g);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) {
    fail(`Duplicate HTML id(s): ${unique(duplicateIds).join(', ')}`);
  } else {
    pass(`HTML ids: ${ids.length} unique id(s)`);
  }

  const openDivs = (html.match(/<div\b[^>]*>/gi) || []).length;
  const closeDivs = (html.match(/<\/div\s*>/gi) || []).length;
  if (openDivs !== closeDivs) {
    fail(`HTML div balance: ${openDivs} opening / ${closeDivs} closing`);
  } else {
    pass(`HTML div balance: ${openDivs}`);
  }

  if (/<script\b[^>]*\bsrc\s*=\s*["']app\.js(?:\?[^"']*)?["']/i.test(html)) {
    pass('index.html loads app.js');
  } else {
    fail('index.html does not load app.js');
  }

  const routes = matches(backendEntry, /\bcase\s+['"]([A-Za-z][A-Za-z0-9_]*)['"]\s*:/g);
  const publicActions = matches(backendEntry, /PUBLIC_ACTIONS\s*=\s*\[([^\]]*)\]/g, 1)
    .flatMap(value => matches(value, /['"]([A-Za-z][A-Za-z0-9_]*)['"]/g));
  const permissionActions = matches(backendConfig, /^\s{2}([A-Za-z][A-Za-z0-9_]*)\s*:\s*\[/gm);
  const protectedRoutes = routes.filter(action => !publicActions.includes(action));
  const missingPermissions = protectedRoutes.filter(action => !permissionActions.includes(action));

  if (missingPermissions.length) {
    fail(`Backend route(s) missing permission entries: ${missingPermissions.join(', ')}`);
  } else {
    pass(`Permissions cover ${protectedRoutes.length} protected backend route(s)`);
  }

  const unknownPermissionActions = permissionActions.filter(action => !routes.includes(action));
  if (unknownPermissionActions.length) {
    warn(`Permission entry without a backend route: ${unknownPermissionActions.join(', ')}`);
  }

  const frontendActions = matches(app, /\bapiCall\(\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]/g);
  const missingRoutes = frontendActions.filter(action => !routes.includes(action));
  if (missingRoutes.length) {
    fail(`Frontend API action(s) missing backend route: ${missingRoutes.join(', ')}`);
  } else {
    pass(`Backend routes cover ${frontendActions.length} literal frontend API action(s)`);
  }

  const hardCodedEndpoint = app.match(/const\s+GAS_API_URL\s*=\s*['"]([^'"]+)['"]/);
  if (!hardCodedEndpoint) {
    warn('No GAS_API_URL constant found; confirm the production endpoint is configured elsewhere.');
  } else if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(hardCodedEndpoint[1])) {
    fail('GAS_API_URL is not a Google Apps Script HTTPS endpoint.');
  } else {
    pass('GAS API endpoint format');
  }

  finish();
}

function finish() {
  if (failures) {
    console.error(`\nPreflight failed: ${failures} error(s), ${warnings} warning(s).`);
    process.exitCode = 1;
  } else {
    console.log(`\nPreflight passed with ${warnings} warning(s).`);
  }
}

main();
