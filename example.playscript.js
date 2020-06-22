const {
  goto,
} = require("./lib/page");

const steps = [
  {title: "Search", async exec(page){
    await goto(page, "https://www.wikipedia.org/");
    const input = await page.waitForSelector("#searchInput");
    await input.type("");
    await Promise.all([
      page.waitForNavigation(),
      input.evaluate(node => node.form.submit()),// Submit
    ]);
  }},
  "https://en.wikipedia.org/wiki/Internet_privacy#HTTP_cookies",
  "about:blank",// be sure the last page trigger beforeunload event and start requests (keep lives, or synchronous XHR). See https://fetch.spec.whatwg.org/#keep-alive-flag
];

module.exports = {
  steps,
  firstPartyDomain: "wikipedia.org",
};