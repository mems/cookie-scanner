const {isSuccessfulResponse} = require("./http");

async function goto(page, url, options = null){
  options = {
    timeout: 60000,// see also page.setDefaultNavigationTimeout(timeout)
    waitUntil: ["load", "networkidle0"],
    ...options || null,
  }
  // Rejected for: https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options
  const response = await page.goto(url, options);// waitUntil default to "load"

  if(response === null){
    return;// hash navigation or to about:blank, see https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options
  }

  const statusCode = response.status();
  if(!isSuccessfulResponse(statusCode)){
    throw new Error(`Unsucessful response: ${statusCode} ${response.statusText()}`);
  }
}

/*
Get the closest element of a selector
 */
function waitForClosest(page, selector, closestSelector){
  return page.waitForFunction((selector, closestSelector) => {
    const element = document.querySelector(selector);
    return element && element.closest(closestSelector);
  }, {}, selector, closestSelector);
}

/*
Get the parent element of a selector
 */
function waitForParent(page, selector){
  return page.waitForFunction(selector => {
    const element = document.querySelector(selector);
    return element && element.parentElement;
  }, {}, selector);
}

module.exports = {
  goto,
  waitForClosest,
  waitForParent,
};