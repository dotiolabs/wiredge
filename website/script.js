// Simple scroll reveal animations
document.addEventListener('DOMContentLoaded', () => {
    // Reveal text in hero smoothly
    const heroText = document.querySelector('.reveal-text');
    if (heroText) {
        heroText.style.opacity = '0';
        heroText.style.transform = 'translateY(20px)';
        heroText.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
        
        setTimeout(() => {
            heroText.style.opacity = '1';
            heroText.style.transform = 'translateY(0)';
        }, 100);
    }

    // Scroll reveal for feature cards
    const featureCards = document.querySelectorAll('.feature-card');
    
    const observerOptions = {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }, index * 100); // stagger effect
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    featureCards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(card);
    });

    // Toggle mock extension switch
    const toggle = document.querySelector('.toggle-switch');
    if(toggle) {
        setInterval(() => {
            toggle.classList.toggle('on');
            if (toggle.classList.contains('on')) {
                toggle.style.background = 'var(--accent-cyan)';
                toggle.style.setProperty('--pseudo-right', '2px');
                toggle.style.setProperty('--pseudo-left', 'auto');
            } else {
                toggle.style.background = 'var(--card-border)';
                toggle.style.setProperty('--pseudo-left', '2px');
                toggle.style.setProperty('--pseudo-right', 'auto');
            }
        }, 3000);
    }
});
