/* api.js — Cryptora Partners API Client v1 */
"use strict";

const API = (function() {
  const BASE = "/api/affiliate";
  
  function getToken() { return sessionStorage.getItem("_p_session"); }
  function setToken(t) { sessionStorage.setItem("_p_session", t); }
  function clearToken() { sessionStorage.removeItem("_p_session"); }
  function hasToken() { return !!getToken(); }
  
  async function request(method, path, body, noAuth) {
    const headers = { "Content-Type": "application/json" };
    if (!noAuth) {
      const token = getToken();
      if (!token) { window.location.hash = "#/login"; throw new Error("Not authenticated"); }
      headers["Authorization"] = "Bearer " + token;
    }
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    if (res.status === 401) {
      clearToken();
      window.location.hash = "#/login";
      throw new Error("Session expired. Please log in again.");
    }
    let data;
    try { data = await res.json(); } catch(e) { data = {}; }
    if (!res.ok) throw new Error(data.error || data.message || "HTTP " + res.status);
    return data;
  }
  
  return {
    getToken, setToken, clearToken, hasToken,
    login: (email, password) => request("POST", "/auth/login", {email, password}, true),
    logout: async () => { try { await request("POST", "/auth/logout"); } finally { clearToken(); } },
    me: () => request("GET", "/auth/me"),
    changePassword: (current_password, new_password) => request("POST", "/auth/change-password", {current_password, new_password}),
    stats: (params) => request("GET", "/stats" + (params ? "?" + new URLSearchParams(params) : "")),
    clicks: (params) => request("GET", "/clicks" + (params ? "?" + new URLSearchParams(params) : "")),
    earnings: (params) => request("GET", "/earnings" + (params ? "?" + new URLSearchParams(params) : "")),
    commissions: (params) => request("GET", "/commissions" + (params ? "?" + new URLSearchParams(params) : "")),
    referrals: (params) => request("GET", "/referrals" + (params ? "?" + new URLSearchParams(params) : "")),
    players: (params) => request("GET", "/players" + (params ? "?" + new URLSearchParams(params) : "")),
    profile: () => request("GET", "/me"),
    updatePostback: (postback_url) => request("PUT", "/postback", {postback_url}),
    testPostback: () => request("POST", "/postback/test", {}),
    notifications: (params) => request("GET", "/notifications" + (params ? "?" + new URLSearchParams(params) : "")),
    topGames: (params) => request("GET", "/top-games" + (params ? "?" + new URLSearchParams(params) : "")),
    topProviders: (params) => request("GET", "/top-providers" + (params ? "?" + new URLSearchParams(params) : "")),
    auditLog: () => request("GET", "/audit-log"),
  };
})();
