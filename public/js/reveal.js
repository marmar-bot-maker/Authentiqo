// Shared by the new sections: fade-in-on-scroll for any element with
// class="reveal", and a number counter-up used by the Statistics Bar.
// Respects prefers-reduced-motion throughout.

(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (reduceMotion) {
      els.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    els.forEach((el) => observer.observe(el));
  }

  window.animateCounter = function animateCounter(el, target, duration = 1200) {
    if (reduceMotion) {
      el.textContent = target.toLocaleString();
      return;
    }
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      el.textContent = Math.round(target * eased).toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };

  window.observeOnce = function observeOnce(el, callback) {
    if (reduceMotion) {
      callback();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          callback();
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    observer.observe(el);
  };

  document.addEventListener('DOMContentLoaded', initReveal);
})();
