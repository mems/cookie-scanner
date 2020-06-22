const puppeteer = require("puppeteer");
const {
  goto,
} = require("./lib/page");
const readStdin = require("get-stdin");
const args = require("command-line-args");

async function saveResult(cookies, {username, password, domainID, defaultCategory}){
  // Save result to CMS OneTrust Cookie Consent - Cookie Compliance Consent Policy Editor
  const browser = await puppeteer.launch({headless: false});
  const [page] = await browser.pages();
  await goto(page, "https://app-de.onetrust.com/auth/login");
  await (await page.waitForSelector("form[name=loginForm] input[name=Email]")).type(username);
  await (await page.waitForSelector("form[name=loginForm] button[type=submit]")).click();// next password step
  await (await page.waitForSelector("form[name=loginForm] input[name=Password]")).type(password);
  await Promise.all([
    page.waitForNavigation(),
    (await page.waitForSelector("form[name=loginForm] button[type=submit]")).click(),// Submit login form
  ]);
  const result = await (await page.evaluateHandle(async cookies => {
    const result = [];
    for(const cookie of cookies){
      try{
        // Note: Angular replace native Promise with ZoneAwarePromise but "(async function(){})().constructor" gives us the native constructor

        // deleteOldcookies([<ids-of-cookies-to-delete>]) but only some cookies are deleted, host groups (locked) can't be delete
        // to clear all cookies you must scan 2 times a cookie pristine page like https://example.com
        result.push(await angular.element("app-root").injector().get("CookiePolicyService").createCustomCookie(
          {
            ...cookie,
            purpose: "Unclassified Cookies",
            description: "",
            value: "",
          },
          domainID,
          cookie.category || defaultCategory,
        ));
      }catch(error){
        result.push(error);
      }
    }
    return Promise.all(result);
  }, cookies)).jsonValue();

  await browser.close();

  return result;
}

(async () => {
  const {
    password,
    username,
	domain: domainID,
	category: defaultCategory,
  } = args([
    {name: "password", alias: "p"},
    {name: "username", alias: "u"},
    {name: "domain", alias: "d", type: Number},
    {name: "category", alias: "c", type: Number},
  ]);

  const responses = await saveResult(JSON.parse(await readStdin()), {username, password, domainID, defaultCategory});

  /*
  error: "Conflict"
exception: "com.onetrust.cookieconsent.exception.ConflictException"
message: "Data has some conflicts : DuplicateCookie"
status: 409
timestamp: 1567795676215
   */
  debugger
  console.table([...responses.entries()].filter(([, {result}]) => !result).map(([index, {data, errors}]) => {
    const {name, host, path, isSession, isThirdParty, lifeSpan} = mergedCookies[index];
    return {name, host, path, isSession, isThirdParty, lifeSpan, data, errors}
  }));
})();