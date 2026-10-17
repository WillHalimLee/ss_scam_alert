// Loads the challenge data that harbor/build_data.py already converted (synthetic only).
const vm = require('vm'), fs = require('fs'), path = require('path');
module.exports = function loadData() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../harbor/data.js'), 'utf8'), ctx);
  return ctx.window.HARBOR_DATA;
};
