# 🌐 Vanilla Web (HTML5, Modern CSS3 & Vanilla JS) Architecture Rules

## 1. Core Architecture & Project Hierarchy
- **Zero Heavy Framework Bloat**: Pure, lightweight Semantic HTML5, Modern CSS3, and clean modular ES6+ JavaScript. No unnecessary `node_modules`, heavy bundlers, or virtual DOM abstractions unless explicitly requested.
- **Clean Standard Folder Structure**:
  - `index.html` (and semantic sub-pages `about.html`, `contact.html`, etc.)
  - `css/` (or `styles/`):
    - `variables.css` (Design tokens: color palettes, typography scales, spacing, border radii, glassmorphism)
    - `reset.css` (Modern CSS reset: box-sizing, margin resets, smooth scroll)
    - `style.css` (Main layout, components, typography)
    - `animations.css` (Keyframes, micro-interactions, transitions)
    - `responsive.css` (Media queries, container queries, mobile navigation)
  - `js/` (or `scripts/`):
    - `main.js` (App initialization, DOMContentLoaded listener, state/event delegation)
    - `modules/` (Modular ES modules: `theme-toggle.js`, `animations.js`, `modal.js`, `api.js`)
  - `assets/`:
    - `images/` (Optimized WebP, AVIF, responsive image sources)
    - `icons/` (Optimized inline or external SVGs)
    - `fonts/` (Self-hosted or preconnected modern Google Fonts)

## 2. Senior UI/UX & Design Guidelines
- **Modern Aesthetics & Visual Excellence**:
  - Curated, harmonious color palettes (Tailored HSL/OKLCH, sleek dark modes, vibrant accents).
  - Modern typography (e.g. Outfit, Inter, Plus Jakarta Sans, Vazirmatn for Persian/RTL).
  - Glassmorphism, subtle gradients, polished shadows (`box-shadow`, `backdrop-filter`).
  - Micro-interactions on buttons, cards, links with smooth transitions (`transition: transform 0.2s ease, opacity 0.2s ease`).
- **Responsive & Mobile-First**:
  - Fluid sizing using `clamp()`, `min()`, `max()`, `rem`, `ch`, `%`.
  - CSS Grid for 2D layouts and Flexbox for 1D alignments.
  - Mobile hamburger navigation with clean ARIA expanded states.
- **RTL & Multilingual Ready**: Use CSS Logical Properties (`margin-inline-start`, `padding-block`, `inset-inline-end`) for seamless LTR/RTL support.

## 3. Performance, SEO & Quality Standard
- **Core Web Vitals & Performance**:
  - 60fps animations: only animate `transform` and `opacity` to avoid layout thrashing and repaint cycles.
  - Image optimization: specify `width`, `height`, and `loading="lazy"` on non-hero images.
  - Preload critical fonts and hero assets.
- **SEO & Accessibility (WCAG 2.1 AA)**:
  - 100% Semantic HTML (`<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>`).
  - Unique `<title>` and `<meta name="description">` per page.
  - Open Graph (`og:title`, `og:description`, `og:image`) and Twitter Cards.
  - Meaningful `alt` text for all images and visible `:focus-visible` outlines for keyboard navigation.
