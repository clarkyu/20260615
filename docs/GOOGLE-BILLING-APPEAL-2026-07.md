# Google Cloud 费用申诉邮件(Gemini API $768,2026-07 成本危机)

> 背景见 `docs/GRADING-BACKLOG-2026-07.md` §八:用量**真实**(期末考核几千份视频评阅),
> 故定位是 **goodwill credit(善意减免)**,不是「账单有误」。**绝不 chargeback**(封号风险)。
> 发送与否、金额主张(单日尖峰 ~$500 优先,成功率高;或全额 $768)由 clark 决定。

## 提交入口

- **Cloud Billing 免费支持表单**(无需付费支持计划):
  https://support.google.com/cloud/contact/cloud_platform_billing
- 或 **控制台开 case**:https://console.cloud.google.com/support/cases/create
  (类别选 Billing;右上先选中对应项目)

## 邮件正文(英文,方括号处填实际信息)

Subject: Request for one-time courtesy credit — unexpected Gemini API cost spike from a misconfigured batch job (Billing Account [XXXXXX-XXXXXX-XXXXXX])

Hello Google Cloud Billing Support,

I am writing to request a one-time courtesy credit on my recent Gemini API charges of approximately **$768** (Billing Account [ID], Project [project-id], billing period [June–July 2026]).

Context: I am a university teacher running a small homework app that uses the Gemini API to grade students' recorded recitation videos. During our final-exam week ([around July 5–7, 2026]), a batch grading job was misconfigured on our side: it used a higher-priced model than intended (Gemini 3.5 Flash instead of the cheaper Flash preview model) for full-length video perception, and retried aggressively during a rate-limit storm. Roughly **$500 of the total accrued in a single day** before we noticed — far beyond our normal spend of a few dollars per day.

I want to be clear that I am not disputing the validity of the charges — the successful API calls were real and the metering appears accurate. This is a request for goodwill relief for a one-time mistake by a small education user.

Since then we have put real safeguards in place so this cannot recur:

1. A hard spending cap of **$555** configured in the Cloud console;
2. An application-level daily spend circuit-breaker (default **$50/day**) that pauses all background grading when reached;
3. Switched the default video-perception model to the lower-priced Flash preview tier (~3× cheaper);
4. Append-only usage accounting in our app so spend is visible in near-real-time.

Given the educational nature of the project and the one-time character of the spike, would you consider a partial or full courtesy credit for the [single-day spike portion (~$500) / full amount]? Any relief would be greatly appreciated and would go directly to keeping this free student-facing tool running.

Thank you for your time and consideration.

Best regards,
[姓名] / [学校名] / [联系邮箱]

## 要点备忘

1. 金额策略:主张**单日尖峰 ~$500** 成功率更高;要争取全额就把方括号句改成 full amount。
2. 绝不提 chargeback、绝不说「计费有误」——AiUsageLog 已印证成功调用是真实用量、
   失败调用(429/400)本就不计费,谎称有误查实后有封号风险。
3. 提交后一般 1-2 个工作日回复;若被拒可回信补充教育用途 + 已落地护栏,请求部分减免。
