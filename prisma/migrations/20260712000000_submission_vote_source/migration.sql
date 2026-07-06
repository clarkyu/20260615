-- 归票留痕:投票环节把一份作答归到某选项时,原始作答文本存这里(recitedText 被改写为
-- 选项原文以便计票)。可空:未被归票改写过的提交为 null。有它即可无损撤销归票。
ALTER TABLE "Submission" ADD COLUMN "voteSourceText" TEXT;
