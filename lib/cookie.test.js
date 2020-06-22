const {parseCookie, Cookie} = require("./cookie.js");
const {deepStrictEqual, strictEqual} = require("assert").strict;

{
  const creationTime = Date.now();
  const futureTime = creationTime + 30*24*60*60*1000;//+30 days
  deepStrictEqual(parseCookie("", {initiator: {url: "http://example.com"}, creationTime}), [new Cookie({domain: "example.com", creationTime, initiator: {url: "http://example.com"}})]);
  deepStrictEqual(parseCookie(`a=1; Max-Age=${(futureTime - creationTime) / 1000}`, {initiator: {url: "http://example.com/page"}, creationTime}), [new Cookie({name: "a", value: "1", domain: "example.com", creationTime, expiryTime: futureTime, initiator: {url: "http://example.com/page"}, path: "/page", persistent: true})]);
  deepStrictEqual(parseCookie("a=1; Domain=.example.com", {initiator: {url: "http://www.example.com"}, creationTime}), [new Cookie({name: "a", value: "1", domain: "example.com", creationTime, hostOnly: false, initiator: {url: "http://www.example.com"}})]);
  deepStrictEqual(parseCookie("a=1; Domain=.local", {initiator: {url: "http://dev.local"}, creationTime}), [new Cookie({name: "a", value: "1", domain: "local", creationTime, hostOnly: false, initiator: {url: "http://dev.local"}})]);
  deepStrictEqual(parseCookie("a=1; Domain=com", {initiator: {url: "http://com"}, creationTime}), [new Cookie({name: "a", value: "1", domain: "com", creationTime, hostOnly: true, initiator: {url: "http://com"}})]);
  deepStrictEqual(parseCookie("a=1; Domain=com", {initiator: {url: "http://example.com"}, creationTime}), []);
  deepStrictEqual(parseCookie("a=1", {initiator: {url: "http://www.example.com"}, creationTime}), [new Cookie({name: "a", value: "1", domain: "www.example.com", creationTime, initiator: {url: "http://www.example.com"}})]);
  deepStrictEqual(parseCookie("a=1; expires=Invalid Date", {initiator: {url: "http://example.com"}, sameSite: "invalid", creationTime}), [new Cookie({name: "a", value: "1", domain: "example.com", creationTime, initiator: {url: "http://example.com"}})]);
  deepStrictEqual(parseCookie(`a=1; expires=${new Date(futureTime).toUTCString()}`, {initiator: {url: "http://example.com"}, sameSite: "invalid", creationTime}), [new Cookie({name: "a", value: "1", domain: "example.com", creationTime, expiryTime: Math.trunc(futureTime / 1000) * 1000, persistent: true, initiator: {url: "http://example.com"}})]);// date are truncated to seconds you generate a string
}