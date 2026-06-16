-- 三段式句子：在中心句(english/chinese)之外，补解释句与情境例句的中英字段。
ALTER TABLE "Chunk" ADD COLUMN "meaningEn" TEXT;
ALTER TABLE "Chunk" ADD COLUMN "meaningZh" TEXT;
ALTER TABLE "Chunk" ADD COLUMN "exampleEn" TEXT;
ALTER TABLE "Chunk" ADD COLUMN "exampleZh" TEXT;
