# Telemetry & Token Metrics Engine Specification

این سند مشخصات فنی «موتور متریک‌ها و پایش زمان/توکن (Telemetry & Token Metrics Engine)» را تعریف می‌کند تا تمام تسک‌ها، زمان اجرای هر گام، تخمین مصرف توکن و کارایی ایجنت‌ها به صورت شفاف در فایل `.agents/memory/metrics.json` ثبت و تحلیل گردند.

---

## 📊 ۱. ساختار استاندارد فایل متریک‌ها (`.agents/memory/metrics.json`)

```json
{
  "total_tasks_executed": 1,
  "total_estimated_tokens": 14500,
  "average_task_latency_ms": 1250,
  "metrics_history": [
    {
      "task_id": "INIT-001",
      "agent_role": "lead_agent_manager",
      "task_state": "DONE",
      "change_type": 5,
      "risk_tier": "Tier 3",
      "risk_score": 85,
      "execution_time_ms": 1250,
      "estimated_tokens_used": 14500,
      "pruned_items_count": 2,
      "timestamp": "2026-08-23T07:04:00Z"
    }
  ]
}
```

---

## ⚡ ۲. قوانین پایش متریک‌ها (Telemetry Logging Rules)

1. **ثبت پس از هر گام مهم (Post-State Metrics Logging)**:
   - پس از خروج از وضعیت‌های `IMPLEMENTING` ،`TESTING` یا `REVIEW`، ایجنت مدیر فیلدهای زمان اجرا و توکن تخمینی را در `metrics.json` بروزرسانی می‌کند.
2. **پایش کارایی ایجنت‌ها (Performance Audit)**:
   - ایجنت مدیر با تحلیل متریک‌ها می‌تواند ایجنت‌هایی که کند عمل کرده یا مصرف توکن بالا داشته‌اند را شناسایی و الگوریتم فشرده‌سازی را تنظیم کند.
