/**
 * Cryptora — Mobile Game Launcher v3
 * Intercepts fetch responses containing launchUrl and redirects on mobile.
 */
(function () {
  'use strict';

  function isMobile() {
    return window.innerWidth < 1024 ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }

  if (!isMobile()) return;

  // Only activate on GamePlay page
  if (window.location.pathname !== '/' && !window.location.search.includes('id=')) return;
  if (!window.location.href.includes('GamePlay') && !window.location.search.includes('GamePlay')) {
    // Check hash or search
    var href = window.location.href;
    if (href.indexOf('GamePlay') === -1) return;
  }

  var redirected = false;

  // Intercept fetch to catch launchUrl
  var origFetch = window.fetch;
  window.fetch = function() {
    return origFetch.apply(this, arguments).then(function(response) {
      if (redirected) return response;
      var clone = response.clone();
      clone.json().then(function(data) {
        if (redirected) return;
        var url = null;
        if (data && data.launchUrl) url = data.launchUrl;
        else if (data && data.data && data.data.launchUrl) url = data.data.launchUrl;
        if (url && (url.indexOf('grandx') !== -1 || url.indexOf('gs2.') !== -1 || url.indexOf('datachannel') !== -1 || url.indexOf('http') === 0)) {
          redirected = true;
          window.location.href = url;
        }
      }).catch(function(){});
      return response;
    });
  };

  // Fallback: intercept iframe src mutation
  var GAME_HOSTS = ['gs2.grandx.pro', 'datachannel.cloud', 'grandx.pro'];
  function isGameUrl(src) {
    if (!src) return false;
    return GAME_HOSTS.some(function(h) { return src.indexOf(h) !== -1; });
  }

  function handleIframe(iframe) {
    if (redirected || iframe.dataset.crHandled) return;
    var src = iframe.src || iframe.getAttribute('src') || '';
    if (!isGameUrl(src)) return;
    iframe.dataset.crHandled = '1';
    redirected = true;
    window.location.href = src;
  }

  var observer = new MutationObserver(function(mutations) {
    if (redirected) return;
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType !== 1) return;
        if (node.tagName === 'IFRAME') handleIframe(node);
        (node.querySelectorAll ? node.querySelectorAll('iframe') : []).forEach(handleIframe);
      });
      if (m.type === 'attributes' && m.attributeName === 'src' && m.target.tagName === 'IFRAME') {
        m.target.dataset.crHandled = '';
        handleIframe(m.target);
      }
    });
  });

  observer.observe(document.documentElement, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['src'],
  });

})();
