const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir:'./tests/browser', timeout:120000, workers:1,
  use:{baseURL:'http://127.0.0.1:18797', browserName:'chromium', headless:true,
       launchOptions:process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}},
  webServer:{command:'npm run build:demo && python3 -m http.server 18797 --bind 127.0.0.1 --directory demo', url:'http://127.0.0.1:18797', reuseExistingServer:false}
});
