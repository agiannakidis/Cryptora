/**
 * Cryptora Mobile Touch Fix v2
 *
 * JS-only behavior that cannot be done in CSS:
 *  1. FastClick: removes 300ms iOS tap delay via touchend interception
 *  2. Passive touch enforcement: monkey-patches addEventListener for scroll perf
 *  3. .touching class: adds visual feedback via DOM tree walk to nearest interactive ancestor
 *
 * CSS rules (touch-action, overscroll, tap-highlight, font-smoothing)
 * live in design-system.css and mobile-fix.css. No CSS injection here.
 */
(function () {
  "use strict";

  // 1. FastClick: remove 300ms delay on iOS
  var lastTouchEnd = 0;
  document.addEventListener("touchend", function (e) {
    var now = Date.now();
    if (now - lastTouchEnd <= 300) { e.preventDefault(); }
    lastTouchEnd = now;
  }, { passive: false });

  // 2. Force passive:true on touchstart/touchmove unless caller needs passive:false
  var _addEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type === "touchstart" || type === "touchmove") {
      if (options === undefined || options === true || options === false) {
        options = { passive: true, capture: !!options };
      } else if (typeof options === "object" && options.passive !== false) {
        options = Object.assign({}, options, { passive: true });
      }
    }
    return _addEventListener.call(this, type, listener, options);
  };

  // 3. Add .touching class for tap feedback (requires DOM tree walk)
  document.addEventListener("touchstart", function (e) {
    var el = e.target;
    while (el && el !== document.body) {
      var tag = el.tagName;
      var role = el.getAttribute("role");
      var cursor = window.getComputedStyle(el).cursor;
      if (tag === "BUTTON" || tag === "A" || tag === "INPUT" ||
          role === "button" || role === "tab" || role === "menuitem" ||
          cursor === "pointer") {
        el.classList.add("touching");
        break;
      }
      el = el.parentElement;
    }
  }, { passive: true });

  function clearTouching() {
    var els = document.querySelectorAll(".touching");
    for (var i = 0; i < els.length; i++) { els[i].classList.remove("touching"); }
  }
  document.addEventListener("touchend", clearTouching, { passive: true });
  document.addEventListener("touchcancel", clearTouching, { passive: true });

})();
