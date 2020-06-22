## Usage

```sh
node scan.js example.playscript.js > result.json
cat result.json | node convert.js --format html > result.html
cat result.json | node save.js -user "user@example.com" -password "password" -domain 1234 -category 1234

node scan.js -v example.playscript.js | jq 'map(.name)'
```

**NOTICE**: it's possible that some cookies are missing from the scan vs the browser cookiestore (diff of 2 console tags). This came from some issues with the Devtool protocol.

Exeample of cookies could be missed:

```
┌────────────────────────┬─────────────────────────────┬────────────────────┬───────────┬──────────────┬──────────┐
│          name          │            host             │        path        │ isSession │ isThirdParty │ lifeSpan │
├────────────────────────┼─────────────────────────────┼────────────────────┼───────────┼──────────────┼──────────┤
│         'NID'          │        'google.com'         │        '/'         │   false   │     true     │   183    │
│       'CONSENT'        │        'google.com'         │        '/'         │   false   │     true     │   6686   │
│       '__io_cid'       │         'bfmio.com'         │        '/'         │   false   │     true     │   365    │
│       '_cc_aud'        │       'crwdcntrl.net'       │        '/'         │   false   │     true     │   270    │
│        '_cc_cc'        │       'crwdcntrl.net'       │        '/'         │   false   │     true     │   270    │
│        '_cc_dc'        │       'crwdcntrl.net'       │        '/'         │   false   │     true     │   270    │
│        '_cc_id'        │       'crwdcntrl.net'       │        '/'         │   false   │     true     │   270    │
│          'c'           │   'creative-serving.com'    │        '/'         │   false   │     true     │   390    │
│  'done_redirects104'   │      'onaudience.com'       │        '/'         │   false   │     true     │    1     │
│  'done_redirects154'   │      'onaudience.com'       │        '/'         │   false   │     true     │    1     │
│        'tuuid'         │   'creative-serving.com'    │        '/'         │   false   │     true     │   390    │
│       'tuuid_lu'       │   'creative-serving.com'    │        '/'         │   false   │     true     │   390    │
│   'digitalAudience'    │ 'target.digitalaudience.io' │        '/'         │   false   │     true     │   3653   │
└────────────────────────┴─────────────────────────────┴────────────────────┴───────────┴──────────────┴──────────┘
``` 

<chrome://net-export/> with "Include cookies and credentials" option
https://netlog-viewer.appspot.com/#events

## TODO

Support WPT script: [Scripting - WebPagetest Documentation](https://sites.google.com/a/webpagetest.org/docs/using-webpagetest/scripting)

## Some implementation notes

- to parse cookies string you can use the same code as Chrome Dev Tools use (<https://github.com/ChromeDevTools/devtools-frontend/blob/d4139c8f33c23b6a476fcba3e78e9432c11a4d10/front_end/sdk/CookieParser.js#L71-L84>) or the code of Firefox Dev Tools (<https://phabricator.services.mozilla.com/source/mozilla-central/browse/default/devtools/shared/webconsole/network-helper.js;4e6dd979ed238a6c0be55ecfb8a42d6ca417d865$359>) or the code of Safari Web Inspector (<http://trac.webkit.org/browser/webkit/trunk/Source/WebInspectorUI/UserInterface/Models/Cookie.js?rev=244294#L133>) or <https://www.npmjs.com/package/cookie> and <https://www.npmjs.com/package/set-cookie-parser>
- cookie and set-cookie headers (and document.cookie) don't have the same syntax (last one can have attributes)
- all methods to get cookies based on Dev Tools Protocol to reading headers (via Network.responseReceived, etc.), can't access to all (headers like cookie and set-cookie), because Chrome use site isolation and there is some bugs (302 responses "Provisional headers are shown"). The solution is to use an not up-to-date version (like v74) and disable site isolation and/or NetworkService. See:
  - [874208 - Site Isolation causes cookie headers to be hidden in the network tab for third-party requests - chromium - Monorail](https://bugs.chromium.org/p/chromium/issues/detail?id=874208)
  - [868407 - Network panel show "Provisional headers are shown" for all non-same origin requests' request headers - chromium - Monorail](https://bugs.chromium.org/p/chromium/issues/detail?id=868407)
  - [Site Isolation - The Chromium Projects](https://www.chromium.org/Home/chromium-security/site-isolation#TOC-Known-Issues)
  - [Provide more request headers when intercepting requests · Issue #3436 · GoogleChrome/puppeteer](https://github.com/GoogleChrome/puppeteer/issues/3436)
  - [294891 - Network Panel: add caution about provisional request headers. - chromium - Monorail](https://bugs.chromium.org/p/chromium/issues/detail?id=294891#c2)
  - [http - "CAUTION: provisional headers are shown" in Chrome debugger - Stack Overflow](https://stackoverflow.com/questions/21177387/caution-provisional-headers-are-shown-in-chrome-debugger)
  - [puppeteer/Launcher.js at 0e0a67916d35672dc61580e83abf464afce10453 · GoogleChrome/puppeteer](https://github.com/GoogleChrome/puppeteer/blob/0e0a67916d35672dc61580e83abf464afce10453/lib/Launcher.js#L38)
  - args `--disable-site-isolation-trials`
  - args `--disable-features=SitePerProcess,IsolateOrigins,site-per-process` ?
- puppeteer `page.cookies()` API only return first-party cookies, without any information about when the cookie has been set. [javascript - Puppeteer get 3rd party cookies - Stack Overflow](https://stackoverflow.com/questions/50252943/puppeteer-get-3rd-party-cookies)
- there is no puppeteer/Dev Tools protocol API to listen when a cookie is set or deleted. A JS proxy is needed to be injected in all JS context to catch document.cookie setter call
- Dev Tools protocol `Network.getAllCookies()` get all cookies (first and thrid), but without any information about when the cookies has been setted. And also skip all cookies has been setted and later deleted. It's also affected by cookies attributes (secure, samesite) and validity value (ex: expires with invalid date `document.cookie = "hl_p=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx; expires=Invalid Date; path=/"` don't create any cookie)
- a network proxy can be used to capture all requests and responses but need to decrypt HTTPS (see `SSLKEYLOGFILE` and `--ssl-key-log-file`)
- puppeteer APIs don't expose any timing info about responses, use Chrome Dev Tools protocol instead
- NetLog can be used to read cookies, but `COOKIE_STORE` logs doesn't contains any timestamp
- Chrome Dev Tools protocol `Network.requestWillBeSent` event timing (timestamp) and NetLog (time) don't always match, can have ±1-2ms. Differents thread, different timing origin, etc.? Ex: 7452.719097 vs 7452720, 7696.90744 vs 7696908, 7697.047312 vs 7697047
- NetLog events can be used to read cookies from responses: `HTTP_TRANSACTION_READ_RESPONSE_HEADERS`
- `Set-Cookie` header value given by Dev Tools Protocol (and puppeteer) can contains `\n` for merged headers with same name <https://github.com/ChromeDevTools/devtools-frontend/blob/a6abfa251985712f5d447ab9231dc2383a6d5e7a/front_end/sdk/NetworkRequest.js#L1033-L1035>
- NetLog don't provide the frame for which the request has been made. That means also we can't know what is the first party origin of the request (the URL of top frame).
- NetLog include all requests has been made by the browser itself: PAC file (proxy configuration file), Google Services, Safe Browsing, etc.
  - <https://chromium.googlesource.com/chromium/chromium/+/trunk/google_apis/gcm/engine/gservices_settings.cc>
  - [Google Safe Browsing  |  Google Developers](https://developers.google.com/safe-browsing/)
  - <https://chromium.googlesource.com/chromium/src/+/refs/heads/master/tools/traffic_annotation/>
- cookies are shared across same domain or parent domain, not origin (protocol and ports aren't considered) [security - Are HTTP cookies port specific? - Stack Overflow](https://stackoverflow.com/questions/1612177/are-http-cookies-port-specific/16328399#16328399)
- browser send all cookies that match the domain and path. That means the server can receive a cookie more once but without any precedence "servers SHOULD NOT rely upon the serialization order" [RFC 6265 - HTTP State Management Mechanism - 4.2.2. Semantics](https://tools.ietf.org/html/rfc6265#section-4.2.2) See also [Cookie with same name from different domains · Issue #18 · jshttp/cookie](https://github.com/jshttp/cookie/issues/18)
- document.cookie can set/update only one cookie at a time [Document.cookie - Web APIs | MDN](https://developer.mozilla.org/en-US/docs/Web/API/document/cookie#Write_a_new_cookie)
- cookie names shouldn't use "any CHAR except CTLs or separators" and values shouldn't use "CTLs, whitespace DQUOTE, comma, semicolon, and backslash", see [RFC 6265 - HTTP State Management Mechanism - 4.1.1. Syntax](https://tools.ietf.org/html/rfc6265#section-4.1.1) The de facto is to use percentage encoding (of UTF-8 byte sequence)
- [Gert-Jan's Cookie Reference - Differences Between Web Browsers](https://gertjans.home.xs4all.nl/javascript/cookies.html)
- Chrome set expires to current date or past date, where the RFC 6265 specify
- [CookieMonster - The Chromium Projects](https://www.chromium.org/developers/design-documents/network-stack/cookiemonster) and <https://cs.chromium.org/chromium/src/net/cookies/cookie_monster.h>
- <https://hg.mozilla.org/mozilla-central/file/tip/netwerk/cookie/nsCookieService.cpp>
- <https://cs.chromium.org/chromium/src/net/cookies/canonical_cookie.cc>
