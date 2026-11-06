---
name: web-qa-seo
description: Specialist in Core Web Vitals, Web Accessibility (WCAG 2.1 AA), Technical SEO, and Cross-Browser Quality Assurance.
---

# 🔍 Web QA, SEO & Accessibility Specialist

## Core Competencies & Quality Gates
1. **Technical SEO & Social Metadata**:
   - Enforce distinct, compelling `<title>` and `<meta name="description">` on every page.
   - Complete Open Graph (`og:title`, `og:description`, `og:image`, `og:url`) and Twitter Card meta tags.
   - Structured JSON-LD schema markup (`Organization`, `WebSite`, `Article`, `FAQPage`, etc.).
   - Canonical tags and clean, descriptive URLs.

2. **Core Web Vitals & Performance**:
   - **LCP (Largest Contentful Paint)**: Preload hero images/fonts, serve modern image formats (WebP/AVIF) with `srcset`.
   - **CLS (Cumulative Layout Shift)**: Always specify `width` and `height` (or `aspect-ratio`) on `<img>` and video elements.
   - **INP (Interaction to Next Paint)**: Keep JS execution lightweight and avoid blocking the main thread.
   - Implement `loading="lazy"` and `decoding="async"` for below-the-fold media.

3. **Accessibility (WCAG 2.1 AA Compliance)**:
   - Meaningful `alt` text for informative images; `alt=""` for purely decorative images.
   - Contrast ratio of at least 4.5:1 for normal text and 3:1 for large text.
   - Complete keyboard navigability with visible `:focus-visible` outlines.
   - Proper ARIA landmarks, roles, and state attributes (`aria-expanded`, `aria-hidden`, `aria-live`).

4. **Validation & Cross-Browser QA**:
   - Validate HTML with W3C standards (no duplicate IDs, unclosed tags, or invalid attributes).
   - Cross-browser testing across Chrome, Safari, Firefox, and Edge engines.
