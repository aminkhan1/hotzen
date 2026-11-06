# Production-Safe Git Checkpoint & Rollback Engine Specification

این سند مشخصات فنی «موتور ایمن و ایزوله‌شده عقب‌گرد گیت (Production-Safe Git Checkpoint & Rollback Engine)» را تعریف می‌کند تا از تخریب ناخواسته کدهای دست‌نوشته کاربر یا تغییرات خارج از نطاق تسک (Working Tree Changes) کاملاً جلوگیری شود.

---

## 🚫 ۱. ممنوعیت دستورات تخریبی همه‌جانبه (Banned Destructive Commands)

اجرای دستورات زیر توسط ایجنت‌ها **اکیداً ممنوع** است زیرا تغییرات working tree کاربر را نابود می‌سازد:
- ❌ `git checkout -- .` (پاک کردن کل تغییرات workspace)
- ❌ `git reset --hard` (حذف ناگهانی commitها و تغییرات)
- ❌ `git clean -fd` (حذف تخریبی فایل‌های جدید کاربر)

---

## 🛡 ۲. چرخه ایزوله‌شده عقب‌گرد چکمپوینتی (Safe Checkpoint & Rollback Protocol)

```text
===================================================================================================================
                               PRODUCTION-SAFE GIT ROLLBACK PROTOCOL
===================================================================================================================

[STEP 1: TASK START & INSPECT GIT STATE]
- در شروع تسک (وضعیت RECEIVED): ایجنت مدیر وضعیت گیت را برحص بررسی می‌کند (git status --porcelain).

[STEP 2: CREATE AGENT CHECKPOINT]
- یک Checkpoint ایزوله اختصاصی ایجاد می‌شود:
  git stash create ➔ دریافت HASH اختصاصی Checkpoint شروع تسک (مثلاً HASH: 8f3a12b)

[STEP 3: AGENT EXECUTION & SCOPED EDITS]
- ایجنت کدرها فایل‌های مشخص‌شده در task.json را ویرایش می‌کنند (مثلاً فقط 2 فایل).

[STEP 4: FAILURE × 3 TRIGGER]
- در صورت 3 بار شکست متوالی در مرحله FIXING:
  عقب‌گرد انحصاری فقط و فقط روی فایل‌های ویرایش‌شده توسط ایجنت (Agent-Modified Files Only) اجرا می‌شود:
  
  git checkout <AGENT_CHECKPOINT_HASH> -- <file1> <file2>

[STEP 5: PRESERVATION OF USER WORK]
- کدهای اولیه کاربر، فایل‌های دست‌نوشته غیرمرتبط و تغییرات قبلی working tree ۱۰۰٪ دست‌نخورده باقی می‌مانند.
===================================================================================================================
```

---

## 📝 3. ثبت لاگ عقب‌گرد در دایرکتوری تسک

پس از بازگرداندن فایل‌های ایجنت به Checkpoint HASH، مراتب در فایل `.agents/tasks/<TASK_ID>/verification/rollback.log` ثبت شده و تسک با حفظ سلامت کدهای کاربر به حالت `FAILED` منتقل می‌شود.
