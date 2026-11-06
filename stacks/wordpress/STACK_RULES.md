# 🌐 Modern WordPress, Gutenberg & OOP Plugin Architecture Rules

## 1. Core Architecture & Folder Hierarchy
- **Paradigm**: Object-Oriented Plugin & Gutenberg Block Architecture (PHP 8.2+):
  - `includes/`:
    - `Core/`: Plugin lifecycle, container/dependency injection, autoloader (Composer PSR-4).
    - `PostTypes/`: Custom Post Types and Custom Taxonomies registration classes.
    - `RestApi/`: Custom WP REST API controllers extending `WP_REST_Controller`.
    - `Admin/`: Settings pages, meta boxes, and admin notices.
  - `src/blocks/`: Gutenberg block sources (React, `block.json`, InspectorControls).
  - `build/`: Webpack compiled assets (`@wordpress/scripts`).
  - `templates/`: Clean PHP / Block template files.

## 2. Senior WordPress Security & Performance Guidelines
- **Zero Trust on Input / Output**:
  - Sanitize all input (`sanitize_text_field`, `sanitize_key`, `wp_kses_post`).
  - Escape all output (`esc_html`, `esc_attr`, `esc_url`, `esc_html__`).
  - Use prepared statements for custom queries (`$wpdb->prepare`).
- **Nonce & Capability Verification**:
  - Always verify nonces (`check_ajax_referer` or `wp_verify_nonce`).
  - Always check user permissions (`current_user_can('manage_options')`).
- **Performance & Caching**:
  - Use WordPress Transients API with sensible expiration for expensive operations.
  - Never run unfiltered queries inside template loops; use `WP_Query` with pagination and `fields => 'ids'`.
- **Namespacing**: Use strict PHP 8 namespaces and prefix all hook names, option names, and transients.

## 3. Testing Standards
- Unit testing with **PHPUnit** and **Brain Monkey** / **WP_Mock**.
- End-to-end testing with **Playwright**.
