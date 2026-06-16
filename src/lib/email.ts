// Email via the Resend HTTP API (SMTP/nodemailer can't run on Workers).
// Configure RESEND_API_KEY and EMAIL_FROM.

import { config } from '@/lib/config'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

function appName(): string {
  return config.appName()
}

function fromAddress(): string {
  return config.email().from
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function send(to: string, subject: string, html: string, text: string): Promise<void> {
  const key = config.email().apiKey
  if (!key) throw new Error('RESEND_API_KEY is not configured')
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddress(), to, subject, html, text }),
  })
  if (!res.ok) {
    throw new Error(`Resend failed: ${res.status} ${await res.text()}`)
  }
}

function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
      <tr><td style="padding:32px;">
        <p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#111827;">${escapeHtml(appName())}</p>
        ${bodyHtml}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

function button(url: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr><td>
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#111827;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">${escapeHtml(label)}</a>
  </td></tr></table>`
}

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  const html = layout(
    `验证你的${appName()}邮箱`,
    `<p style="margin:0 0 8px;font-size:15px;color:#374151;">确认此邮箱以激活账号。</p>
     ${button(verifyUrl, '验证邮箱')}
     <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">或复制链接到浏览器打开：</p>
     <p style="margin:0 0 16px;font-size:13px;word-break:break-all;"><a href="${escapeHtml(verifyUrl)}" style="color:#2563eb;">${escapeHtml(verifyUrl)}</a></p>
     <p style="margin:0;font-size:12px;color:#9ca3af;">链接 24 小时内有效。若非你本人操作，请忽略。</p>`,
  )
  await send(to, `验证你的${appName()}邮箱`, html, `验证你的${appName()}邮箱：\n\n${verifyUrl}\n\n链接 24 小时内有效。`)
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const html = layout(
    `重置你的${appName()}密码`,
    `<p style="margin:0 0 8px;font-size:15px;color:#374151;">点击下面按钮设置新密码。</p>
     ${button(resetUrl, '重置密码')}
     <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">或复制链接到浏览器打开：</p>
     <p style="margin:0 0 16px;font-size:13px;word-break:break-all;"><a href="${escapeHtml(resetUrl)}" style="color:#2563eb;">${escapeHtml(resetUrl)}</a></p>
     <p style="margin:0;font-size:12px;color:#9ca3af;">链接 1 小时内有效。若非你本人操作，请忽略。</p>`,
  )
  await send(to, `重置你的${appName()}密码`, html, `重置你的${appName()}密码：\n\n${resetUrl}\n\n链接 1 小时内有效。`)
}
