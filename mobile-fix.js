/**
 * Cryptora Mobile Touch Fix
 * Injected before the app bundle
 */
(function () {
  'use strict';

  // 1. FastClick: убираем 300ms задержку на iOS через TouchEvent → click
  //    Работает в связке с touch-action: manipulation в CSS
  //    Дополнительно — FastClick для элементов без touch-action
  var lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    var now = Date.now();
    if (now - lastTouchEnd <= 300) {
      e.preventDefault(); // убираем дублирующий click после touch
    }
    lastTouchEnd = now;
  }, { passive: false });

  // 2. Принудительно делаем passive touchstart/touchmove
  //    на скролл-контейнерах (они вызывают задержку)
  var _addEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type === 'touchstart' || type === 'touchmove') {
      // Если options не задан или passive не явно false — делаем passive
      if (options === undefined || options === true || options === false) {
        options = { passive: true, capture: !!options };
      } else if (typeof options === 'object' && options.passive !== false) {
        options = Object.assign({}, options, { passive: true });
      }
      // Если явно passive:false — оставляем (это intentional, напр. drag)
    }
    return _addEventListener.call(this, type, listener, options);
  };

  // 3. Визуальный фидбек на touch — добавляем класс .touching
  document.addEventListener('touchstart', function (e) {
    var el = e.target;
    // Поднимаемся по дереву до интерактивного элемента
    while (el && el !== document.body) {
      var tag = el.tagName;
      var role = el.getAttribute('role');
      var cursor = window.getComputedStyle(el).cursor;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ||
          role === 'button' || role === 'tab' || role === 'menuitem' ||
          cursor === 'pointer') {
        el.classList.add('touching');
        break;
      }
      el = el.parentElement;
    }
  }, { passive: true });

  document.addEventListener('touchend', function () {
    var els = document.querySelectorAll('.touching');
    for (var i = 0; i < els.length; i++) {
      els[i].classList.remove('touching');
    }
  }, { passive: true });

  document.addEventListener('touchcancel', function () {
    var els = document.querySelectorAll('.touching');
    for (var i = 0; i < els.length; i++) {
      els[i].classList.remove('touching');
    }
  }, { passive: true });

})();
