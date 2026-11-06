# Flutter Clean Architecture - AGENTS Guidelines & Context

این فایل به‌عنوان مرجع متمرکز پروژه برای تمامی ایجنت‌ها و ماژول‌های هوش مصنوعی قرار دارد تا ساختار پروژه، استانداردهای کدنویسی، نقش ایجنت‌ها و چرخه توسعه (Agent Loop) همیشه به صورت شفاف و پایدار محفوظ بماند.

> 🏛️ **اصل حاکمیت معماری و ساختار پروژه (Authoritative Project Architecture Invariant):**  
> *"The installed project's existing architecture, dependencies, naming and implementation patterns are authoritative. Core must not infer that an optional technology/example is installed or required."*  
> معماری، پکیج‌ها، الگوهای نام‌گذاری و نحوه پیاده‌سازی موجود در پروژه همواره مرجع قطعی و دارای اولویت مطلق هستند. ذکر نام فناوری‌ها (نظیر Bloc، Riverpod، Provider، GetX، Dio، SourceProvider/ApiCall، Hive، Drift، Sqflite، GetStorage، SharedPreferences) در این سند یا اسکیل‌ها صرفاً به عنوان الگوهای مرجع و دانش اختیاری است و هرگز نباید به عنوان ساختار اجباری پروژه تلقی شود.

---

## 🎯 قوانین طلایی و تغییرناپذیر پروژه (Mandatory System Rules)

1. **مدیریت وضعیت (State Management)**: ایجنت موظف است پیش از پیاده‌سازی، راه‌حل مدیریت وضعیت تثبیت‌شده در پروژه (مانند `Bloc`, `Riverpod`, `Provider`, `GetX`, `MobX`, `Signals`) را از روی `pubspec.yaml` و سورس کد شناسایی کرده و ۱۰۰٪ با آن تطبیق یابد. در پروژه‌های جدید فاقد استیت‌منیجر، الگوی `Bloc<Event, State>` به عنوان استاندارد پیشنهادی است؛ اما تحمیل یا تغییر پکیج استیت‌منیجر در پروژه‌های موجود اکیداً ممنوع است.
2. **معماری کلین (Clean Architecture)**: تفکیک منطقی لایه‌ها متناسب با ساختار مستقر در پروژه:
   - `domain`: تعاریف Entities، UseCases و Repository Interfaces.
   - `data`: تعاریف DataSources، Models (JSON) و Repository Implementations.
   - `presentation`: شامل Blocs/Controllers/ViewModels متناسب با استیت‌منیجر پروژه، Pages و Widgets.
3. **اصول SOLID & Abstraction**:
   - عدم وابستگی لایه‌ها به پیاده‌سازی‌های مستقیم.
   - استفاده از اینترفیس‌ها و کلاس‌های انتزاعی برای همه Repositories و DataSources (Remote / Local).
4. **تزریق وابستگی (Dependency Injection)**:
   - تبعیت کامل از الگوی تزریق وابستگی موجود در پروژه (`get_it`, `injectable`, `provider`, `riverpod` یا ساختار داخلی پروژه). معرفی پکیج DI جدید به پروژه‌های موجود بدون هماهنگی ممنوع است.
5. **تست‌گرایی تطبیقی پیش از تحویل (Adaptive Pre-Delivery Testing)**:
   - برای لاجیک کسب‌وکار و لایه‌های تغییریافته، تست‌های یونیت متناسب با زیرساخت تست پروژه نوشته شود.
   - نگارش Widget Test در صورتی الزامی است که زیرساخت تست ویجت در پروژه از قبل فعال باشد.
   - اعتبارسنجی هدفمند (`targeted verification`): قبل از تحویل، تغییرات با تحلیل‌گر استاتیک (`flutter analyze` یا `dart analyze`) و تست‌های ماژول‌های متأثر بدون خطای جدید پاس شوند.
6. **ایزوله‌سازی کد و حریم فیچرها**:
   - بدون اجازه کاربر، دست زدن به فایل‌های غیرمرتبط با فیچر جاری ممنوع است.
7. **طراحی UI متمرکز و ریسپانسیو**:
   - انطباق با سیستم تم و Design Tokens موجود پروژه (`ThemeData`، کلاس‌های تم یا کدهای طراحی پروژه).
   - صفحات UI تا حد امکان Stateless باشند و هیچ لاجیک کسب‌وکاری مستقیم در صفحات قرار نگیرد.
   - استفاده از Breakpointها و `LayoutBuilder` برای تضمین کامل Responsive بودن در دسکتاپ و موبایل.
8. **مسیریابی و شبکه**:
   - تبعیت کامل از معماری شبکه و کلاینت موجود در پروژه (مانند `SourceProvider + ApiCall`، `dio`، `http` یا کلاینت‌های اختصاصی).
   - تبعیت از مکانیزم مسیریابی موجود در پروژه (مانند `go_router`, `auto_route` یا Navigator بومی).
   - پکیج‌ها و مثال‌های ذکرشده در اسکیل‌ها (مانند Dio، SourceProvider یا GoRouter) صرفاً جنبه الگوی مرجع دارند و نباید به پروژه‌ای که از راهکار دیگری استفاده می‌کند تحمیل شوند.
9. ⚡ **اجرای هدفمند و اختصاصی ایجنت‌ها (Targeted & Selective Execution)**:
   - هر ایجنت و اسکیل فقط و فقط در زمان خاص مربوط به وظایف خود اجرا می‌شود.
   - اگر کاربر درخواستی مربوط به برنامه‌ریزی داد 👈 **تنها ایجنت پلنر** فعال می‌شود.
   - اگر کاربر درخواستی مربوط به لایه UI/فلاتر داد 👈 **تنها ایجنت فلاتر** فعال می‌شود.
   - اگر درخواستی مربوط به دیتابیس یا بک‌اند بود 👈 **فقط ایجنت تخصصی دیتابیس یا دارت** فعال می‌شود.
10. 🧠 **فهم عمیق کانتکست (Context Awareness)**:
    - تحلیل فایل‌های باز، کرسر، معماری Core، وابستگی‌های DI و الگوهای موجود قبل از هرگونه تغییر کد.
    - جزئیات کامل در [.agents/rules/context_awareness.md](.agents/rules/context_awareness.md) موجود است.
11. 🔍 **فهم و اکتشاف کامل کدبیس (Codebase Understanding)**:
    - بررسی ساختار کلی پروژه، ردیابی نمادها و جلوگیری از ایجاد کدها یا مدل‌های تکراری قبل از کدنویسی.
    - جزئیات کامل در [.agents/rules/codebase_understanding.md](.agents/rules/codebase_understanding.md) موجود است.
12. 📜 **سیستم حافظه ۴گانه ایجنت‌ها (Quad-Memory System)**:
    - تفکیک دقیق ۴ نوع حافظه در [.agents/memory/](.agents/memory/): شامل `Working Memory` (استدلال و استیت تسک)، `Session Memory` (لاگ سشن فعلی)، `Project Memory` (معماری و الگوها) و `Decision Memory` (ثبت دائمی ADRها، چرایی تصمیمات و شرط `Do Not Change Unless`).
    - جزئیات کامل در [.agents/rules/quad_memory_system.md](.agents/rules/quad_memory_system.md) موجود است.
13. 🔄 **خط لوله مولتی‌ایجنت و حلقه رد/تایید مدیر (Multi-Agent Pipeline & Manager Review Loop)**:
    - جریان ترتیبی: **تعریف تسک توسط مدیر** ⬅️ **برنامه‌نویسی توسط کدرها** ⬅️ **نقد توسط منتقد** ⬅️ **تست توسط تستر** ⬅️ **نقد و ارزیابی مدیر**.
    - جزئیات کامل در [.agents/rules/multi_agent_pipeline.md](.agents/rules/multi_agent_pipeline.md) موجود است.
14. 📉 **فشرده‌سازی کانتکست و تفکیک Stable vs Dynamic Context**:
    - تفکیک کانتکست ثابت (فریم‌ورک، قوانین، معماری) از کانتکست پویا (تسک، فایل‌های درگیر، خطاهای زمان اجرا، تست‌ها و دیف) و به‌روزرسانی انحصاری Dynamic Context در هر گام جهت صرفه‌جویی حداکثری در توکن‌ها.
    - جزئیات کامل در [.agents/rules/context_compression.md](.agents/rules/context_compression.md) موجود است.
15. 📊 **ماشین حالت ۱۳ گانه تسک‌ها (Task State Machine: 10 Primary + 3 Recovery)**:
    - هدایت تسک بر اساس ۱۰ وضعیت اصلی مسیر موفق (`RECEIVED` ➔ `UNDERSTANDING` ➔ `EXPLORING` ➔ `PLANNING` ➔ `PLAN_VALIDATION` ➔ `IMPLEMENTING` ➔ `INTEGRATION` ➔ `TESTING` ➔ `REVIEW` ➔ `DONE`) و ۳ وضعیت بازیافت خطا (`FAILED` ➔ `DIAGNOSING` ➔ `FIXING`).
    - جزئیات کامل در [.agents/rules/agent_state_machine.md](.agents/rules/agent_state_machine.md) موجود است.
16. ⚡ **موتور هوشمند کانتکست و بودجه‌بندی اولویت‌محور (Context Budget & Priority Pruning)**:
    - تحلیل ۱۱ بعد کانتکست و مدیریت بودجه توکن (Token Budget) بر پایه ماتریکس اولویت (Priority 100 تا Priority 20)؛ در صورت تجاوز از بودجه توکن، کانتکست‌های کم‌اولویت به صورت خودمختار هرس (Prune) می‌شوند.
    - جزئیات کامل در [.agents/rules/context_engine.md](.agents/rules/context_engine.md) موجود است.
17. 🔄 **حلقه دینامیک و تکاملی کانتکست همراه با شرط توقف (Context Loop & Stop Conditions)**:
    - کانتکست ایجنت‌ها ثابت نیست؛ ایجنت‌ها بر اساس الگوی `Context ➔ Reason ➔ Discover ➔ Context Update ➔ Reason` به صورت پویا کانتکست را گسترش داده و با وقوع شروط ۴ گانه (`No unresolved dependency` | `No decision change` | `Acceptance criteria supported` | `Context budget reached`) حلقه را متوقف می‌کنند.
    - جزئیات کامل در [.agents/rules/context_loop.md](.agents/rules/context_loop.md) موجود است.
18. 🕸 **گراف نمادها و تحلیل اثرات تغییرات (Dependency / Symbol Graph & Impact Analysis)**:
    - قبل از ویرایش هر نماد/کلاس، گراف وابستگی‌های عمودی بالا به پایین ترسیم شده و تمام قطعات بالقوه متأثر (Potentially Affected Components) شناسایی و سطح ریسک سنجیده می‌شود.
    - جزئیات کامل در [.agents/rules/dependency_symbol_graph.md](.agents/rules/dependency_symbol_graph.md) موجود است.
19. 🛡 **تحلیل‌گر اثرات و نمره‌دهنده ریسک تغییرات (Change Impact & Risk Score Engine)**:
    - قبل از هر تغییر باارزش، پاسخ صریح به ۵ سوال حیاتی استخراج شده و نمره عددی ریسک (Risk Score) محاسبه می‌شود تا سطح ریسک (🟢 LOW / 🟡 MEDIUM / 🟠 HIGH / 🔴 CRITICAL) و عمق آداپتیو خط لوله تعیین گردد.
    - جزئیات کامل در [.agents/rules/change_impact_analyzer.md](.agents/rules/change_impact_analyzer.md) موجود است.
20. ⚙️ **تفکیک سیستم موتور اعتبارسنجی از ایجنت تستر (Verification Engine vs QA Agent)**:
    - **QA Agent**: مسئول تحلیل نیازهای کیفی، سناریونویسی و نگارش کدهای تست.
    - **Verification Engine**: زیرساخت اجرایی خودمختار شامل `dart format` ،`flutter analyze` ،`flutter test` ،`targeted tests` ،`build verification` و `git diff verification`.
    - جزئیات کامل در [.agents/rules/verification_engine.md](.agents/rules/verification_engine.md) موجود است.
21. 🧐 **لایه منتقد ارشد کد (Senior Code Critic Layer)**:
    - ممیزی کیفی و چالش‌گرایانه کدها توسط منتقد ارشد بلافاصله پس از پیاده‌سازی (`Developer ➔ Critic`) بر اساس ۶ سوال انتقادی (حل واقعی نیازمندی، عدم وجود ابستراکشن اضافه، سادگی راهکار، عوارض جانبی پنهان).
    - جزئیات کامل در [.agents/rules/critic_layer.md](.agents/rules/critic_layer.md) موجود است.
22. 📦 **پروتکل تحویل جهت‌دار در ساختار دایرکتوری مجزا (Task Directory Directed Handoff Architecture)**:
    - جهت جلوگیری از Race Condition در اجرای موازی ایجنت‌ها، تمامی تحویل‌ها انحصاراتً بر پایه دایرکتوری مجزای تسک `.agents/tasks/<TASK_ID>/` و فایل‌های تحویل جهت‌دار در پوشه `handoffs/<from>-to-<to>.json` ثبت می‌شوند.
    - جزئیات کامل در [.agents/rules/agent_handoff_protocol.md](.agents/rules/agent_handoff_protocol.md) موجود است.
23. 📝 **سیستم معیارها و چک‌لیست پذیرش (Acceptance Criteria Verification System)**:
    - تبدیل هر نیازمندی به یک چک‌لیست صریح و قابل تست `[ ]`؛ ایجنت مدیر تنها در صورت تایید موردموردی و دریافت تیک `[x]` برای تمام موارد اجازه ترانزیشن به وضعیت `DONE` را می‌دهد.
    - جزئیات کامل در [.agents/rules/acceptance_criteria_system.md](.agents/rules/acceptance_criteria_system.md) موجود است.
24. 🛡 **سیستم خودبازرسی اجباری ایجنت‌ها (Mandatory Agent Self-Check System)**:
    - قبل از اعلام وضعیت `DONE` یا تحویل به کاربر، چک‌لیست ۱۰ گانه خودبازرسی (فهم نیازمندی، معیارهای پذیرش، عدم تغییر فایل‌های ناخواسته، پاس شدن analyze و test، و بررسی گیت‌دیف) اجرا شده و در صورت شکست حتی یک مورد، وضعیت `DONE` مسدود می‌شود.
    - جزئیات کامل در [.agents/rules/agent_self_check.md](.agents/rules/agent_self_check.md) موجود است.
25. 🔍 **سیستم استدلال سطح‌بندی‌شده مستند به شواهد (3-Level Evidence System)**:
    - تمامی استدلال‌ها و تحلیل‌های ایجنت‌ها باید بر پایه ۳ سطح شواهد عینی (Level 1: Lightweight، Level 2: Trace، Level 3: Full Evidence) ارائه شوند؛ اظهارنظرهای متنی مبهم یا گمانه‌زنی («فکر می‌کنم...») اکیداً ممنوع است.
    - جزئیات کامل در [.agents/rules/evidence_system.md](.agents/rules/evidence_system.md) موجود است.
26. 🚦 **سیاست تایید انسانی و اعتبارسنجی سطح‌بندی‌شده طرح‌ها (Human Approval Policy & Plan Validation)**:
    - تایید طرح‌ها در مرحله `PLAN_VALIDATION` بر اساس ۳ سطح ریسک انجام می‌شود: Tier 1 (تغییرات جزیی ➔ خودمختار)، Tier 2 (فیچر جدید ➔ خودمختار + اطلاع‌رسانی)، Tier 3 (تغییرات کلان معماری ➔ لزوم تایید صریح کاربر).
    - جزئیات کامل در [.agents/rules/human_approval_policy.md](.agents/rules/human_approval_policy.md) موجود است.
27. ⚙️ **موتور سیاست‌های اجرا و ابزارهای مجاز (Execution Policy Engine)**:
    - تخصیص هوشمند ایجنت‌ها، ابزارها و سطح اعتبارسنجی بر اساس ۵ نوع تغییر (Change Type 1 تا 5)؛ جلوگیری از اجرای تست‌های سنگین یا اسکن کامل پروژه برای ویرایش‌های جزیی یا محلی.
    - جزئیات کامل در [.agents/rules/execution_policy_engine.md](.agents/rules/execution_policy_engine.md) موجود است.
28. 📊 **موتور متریک‌ها و پایش زمان/توکن (Telemetry & Token Metrics Engine)**:
    - ثبت و پایش زمان اجرای تسک‌ها و تخمین توکن‌های مصرفی در `.agents/memory/metrics.json` جهت ارزیابی راندمان سیستم.
    - جزئیات کامل در [.agents/rules/telemetry_metrics_engine.md](.agents/rules/telemetry_metrics_engine.md) موجود است.
29. 🔄 **موتور عقب‌گرد چکمپوینتی و ایمن گیت (Production-Safe Git Checkpoint Engine)**:
    - ایجاد Checkpoint HASH ایزوله در شروع تسک با `git stash create`. در صورت ۳ بار شکست متوالی ریکاوری، عقب‌گرد انحصاراتً روی فایل‌های ویرایش‌شده توسط ایجنت (`git checkout <CHECKPOINT_HASH> -- <agent_files>`) بدون دستکاری کدهای اولیه و working tree کاربر اجرا می‌شود. دستورات تخریبی همه‌جانبه (`git checkout -- .`, `git reset --hard`) اکیداً ممنوع هستند.
    - جزئیات کامل در [.agents/rules/git_rollback_engine.md](.agents/rules/git_rollback_engine.md) موجود است.
30. 🛠 **زیرساخت ماک‌سازی دیتابیس و ذخیره‌سازی محلی (Database & Persistence Mock Infrastructure)**:
    - ایجاد ماک‌ها و فیک‌های مورد نیاز برای لایه‌های ذخیره‌سازی محلی موجود پروژه (مانند `get_storage`, `shared_preferences`, `Hive`, `Drift`, `Sqflite`, `Isar`, `ObjectBox` یا کش اختصاصی) متناسب با کتابخانه‌های تست پروژه بدون فرض اجباری بودن هیچ‌یک از آن‌ها.
    - جزئیات کامل در [.agents/rules/database_mock_generator.md](.agents/rules/database_mock_generator.md) موجود است.
31. 🚦 **موتور مسیریابی تسک و گزینش ایجنت‌ها (Task Routing & Agent Selection Engine - MVT)**:
    - اجرای پایپ‌لاین ۶ مرحله‌ای پیش از هر تسک شامل تحلیل نیازمندی، محاسبه ریسک، دسته‌بندی تغییر و ارزیابی ماتریس ۱۲ بُعد اثرگذاری جهت گزینش **حداقل تیم لازم (Minimum Viable Team)** و ممانعت قاطع از فعال‌سازی کورکورانه تمام ایجنت‌ها.
    - جزئیات کامل در [.agents/rules/task_routing_engine.md](.agents/rules/task_routing_engine.md) موجود است.

---

## 👥 ساختار تیم ایجنت‌ها (Multi-Agent Team Structure)

پروژه توسط ۷ نقش تخصصی هدایت می‌شود:
- **Lead Agent (مدیر ارشد پروژه)**: مدیریت جریان کار، تحلیل کانتکست و کدبیس پروژه، حکمرانی سیستم حافظه ۴ گانه (Working, Session, Project, Decision)، پایش Telemetry Metrics، مدیریت ماشین حالت تسک‌ها و ماشه Git Auto-Rollback ایزوله، کنترل Context Engine و Budget Pruning، اجرای Execution Policy Engine، اجرای Human Approval Policy، اعتبارسنجی Evidence Chain و Acceptance Criteria Audit، اجرای چک‌لیست ۱۰ گانه Self-Check، ارزیابی خروجی زیرساخت Verification Engine، تایید/رد نهایی کدهای خروجی، فعال‌سازی هدفمند ایجنت‌ها و اعتبارسنجی قوانین.
- **Senior Planner Agent (معمار و پلنر ارشد)**: تحلیل نیازمندی‌های سیستم، ارائه زنجیره شواهد عینی (Evidence System)، برنامه‌ریزی لایه‌ای، سطح‌بندی ریسک (Risk Tier)، تعیین Change Type و Execution Policy، تدوین چک‌لیست‌های Acceptance Criteria، تولید Handoff Payloadهای ساختاریافته، اجرای Change Impact Analyzer و تدوین `implementation_plan.md`.
- **Senior Dart & Backend Developer Agent**: پیاده‌سازی منطق سیستم، کلاینت شبکه و لایه‌های Data و Domain متناسب با معماری شبکه موجود پروژه (مانند `SourceProvider + ApiCall`، `Dio`، `http` یا کلاینت اختصاصی).
- **Senior Database Developer Agent**: طراحی لایه‌های ذخیره‌سازی محلی و کشینگ هماهنگ با راه‌حل دیتابیس موجود پروژه (مانند `get_storage`، `shared_preferences`، `Hive`، `Drift`، `Sqflite` یا کش‌های سفارشی).
- **Senior Flutter Developer Agent**: پیاده‌سازی لایه Presentation، سیستم تم، مسیریابی و UIهای ریسپانسیو هماهنگ با پروژه.
- **Senior Code Critic Agent (منتقد ارشد کد)**: ممیزی کیفی کدهای تولیدشده توسط کدرها قبل از مرحله تست، جلوگیری از Over-Engineering و تضمین سادگی کد.
- **Senior QA Tester Agent**: تحلیل سناریوهای تست، ماک‌سازی لایه‌ها و نگارش Unit Testها متناسب با زیرساخت تستینگ و اینترفیس‌های موجود پروژه.

جزئیات کامل نقش‌ها در [.agents/rules/agent_roles.md](.agents/rules/agent_roles.md) موجود است.

---

## 🧠 اسکیل‌های ثبت‌شده پروژه (Available Skills)

1. **`lead-agent-manager`**: راهنمای تخصصی ایجنت لید برای نظارت، مدیریت همه‌جانبه ایجنت‌ها، اجرای Execution Policy Engine، پایش Telemetry و Git Auto-Rollback ایزوله، اعتبارسنجی زنجیره شواهد (Evidence System)، اجرای Human Approval Policy، اجرای چک‌لیست ۱۰ گانه Self-Check، حکمرانی سیستم حافظه ۴ گانه، ارزیابی Acceptance Criteria، مدیریت Context Engine، کنترل ماشین حالت، ارزیابی زیرساخت Verification Engine و اعتبارسنجی قوانین.
2. **`senior-planner`**: راهنمای تخصصی ایجنت پلنر برای تحلیل نیازمندی‌ها، تعیین Risk Tier و Execution Policy، ارائه زنجیره شواهد عینی (Evidence System)، ساخت چک‌لیست‌های Acceptance Criteria، تولید Handoff Payload ساختاریافته، ساخت طرح‌های پیاده‌سازی، تحلیل اثرات (Change Impact Analyzer) و ارزیابی ریسک‌های معماری.
3. **`senior-critic`**: راهنمای تخصصی منتقد ارشد کد برای ممیزی چالش‌گرایانه، جلوگیری از اور-انجینیرینگ و حفظ سادگی راهکار (KISS).
4. **`dart-backend-developer`**: راهنمای تخصصی طراحی Core، لایه‌های Domain/Data، شبکه (متناسب با معماری پروژه)، مدل‌سازی و DI.
5. **`senior-database-developer`**: راهنمای تخصصی طراحی Local DataSources و ذخیره‌سازی محلی (متناسب با پروژه)، کشینگ و همگام‌سازی آفلاین.
6. **`flutter-clean-architecture`**: راهنمای پیاده‌سازی لایه‌ها متناسب با استیت‌منیجر و ساختار پروژه.
7. **`flutter-qa-testing`**: راهنمای نگارش سناریوهای تست Unit و Widget متناسب با زیرساخت تستینگ پروژه پیش از تحویل به Verification Engine.

---

## 🔄 چرخه‌ی کاری ایجنت‌ها (Agent Loop Workflow)

هر فیچر بر اساس ماشین حالت ۱۳ گانه (۱۰ Primary + ۳ Recovery)، Execution Policy Engine، Human Approval Policy، Evidence System، Quad-Memory System، Self-Check Checklist و Verification Engine پیاده‌سازی می‌شود:
`RECEIVED/UNDERSTANDING` ⬅️ `EXPLORING/PLANNING` ⬅️ `PLAN_VALIDATION (Tier 1/2/3)` ⬅️ `IMPLEMENTING (Coder ➔ Critic)` ⬅️ `TESTING/REVIEW/DONE`

جزئیات چرخه در [.agents/rules/agent_loop_workflow.md](.agents/rules/agent_loop_workflow.md) ذخیره شده است.
