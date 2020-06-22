const puppeteer = require("puppeteer");
const {goto} = require("./lib/page");
const {isFirstParty} = require("./lib/http");
const {CookieObserver} = require("./lib/cookie");
const {writeFile} = require('fs').promises;
const args = require("command-line-args");
const {Console} = require('console');

const canonicalizableCookieNames = [
  [/^_cs_\d+/, "_cs_x"],// ex: _cs_1567795486325 -> _cs_x; https://cookiepedia.co.uk/cookies/_cs_x
  [/^OpenIdConnect\.nonce\..+/, "OpenIdConnect.nonce.x"],// ex: OpenIdConnect.nonce.6FhPBNvmcAm8CguZQiol%2FTo3es8eW1jo3Vyq68P8sRI%3D ; no cookiepedia entry exist; see https://github.com/aspnet/AspNetKatana/ Microsoft.Owin.Security.OpenIdConnect
  [/^SignInMessage\..+/, "SignInMessage.x"],// ex: SignInMessage.d2ff5a0c98a576c3cef63e1c073807a6 ; no cookiepedia entry exist
  [/^KRTBCOOKIE_.+/, "KRTBCOOKIE_x"],// ex: KRTBCOOKIE_244 ; no cookiepedia entry exist, but for https://cookiepedia.co.uk/cookies/KRTBCOOKIE_244
  [/^uid-bp-.+/, "uid-bp-x"],// ex: uid-bp-11554 ; no cookiepedia entry exist
  [/^sync_\d+/, "sync_x"],// ex: sync_16248314 ; no cookiepedia entry exist
  [/^adm_.+/, "adm_x"],// ex: adm_DLDdwoAvzlrj4hE36dBo-g ; no cookiepedia entry exist
  [/^ra1_pd_.+/, "ra1_pd_x"],// ex: ra1_pd_454828976 ; no cookiepedia entry exist
];

function canonicalCookieName(name){
  return canonicalizableCookieNames.reduce((name, args) => name.replace(...args), name);
}

/**
 * Merge cookies (same name, domain and path) as CookieStore
 * @param {Array} cookies In definition order
 * @return {Array}
 *
 * @see https://tools.ietf.org/html/rfc6265#section-5.3
 * @see https://tools.ietf.org/html/rfc6265#section-5.4
 */
function mergeCookies(cookies){
  return [
    ...cookies.reduce((cookies, cookie) => {
      const {name, host, path, initiator} = cookie;

      /*
      // https://tools.ietf.org/html/draft-west-first-party-cookies-07#section-4.2
      // TOOD keep the frame domain of the request (request.documentURL), but what about orign less URLs (data:, about:blank, blob:) https://tools.ietf.org/html/draft-west-first-party-cookies-07#section-5.2
      if(sameSite !== SameSiteFlags.NONE && frameDomain !== new URL(initiator.url).hostname){
        return cookies;
      }
      */

      // Note: If a persistent and non spersistent cookies have the same name, the OneTrust API return and error "Data has some conflicts : DuplicateCookie"
      // Note: The API don't use path information, means "Data has some conflicts : DuplicateCookie" if you send multiple cookies with only a different path
      const haskKey = JSON.stringify({name, host/*, path*//*, isSession*/});
      const existingCookie = cookies.get(haskKey);
      if(existingCookie){
        /*
        // https://tools.ietf.org/html/rfc6265#section-5.3 step 11.2
        if(existingCookie.httpOnly && initiator.type !== "network"){
          return cookies;
        }
        */

        // Merge other values
        cookie.lifeSpan = Math.max(cookie.lifeSpan, existingCookie.lifeSpan);
        cookie.isSession = cookie.isSession && existingCookie.isSession;

        // Merge paths by getting the common base
        const pathParts = cookie.path.substr(1).split(/(\/)/);
        cookie.path = "/" + pathParts.splice(0, existingCookie.path.substr(1).split(/(\/)/).findIndex((part, index) => part !== pathParts[index])).join("");

        // Always keep the first cookie set, further set are often used to clear the first one (set value to empty). Like cookie erasing because there is too much cookie, etc.
        return cookies;
      }

      return cookies.set(haskKey, cookie);
    }, new Map())
    .values()
  ];
}

function simpleCookies(cookies, firstPartyDomain){
  return cookies.map(({name, domain, path, persistent, creationTime, expiryTime, initiator}) => {
    const maxAge = expiryTime - creationTime;
    return {
      name: canonicalCookieName(name),
      host: domain,
      path,
      // /!\ The OneTrust API return an error if isSession=false and lifeSpan=0 (or negative), but by RFC definition session=false only Expires or Max-Age attributes are defined and have a valid value
      // That's means `Set-Cookie: a=1; Max-Age=0` is a non-session cookie
      // "If the server wishes the user agent to persist the cookie over multiple "sessions" [...], the server can specify an expiration date in the Expires attribute" - https://tools.ietf.org/html/rfc6265#section-3.1
      // "If a cookie has neither the Max-Age nor the Expires attribute, the user agent will retain the cookie until "the current session is over" (as defined by the user agent)." - https://tools.ietf.org/html/rfc6265#section-4.1.2.2
      isSession: !persistent || maxAge <= 0,
      isThirdParty: !isFirstParty(domain, firstPartyDomain),
      lifeSpan: persistent ? Math.max(Math.ceil(maxAge / (24 * 60 * 60 * 1000)), 0) : 0,// number of days, use 0 for non persistent cookies
      initiator: initiator && [initiator.type === "network" ? initiator.url : null, ...initiator.stack].filter(Boolean).join("\n")
    };
  });
}

function sortCookies(cookies){
  return cookies.sort((a, b) => {
    let result = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    if(result === 0){
      result = a.host < b.host ? -1 : a.host > b.host ? 1 : 0;
    }
    if(result === 0){
      result = a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    }
    return result;
  });
}



(async () => {
  // redirect all console to stderr
  global.console = new Console({stdout: process.stderr});

  // See also https://github.com/webpack/webpack-cli/blob/f0f12c9/packages/init/init.ts#L49
  const {
    config,
    verbose,
  } = args([
    {name: "config", type: filename => require(filename), defaultOption: true, defaultValue: {steps: []}},
    {name: "verbose", alias: "v", type: Boolean},
  ]);
  const {steps, firstPartyDomain} = config;

  // Note: this start Chromium with a new HTTP cache and without any cookies kept. Use userDataDir option to keep it
  //*
  // TMP: use browserfetcher to get a specific version of chrome on which we can disable network service and site isolation
  const browserFetcher = puppeteer.createBrowserFetcher();
  const revisionInfo = await browserFetcher.download('638880');
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--disable-features=NetworkService", "--disable-site-isolation-trials"],
    executablePath: revisionInfo.executablePath,
  });
  /*/
  const browser = await puppeteer.launch({
    headless: false,
  });
  //*/

  const [page] = await browser.pages();
  const cookies = [];
  const cookieObserver = new CookieObserver(changes => cookies.push(...changes));
  await cookieObserver.observe(page);
  // TODO observe when popins and workers are created. See https://gist.github.com/Dry7/6ef5d8e363eb8ee05d833ca5d72cc5dd#file-redirects-js-L9-L25
  // But there is an issue with the devtools protocol for that: https://github.com/ChromeDevTools/devtools-protocol/issues/77 and https://github.com/cyrus-and/chrome-remote-interface/issues/319

  const client = await page.target().createCDPSession();
  if(verbose){
    client.on("Network.requestWillBeSent", event => console.log({requestWillBeSent: event}));
    client.on("Network.responseReceived", event => console.log({responseReceived: event}));
    client.on("Network.responseReceivedExtraInfo", event => console.log({responseReceivedExtraInfo: event}));
  }

  // https://github.com/puppeteer/puppeteer/issues/4469
  // https://github.com/puppeteer/puppeteer/issues/4267
  // Note: Network.setBlockedURLs is depreciated? https://github.com/puppeteer/puppeteer/pull/1336/files#r150363617 https://chromedevtools.github.io/devtools-protocol/tot/Network#method-setBlockedURLs
  let {blockedURLs} = config;
  blockedURLs = Array.isArray(blockedURLs) ? blockedURLs : Boolean(blockedURLs) ? [String(blockedURLs)] : [];
  if(blockedURLs.length >= 1){
    await client.send("Network.setBlockedURLs", {urls: blockedURLs});
  }

  await client.send("Network.enable");

  // TODO handle popup? and webworkers/sharedworker (server worker too?)

  for(const step of steps){
    try{
      if(typeof step === "object" && "title" in step && typeof step.exec === "function"){
        if(verbose){
          console.log(`Exec ${step.title}`);
        }
        await step.exec(page);
        continue;
      }

      const url = String(step);
      if(url && (url.startsWith("http:") || url.startsWith("https:") || url === "about:blank")){
        console.log(`Load ${url}`);
        await goto(page, url);
        continue;
      }

      throw new Error(`Invalid step ${JSON.stringify(step)}`);
    }catch(error){
      console.error(error);
    }
  }

  await cookieObserver.disconnect();

  const browserCookies = sortCookies(mergeCookies((await client.send('Network.getAllCookies')).cookies.map(({name, domain, path, expires, session}) => {
    const domainWihoutLeadingDot = domain.replace(/^\./, "");
    return {
      name: canonicalCookieName(name),
      host: domainWihoutLeadingDot,
      path,
      isSession: session,
      isThirdParty: !isFirstParty(domainWihoutLeadingDot, firstPartyDomain),
      // For OneTrust API, expires is always = 0 for session cookies
      lifeSpan: Math.max(Math.ceil((expires * 1000 - Date.now()) / (24 * 60 * 60 * 1000)), 0),// number of days, here it's an estimation
    }
  })));

  const resultCookies = sortCookies(mergeCookies(simpleCookies(cookies, firstPartyDomain)));

  await browser.close();

  if(verbose){
    console.log({cookies});
    console.log({browserCookies});
    console.log({resultCookies});
  }

  console.table(browserCookies);
  console.table(resultCookies.map(({initiator, ...cookie}) => cookie));

  process.stdout.write(JSON.stringify(resultCookies));
})();