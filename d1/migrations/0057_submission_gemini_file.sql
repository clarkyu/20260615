-- 复用 Gemini File API 文件句柄:某次感知上传成功、但就绪轮询(60s)到点时文件仍在 PROCESSING,
-- 记下句柄,耐久队列重试就复用同一份文件(轮询它、不重传、不重启 Gemini 摄取计时),让摄取
-- 慢的大视频最终评出而非进死信。not-ready 失败时写,定稿后清;geminiFileAt 守卫过期(文件约 48h 失效)。
-- 三条可空加列,幂等重跑安全。
ALTER TABLE "Submission" ADD COLUMN "geminiFileUri" TEXT;
ALTER TABLE "Submission" ADD COLUMN "geminiFileName" TEXT;
ALTER TABLE "Submission" ADD COLUMN "geminiFileAt" DATETIME;
