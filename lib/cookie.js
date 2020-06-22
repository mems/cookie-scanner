const {CookieParser} = require("./CookieParser");
const {readHeaderValue, isPublicSuffix, matchDomain} = require("./http");
const ErrorStackParser = require("error-stack-parser");

function trunc(value, limit = 60){
  value = String(value);
  limit = Number(limit);
  limit = Number.isNaN(limit) || limit <= 0 ? 60 : limit;
  // 60 (30) -> 30 + 29
  // 25 (12.5) -> 12 + 12
  return value.length > limit ? cookie.slice(0, limit / 2) + "…" + cookie.slice(-Math.ceil(limit / 2)) : value;
}

// https://stackoverflow.com/questions/11526504/minimum-and-maximum-date/11526569#11526569
const MIN_DATETIME = -8_640_000_000_000_000;
const MAX_DATETIME = 8_640_000_000_000_000;

/**
 * @typedef {Object} SetCookieRequest
 * @property {string} cookie Raw cookie string with attributes. eg. "a=1; Path=/; Domain=example.com"
 * @property {string} domain Domain of the request URL or the JS context that set the cookie
 * @property {number} timestamp
 * @property {Object} initiator
 * @property {string} initiator.url With canonicalized domain
 * @property {string} initiator.type
 * @property {Array} [initiator.stack]
 */

// https://bugs.chromium.org/p/chromium/issues/detail?id=953995
// Iterable enums
const SameSiteFlags = Object.freeze(Object.assign(["Strict", "Lax", "None"], {
  NONE: "None",
  STRICT: "Strict",
  LAX: "Lax",
}));

class Cookie{
  constructor({
    name = "",
    value = "",
    creationTime = Date.now(),// unix timestamp in milliseconds
    expiryTime = MAX_DATETIME,// unix timestamp in milliseconds
    persistent = false,
    // last-access-time not used here
    hostOnly = true,
    domain = "",
    path = "/",
    secureOnly = false,
    httpOnly = false,
    sameSite = "None",
    initiator = null,
  } = null){
    Object.assign(this, {name, value, creationTime, expiryTime, persistent, hostOnly, domain, path, secureOnly, httpOnly, sameSite, initiator});
  }
}

/**
 *
 * @param {SetCookieRequest}
 * @return {Array.<Object>}
 * @see https://tools.ietf.org/html/rfc6265#section-4.1
 */
function parseCookie(setCookie, {initiator, creationTime = Date.now()}){
  setCookie = String(setCookie);

  const {
    hostname: initiatorDomain,
    pathname: initiatorPath,
  } = new URL(initiator.url);

  // Fix the dev tool cookie parser for empty cookies name/value
  // https://bugs.chromium.org/p/chromium/issues/detail?id=722092#c10
  // https://bugzilla.mozilla.org/show_bug.cgi?id=169091
  // chromium0021 and chromium0018 https://wpt.fyi/results/cookies/http-state/chromium-tests.html?label=experimental&label=master&aligned
  if(setCookie.trim() === ""){
    return [new Cookie({
      creationTime,
      expiryTime: MAX_DATETIME,
      domain: initiatorDomain,
      path: initiatorPath,
      initiator,
    })];
  }

  return CookieParser.parseSetCookie(setCookie).reduce((cookies, parsedCookie) => {
    const maxAgeRaw = parsedCookie.maxAge();
    // https://tools.ietf.org/html/rfc6265#section-4.1.2.2
    const parsedMaxAge = maxAgeRaw && /^-?\d+$/.test(maxAgeRaw) ? parseInt(maxAgeRaw, 10) * 1000 : NaN;//ms
    if(maxAgeRaw && Number.isNaN(parsedMaxAge)){
      console.warn(`Ignore Max-Age attribute with invalid value "${maxAgeRaw}" for the cookie "${parsedCookie.name()}" from "${trunc(initiator.url, 60)}"`);
    }
    const expiresRaw = parsedCookie.expires();// must be GMT format only https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Date#Syntax
    // https://tools.ietf.org/html/rfc6265#section-4.1.2.1
    // https://tools.ietf.org/html/rfc6265#section-5.1.1
    // RFC1123 date, defined in https://tools.ietf.org/html/rfc2616#section-3.3.1
    // https://hg.mozilla.org/mozilla-central/file/663df481fcbff090b06c1d8f0736396567e77609/nsprpub/pr/src/misc/prtime.c#l1658
    // https://cs.chromium.org/chromium/src/net/cookies/cookie_util.cc?l=194&rcl=d0bcf099df0db1e4a713e97cdf4eafaf23dd986e
    // Here the date parser doesn't respect the RFC and use JS Date parser
    const parsedExpires = Date.parse(expiresRaw && /^[^-]+(\s|-)/.test(expiresRaw) ? expiresRaw : "");// ms
    if(expiresRaw && Number.isNaN(parsedExpires)){
      console.warn(`Ignore Expires attribute with invalid value "${expiresRaw}" for the cookie "${parsedCookie.name()}" from "${trunc(initiator.url, 60)}"`);
    }
    // https://tools.ietf.org/html/rfc6265#section-5.3 step 3
    // https://tools.ietf.org/html/rfc6265#section-5.2.2
    // Note: Max-Age attribute have precedence over Expires
    // Note: "latest representable date" for JavaScript is +8,640,000,000,000,000 ms relative to 01/01/1970 UTC +0. See https://stackoverflow.com/a/11526569/470117
    const expiryTime = Math.max(Math.min(Number.isNaN(parsedMaxAge) ? (Number.isNaN(parsedExpires) ? Number.POSITIVE_INFINITY : parsedExpires) : parsedMaxAge <= 0 ? MIN_DATETIME : creationTime + parsedMaxAge, MAX_DATETIME), MIN_DATETIME);
    const persistent = !Number.isNaN(parsedMaxAge) || !Number.isNaN(parsedExpires);// https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#Session_cookies

    // Leading dots in domain names are ignored. If a domain is specified, subdomains are always included. See https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
    // .example.com -> example.com
    // ..example.com -> .example.com
    // https://tools.ietf.org/html/rfc6265#section-5.2.3 and https://tools.ietf.org/html/rfc6265#section-5.3 step 4
    let domain = (parsedCookie.domain() || "").replace(/^\./, "").toLowerCase();
    let hostOnly = true;
    // https://tools.ietf.org/html/rfc6265#section-5.3 step 5
    // https://tools.ietf.org/html/rfc6265#section-4.1.2.3
    if(isPublicSuffix(domain)){
      if(domain !== initiatorDomain){
        console.warn(`Ignore cookie "${parsedCookie.name()}" from "${trunc(initiator.url, 60)}" with the "${parsedCookie.domain()}" public suffix as domain`);
        return cookies;
      }

      domain = "";
    }

    // https://tools.ietf.org/html/rfc6265#section-5.3 step 6
    if(domain !== ""){
      if(!matchDomain(domain, initiatorDomain)){
        console.warn(`Ignore cookie "${parsedCookie.name()}" from "${trunc(initiator.url, 60)}" with the domain "${parsedCookie.domain()}" that doesn't match`);
        return cookies;
      }

      hostOnly = false;
    }else{
      domain = initiatorDomain;
    }

    // https://tools.ietf.org/html/rfc6265#section-5.3 step 7
    const path = parsedCookie.path() || initiatorPath;

    // https://tools.ietf.org/html/rfc6265#section-5.3 step 8
    const secureOnly = parsedCookie.secure();

    // https://tools.ietf.org/html/rfc6265#section-5.3 steps 9 and 10
    const httpOnly = parsedCookie.httpOnly();
    if(httpOnly && initiator.type !== "network"){
      console.warn(`Ignore HttpOnly cookie "${parsedCookie.name()}" from "document.cookie" API call of "${trunc(initiator.url, 60)}"`);
      return cookies;
    }

    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#SameSite_cookies
    // https://tools.ietf.org/html/draft-west-first-party-cookies-07#section-4.2
    const sameSiteRaw = parsedCookie.sameSite();
    const sameSite = SameSiteFlags.find(flag => sameSiteRaw && sameSiteRaw.toLowerCase() === flag.toLowerCase()) || SameSiteFlags.NONE;

    // The rest of steps (11 and 12) must be handled by the cookie store

    cookies.push(new Cookie({
      name: parsedCookie.name(),
      value: parsedCookie.value(),
      creationTime,
      expiryTime,
      persistent,
      hostOnly,
      domain,
      path,
      secureOnly,
      httpOnly,
      sameSite,
      initiator,
    }));

    return cookies;
  }, []);
}

/**
 * /!\ This function is evaluated in an other JS context. No other scopes other than the "globalThis" of the document are available
 * @param {string} puppeteerCallbackName
 * @param {Array.<string>} allowedCookieProtocols
 */
function cookieProxy(puppeteerCallbackName, allowedCookieProtocols){
  // Proxying of document.cookie (see https://stackoverflow.com/questions/32410331/proxying-of-document-cookie)
  const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie") || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie");
  if (cookieDesc && cookieDesc.configurable) {
    Object.defineProperty(document, "cookie", {
      get: function () {
        return cookieDesc.get.call(document);
      },
      set: function (cookie) {
        const {stack} = new Error();
        window[puppeteerCallbackName]({
          cookie,
          // https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#Example
          creationTime: performance.timing.navigationStart + performance.now(),// or less precise Date.now(),
          // about:blank, data:, blob: aren't the real origin if it isn't the main frame. In that case use the parent origin
          url: allowedCookieProtocols.includes(location.protocol) ? location.href : location.ancestorOrigins[0] || location.href,// or use parent.location.href or parent.parent...location.href until top
          stack,
        });
        cookieDesc.set.call(document, cookie);
      }
    });
  }
}

const allowedCookieProtocols = ["https:", "http:"];
function allowedCookieOrigin(url){
  // Cookies can't be set on null origin/url (ex: about:blank, data:text/html, all non-HTTP resources). The API document.cookie should thrown an error "Uncaught DOMException: Failed to set the 'cookie' property on 'Document': Access is denied for this document." in that case
  return allowedCookieProtocols.some(protocol => url.startsWith(protocol));
}

class CookieObserver{
  #callback = null;
  static #cookieCallbackName = "__puppeteer_cookie_" + Math.round(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
  #pageClient = new WeakMap();
  #pages = new Set();
  #requestsByRequestId = new Map();

  constructor(callback){
    // function binding
    this.#requestWillBeSentHandler = this.#requestWillBeSentHandler.bind(this);
    this.#responseReceivedHandler = this.#responseReceivedHandler.bind(this);
    this.#responseReceivedExtraInfoHandler = this.#responseReceivedExtraInfoHandler.bind(this);

    if(typeof callback !== "function"){
      throw new TypeError("Callback must be a function");
    }
    this.#callback = callback;
  }

  async observe(page){
    if(this.#pages.has(page)){
      return;
    }

    this.#pages.add(page);

    // document.cookie proxy pupeteer callback
    page.exposeFunction(this.constructor.#cookieCallbackName, this.#jsCookieHandler.bind(this, page));
    // page.evaluateOnNewDocument(cookieProxy, this.constructor.#cookieCallbackName, allowedCookieProtocols);
    page.evaluateOnNewDocument(require("puppeteer/lib/helper.js").helper.evaluationString(cookieProxy, this.constructor.#cookieCallbackName, allowedCookieProtocols) + "\n//# sourceURL=file:///cookies-scanner/cookie-proxy.js");

    /*
    // For each response (and redirection responses)
    page.on("response", response => {
      response.headers();
      // timing missing
    });
     */

    // TODO handle race condition here when unobserve is used + add support of a takeRecords() method

    // page.browserContext() or browser.defaultBrowserContext() : browserContext.targets() and targetcreated event -> target.createCDPSession()
    const client = await page.target().createCDPSession();
    this.#pageClient.set(page, client);

    // requestWillBeSent could be dispatched multiple time for redirection:
    // 1. Network.requestWillBeSent: initial request
    // 2. (optional, loop until there is not more redirection response) Network.requestWillBeSent: the new location (3xx Redirection, redirectResponse is available, related to the previous request from previous step)
    // 3. Network.responseReceived: final response (related to the previous step) /!\ For preflight request only this event is dispatched twice (followed by the normal request and its response, if allowed)
    // 4. (if it's a frame's document) Page.frameNavigated
    // https://chromedevtools.github.io/devtools-protocol/tot/Network#event-requestWillBeSent
    client.on("Network.requestWillBeSent", this.#requestWillBeSentHandler);
    client.on("Network.responseReceived", this.#responseReceivedHandler);
    client.on("Network.responseReceivedExtraInfo", this.#responseReceivedExtraInfoHandler);
    await client.send("Network.enable");

    // TODO handle websocket Network.webSocketHandshakeResponseReceived
    // TODO SSE?
    // TODO Network.responseReceivedExtraInfo
    // https://chromedevtools.github.io/devtools-protocol/tot/Network#event-webSocketHandshakeResponseReceived
    // https://stackoverflow.com/a/46075339/470117
  }

  #jsCookieHandler = function(page, {cookie, creationTime, url, stack = ""}){
    // If the page has been stopped observing, this handler is called to late
    if(!this.#pages.has(page)){
      return;
    }

    if(!allowedCookieOrigin(url)){
      console.warn(`Ignore cookie "${trunc(cookie, 60)}" from "${trunc(url, 60)}"`);
      return;
    }

    const cookies = parseCookie(
      cookie,
      {
        creationTime,
        initiator: {
          type: "script",
          url,
          stack: this.#getStackFromString(stack).slice(1),// skip the first stack frame generated by "new Error()" call. See cookieProxy()
        },
      }
    );

    if(cookies.length){
      this.#callback(cookies, this);
    }
  }

  #requestWillBeSentHandler = function(event){
    const {request: {method, headers, url}, timestamp, requestId, redirectResponse} = event;

    if(!allowedCookieOrigin(url)){
      const cookie = readHeaderValue(headers, "Set-Cookie");
      // Shouldn't be happens:
      if(cookie !== null){
        console.warn(`Ignore cookie "${trunc(cookie, 60)}" from "${trunc(url, 60)}"`);
      }
      return;
    }

    // For preflight request cookies are ignored. See https://stackoverflow.com/questions/41478229/set-cookie-header-behaviour-in-a-preflight-options-request/41481851#41481851
    // Note: Redirection in preflight response is an network error (require ok status - 200-299) https://fetch.spec.whatwg.org/#cors-preflight-fetch
    // That means we can't have a second requestWillBeSent event for that request
    if(method === "OPTIONS" && readHeaderValue(headers, "Access-Control-Request-Method")){
      return;
    }

    // If it's a request for the new location (after the 3xx Redirection), redirectResponse is provided
    if(redirectResponse){
      this.#readResponseCookies({requestId, timestamp, response: redirectResponse});
      this.#requestsByRequestId.delete(requestId);// clear the previous request (that initiate the current request with redirection)
    }

    // But since the same requestId could have multiple requestWillBeSent event (a redirection use the same requestId for the whole chain), we need to store the value only after the redirection response has been treated to be sure the next response will use the right request
    this.#requestsByRequestId.set(requestId, event);
  }

  #getStackFromInitiator = function(initiator){
    const stack = [];
    let stackTrace = initiator.stack;

    while(stackTrace){
      for(const {url, lineNumber, columnNumber} of stackTrace.callFrames){
        stack.push(`${url}:${lineNumber}:${columnNumber}`);
      }
      stackTrace = stackTrace.parent;
    }

    if(stack.length === 0 && initiator.url){
      stack.push(`${initiator.url}:${initiator.lineNumber}:0`);
    }

    return stack;
  }

  #getStackFromString = function(str){
    try{
      return ErrorStackParser.parse({stack: str}).map(({fileName, lineNumber, columnNumber}) => `${fileName}:${lineNumber}:${columnNumber}`);
    }catch(error){
      return [];
    }
  }

  #responseReceivedHandler = function({requestId, response, timestamp}){
    // If the request is not available, that means it has been filtered out
    if(!this.#requestsByRequestId.has(requestId)){
      return;
    }

    this.#readResponseCookies({requestId, timestamp, response});
    this.#requestsByRequestId.delete(requestId);
  }

  // Note: timing is not available for data URIs
  #readResponseCookies = function({requestId, timestamp, response: {url, headers = {}, timing: {requestTime, receiveHeadersEnd} = {}}}){
    const {timestamp: requestTimestamp, wallTime, initiator} = this.#requestsByRequestId.get(requestId);
    // All requests should use the same monotonic starting point, but to be sure each request have the right time (wallTime could be affected by NTP sync or system time changes) we store it by requestId.
    // https://stackoverflow.com/questions/39627245/how-do-you-derive-walltime-from-timestamp-using-chromes-debugger-protocol/39634132#39634132
    // https://github.com/ChromeDevTools/devtools-frontend/blob/1c2b47020f893cb201138a49eb912f47c8a2f3e5/front_end/sdk/NetworkRequest.js#L291
    const startTimestamp = (wallTime - requestTimestamp) * 1000;// ms

    const cookie = readHeaderValue(headers, "Set-Cookie");

    if(cookie === null || cookie === undefined){
      return;
    }

    const cookies = parseCookie(
      cookie,
      {
        creationTime: startTimestamp + requestTime * 1000 + receiveHeadersEnd,// requestTime is in s, receiveHeadersEnd in ms
        initiator: {
          type: "network",
          url,
          stack: this.#getStackFromInitiator(initiator),
        },
      }
    );

    if(cookies.length){
      this.#callback(cookies, this);
    }
  }

  #responseReceivedExtraInfoHandler = function(){
    // TODO
  }

  async unobserve(page){
    if(!this.#pages.has(page)){
      return;
    }

    this.#pages.delete(page);
    const client = this.#pageClient.get(page);
    this.#pageClient.delete(page);
    client.off("Network.requestWillBeSent", this.#requestWillBeSentHandler);
    client.off("Network.responseReceived", this.#responseReceivedHandler);
    client.off("Network.responseReceivedExtraInfo", this.#responseReceivedExtraInfoHandler);
    await client.detach();
  }

  async disconnect(){
    await Promise.all([...this.#pages].map(page => this.unobserve(page)));
  }
}

module.exports = {
  parseCookie,
  CookieObserver,
  Cookie,
  SameSiteFlags,
  matchDomain,
};