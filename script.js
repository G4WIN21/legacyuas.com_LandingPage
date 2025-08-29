// Swiper init for hero
const heroSwiper = new Swiper('.hero-swiper', {
  effect: 'fade',
  loop: true,
  autoplay: { delay: 5000, disableOnInteraction: false },
  speed: 900,
  pagination: { el: '.swiper-pagination', clickable: true }
});

// Simple scroll-reveal for sections
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) e.target.classList.add('revealed');
  });
}, { threshold: 0.12 });

document.querySelectorAll('.section, .card').forEach(el => {
  el.classList.add('reveal');
  observer.observe(el);
});
