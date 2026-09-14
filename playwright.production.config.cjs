const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir:'./tests/production', timeout:120000, workers:1,
  use:{baseURL:'http://127.0.0.1:18799', headless:true},
  projects:[{name:'chromium', use:{browserName:'chromium', launchOptions:process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}}},
    ...(process.env.CI ? [{name:'webkit',use:{browserName:'webkit'}}] : [])],
  webServer:{command:'npx wrangler dev --ip 127.0.0.1 --port 18799 --inspector-port 0 --show-interactive-dev-session false',
    url:'http://127.0.0.1:18799/TranscriptTamer', reuseExistingServer:false, timeout:120000}
});
