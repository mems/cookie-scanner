const psl = require("psl");

function isSuccessfulResponse(code){
  const category = Math.round(code / 100);
  switch(category){
    // https://en.wikipedia.org/wiki/List_of_HTTP_status_codes#2xx_Success
    case 2:
    // https://en.wikipedia.org/wiki/List_of_HTTP_status_codes#3xx_Redirection
    case 3:
      return true;
    default:
      return false;
  }
}

/**
 * Read the header from a collection
 * @param {Object} headers
 * @param {string} name
 * @return {string|null}
 */
function readHeaderValue(headers, name){
  // Note: HTTP/2.X headers are lower cased
  name = name.toLowerCase();
  const [, value = null] = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === name) || [];
  return value;
}

function isPublicSuffix(value){
  const {error, listed, sld} = psl.parse(value);
  return !error && listed && sld === null;
}

/**
 * Same eTLD+1 is same-site / same party
 * @param value
 * @param domain
 * @return {boolean}
 * @see https://twitter.com/johnwilander/status/1101726191457689600
 * @see https://dxr.mozilla.org/mozilla-central/rev/4cd56624e723867b1e508d73bd8ee82c899f5670/dom/base/ThirdPartyUtil.cpp#83-99
 * @see https://stackoverflow.com/questions/10092567/does-a-session-cookie-on-different-subdomain-count-as-3rd-party
 * @see https://web.archive.org/web/20190227114651/http://labs.fundbox.com/third-party-cookies-with-ie-at-2am
 */
function isFirstParty(domain, fistPartyDomain){
  const tldPlusOne = psl.parse(domain);

  // has public suffix, check eTLD+1
  if(!tldPlusOne.error && tldPlusOne.listed){
    return tldPlusOne.domain === psl.get(fistPartyDomain);
  }

  // else check last part
  return domain.split(".").slice(-1)[0] === fistPartyDomain.split(".").slice(-1)[0];
}

/*
FQDN: [fully qualified domain name](https://en.wikipedia.org/wiki/Fully_qualified_domain_name)
TLD: top level domain (e.g. .com, .net, .bmw, .us). See the [list of TLDs](http://data.iana.org/TLD/tlds-alpha-by-domain.txt)
eTLD: effective top level domain (e.g. .com, .co.uk and .pvt.k12.wy.us). See the [public suffix list](https://publicsuffix.org/)
eTLD+1: effective top level domain plus one level (e.g. example.com, example.co.uk)
SLD: second level domain (e.g. co is the SLD of www.example.co.uk)
*/
/**
 * Domain matching
 * Note: This doesn't check it the provided value is a valid domain
 * @param {string} value a string to match with the given domain
 * @param {string} domain canonized domain
 * @return {string}
 * @see https://tools.ietf.org/html/rfc6265#section-5.1.3
 * @see https://stackoverflow.com/questions/1062963/how-do-browser-cookie-domains-work
 */
function matchDomain(value, domain){
  // Canonicalize to lower case
  value = value.toLowerCase();

  // https://tools.ietf.org/html/rfc6265#section-5.1.3
  // > The domain string and the string are identical.
  if(value === domain){
    return true;
  }

  // https://tools.ietf.org/html/rfc6265#section-5.1.3
  // > the following conditions hold:
  // > - The last character of the string that is not included in the domain string is a %x2E (".") character.
  // > - The string is a host name (i.e., not an IP address).
  // IPv6 or IPv4
  if(value.endsWith(".") || /^\[|\.\d+$/.test(domain)){
    return false;
  }

  // https://tools.ietf.org/html/rfc6265#section-5.1.3
  // Domain must be a suffix of value
  const valueParts = value.split(".").reverse();
  const domainParts = domain.split(".").reverse();// www.example.com -> ["com", "example", "www"]
  if(!valueParts.every((part, index) => part === domainParts[index])){
    return false;
  }

  // The value match
  return true;
}

module.exports = {
  isSuccessfulResponse,
  readHeaderValue,
  isPublicSuffix,
  isFirstParty,
  matchDomain,
};