# Dynamic Context Loop & Termination Criteria Specification

این سند مشخصات فنی «حلقه دینامیک کانتکست همراه با شرط توقف (Dynamic Context Loop & Stop Conditions)» را تعریف می‌کند تا از گسترش بی‌رویه کانتکست (Infinite Expansion Loop) جلوگیری شده و حلقه در لحظه مناسب به صورت خودمختار متوقف شود.

---

## 🔄 ۱. چرخه расширение و فیلتر ارتباط (Context Loop Decision Tree)

```text
================================================================================
                    DYNAMIC CONTEXT LOOP & RELEVANCE FILTER
================================================================================

Current Task
     │
     ▼
Gather Initial Context
     │
     ▼
Agent Reasoning
     │
     ▼
Discover New Information / Symbol
     │
     ▼
Is new information relevant to current task?
     ├── ❌ NO  ➔ Reject Expansion & Keep Context Stable
     └── ✅ YES ➔ Expand Context Graph
             │
             ▼
      Does new information change current decision / hypothesis?
             ├── ❌ NO  ➔ STOP CONTEXT LOOP (No further expansion needed)
             └── ✅ YES ➔ Reason Again & Update Plan
================================================================================
```

---

## 🛑 ۲. شروط ۴ گانه توقف اجباری (Stop Conditions)

حلقه گسترش کانتکست به محض برقرار بودن **حداقل یکی** از 4 شرط زیر به صورت فوری متوقف می‌شود:

1. **رفع کامل وابستگی‌ها (No Unresolved Dependency)**: تمامی کلاس‌ها، فایل‌ها و وابستگی‌های لازم برای انجام تسک به صورت کامل استخراج شده باشند.
2. **عدم تغییر در تصمیم (No Decision Impact)**: شواهد جدید کشف‌شده هیچ‌گونه تغییری در فرضیه حل مسئله یا تصمیم فعلی ایجاد نکنند.
3. **تکمیل پوشش معیارهای پذیرش (Acceptance Criteria Supported)**: کانتکست موجود برای اعتبارسنجی و اجرای تک‌تک معیارهای پذیرش صریح تسک کافی باشد.
4. **وصول به سقف بودجه کانتکست (Context Budget Limit Reached)**: حجم کانتکست به سقف بودجه توکن (Token Budget Limit) رسیده باشد.
