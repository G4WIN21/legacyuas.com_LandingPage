// Init Swiper (slide effect for reliability)
document.addEventListener('DOMContentLoaded', () => {
  if (typeof Swiper === 'undefined') {
    console.error('Swiper failed to load. Check the CDN link.');
    return;
  }
  new Swiper('.hero-swiper', {
    loop: true,
    speed: 900,
    autoplay: { delay: 5000, disableOnInteraction: false },
    pagination: { el: '.swiper-pagination', clickable: true },
    navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' }
    // For crossfade instead of sliding, uncomment:
    // effect: 'fade'
  });
});
