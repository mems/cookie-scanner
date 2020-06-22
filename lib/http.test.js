const {deepStrictEqual, strictEqual} = require("assert").strict;
const {matchDomain, isPublicSuffix, isFirstParty} = require("./http.js");

{
  strictEqual(matchDomain("", "example.com"), false);
  strictEqual(matchDomain("co.uk", "bbc.co.uk"), true);
  strictEqual(matchDomain("example.com.", "example.com"), false);
  strictEqual(matchDomain("www1.example.com", "www2.example.com"), false);
  strictEqual(matchDomain("www3.www2.www1.example.com", "www3.www2.www1.example.com"), true);
  strictEqual(matchDomain("www3.www2.www1bis.example.com", "www3.www2.www1.example.com"), false);
  strictEqual(matchDomain("w.example.com", "www.example.com"), false);
// Punycode
  strictEqual(matchDomain("www.高境界.公司.香港", "a.www.xn--0nsu38d3xz.xn--55qx5d.xn--j6w193g"), false);// 高境界.公司.香港 === xn--0nsu38d3xz.xn--55qx5d.xn--j6w193g
// IP addresses, see https://tools.ietf.org/html/rfc3986 IP-literal and IPv4address
  strictEqual(matchDomain("localhost", "127.0.0.1"), false);
  strictEqual(matchDomain("2130706433", "127.0.0.1"), false);// 2130706433 === 127.0.0.1
  strictEqual(matchDomain("example.com", "[::1]"), false);
  strictEqual(matchDomain("[2001:0db8:85a3:0000:0000:8a2e:0370:7334]", "[2001:db8:85a3::8a2e:370:7334]"), false);// [2001:0db8:85a3:0000:0000:8a2e:0370:7334] === [2001:db8:85a3::8a2e:370:7334]
  strictEqual(matchDomain("[::ffff:127.0.0.1]", "[::ffff:7f00:1]"), false);// IPv4 mapped IPv6 [::ffff:127.0.0.1] === [::ffff:7f00:1]
}

{
  strictEqual(isPublicSuffix("example.com"), false);
  strictEqual(isPublicSuffix("com"), true);
  strictEqual(isPublicSuffix("localhost"), false);
  strictEqual(isPublicSuffix("pvt.k12.ma.us"), true);
  strictEqual(isPublicSuffix("co.uk"), true);
  strictEqual(isPublicSuffix("bbc.co.uk"), false);
  strictEqual(isPublicSuffix("uk.co"), false);
  strictEqual(isPublicSuffix("gov.co"), true);
}

{
  strictEqual(isFirstParty("a.com", "b.com"), false);
  strictEqual(isFirstParty("www2.example.com", "www1.example.com"), true);
  strictEqual(isFirstParty("www.example.com", "example.com"), true);
  strictEqual(isFirstParty("example.com", "example.com"), true);
  strictEqual(isFirstParty("example.com", "www.example.com"), true);
  strictEqual(isFirstParty("localhost", "www.localhost"), true);
}