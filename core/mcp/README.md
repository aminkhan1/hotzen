# 🔌 راهنمای فعال‌سازی و تنظیمات سرورهای MCP (Model Context Protocol)

این پوشه شامل پیکربندی‌های آماده برای اتصال ایمن ایجنت‌های هوش مصنوعی (Google Antigravity, Claude, Cursor, Windsurf) به ابزارهای جانبی است.

---

## 🗄️ سرورهای MCP از پیش تنظیم‌شده:

1. **PostgreSQL MCP (`@modelcontextprotocol/server-postgres`)**:
   * مشاهده ساختار جداول (Schema)، ایندکس‌ها و اجرای امن `EXPLAIN ANALYZE` بدون حدس زدن.
2. **SQLite MCP (`@modelcontextprotocol/server-sqlite`)**:
   * اتصال مستقیم به فایل دیتابیس محلی برای پروژه‌های کاتلین، فلاتر و دات‌نت.
3. **Docker MCP (`mcp-server-docker`)**:
   * بررسی وضعیت کانتینرها، سرویس‌های داکر کامپوز و خواندن لاگ‌ها برای دیباگ سریع.
4. **GitHub MCP (`@modelcontextprotocol/server-github`)**:
   * بررسی ایشیوها، PRها و کامیت‌ها به صورت استاندارد.
5. **Fetch MCP (`@modelcontextprotocol/server-fetch`)**:
   * جستجو و خواندن آخرین داکیومنت‌های رسمی لایبرری‌ها.
6. **Memory Graph MCP (`@modelcontextprotocol/server-memory`)**:
   * ذخیره گراف دانش پروژه در سشن‌های طولانی.

---

## 🚀 نحوه استفاده در ابزارهای مختلف:

* **در Google Antigravity**: فایل `.agents/mcp_config.json` به طور خودکار شناسایی می‌شود.
* **در Claude Desktop**: `core/mcp/mcp_config.json` الگوی تنظیمات سرورهاست. تنظیمات را طبق راهنمای نسخهٔ نصب‌شدهٔ Claude Desktop اعمال کنید.
* **در Claude Code**: تنظیمات MCP را طبق راهنمای همان میزبان انجام دهید. این سند مسیر یا روش تنظیم دستی یکسانی برای Claude Desktop و Claude Code تأیید نمی‌کند.
* **در Cursor / Windsurf**: فایل `core/mcp/cursor_mcp.json` را در مسیر `.cursor/mcp.json` کپی کنید.
