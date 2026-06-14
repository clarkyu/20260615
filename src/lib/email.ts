import nodemailer from 'nodemailer'

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function appName(): string {
  return process.env.APP_NAME || 'App'
}

function createTransporter() {
  const host = getRequiredEnv('SMTP_HOST')
  const port = Number(process.env.SMTP_PORT ?? '465')
  const user = getRequiredEnv('SMTP_USER')
  const pass = getRequiredEnv('SMTP_PASSWORD')

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
  })
}

function getFromAddress(): string {
  return process.env.SMTP_FROM ?? getRequiredEnv('SMTP_USER')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
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
    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">${escapeHtml(appName())}</p>
  </td></tr>
</table>
</body>
</html>`
}

function button(url: string, text: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr><td>
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#111827;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">${escapeHtml(text)}</a>
  </td></tr></table>`
}

export async function sendVerificationEmail(to: string, verifyUrl: string) {
  const transporter = createTransporter()
  const html = layout(
    `Verify your ${appName()} email`,
    `<p style="margin:0 0 8px;font-size:15px;color:#374151;">Confirm this email address to activate your account.</p>
     ${button(verifyUrl, 'Verify email')}
     <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Or paste this link into your browser:</p>
     <p style="margin:0 0 16px;font-size:13px;word-break:break-all;"><a href="${escapeHtml(verifyUrl)}" style="color:#2563eb;">${escapeHtml(verifyUrl)}</a></p>
     <p style="margin:0;font-size:12px;color:#9ca3af;">This link expires in 24 hours. If you did not create an account, you can ignore this email.</p>`,
  )
  await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject: `Verify your ${appName()} email`,
    text: `Confirm your email address to activate your ${appName()} account:\n\n${verifyUrl}\n\nThis link expires in 24 hours. If you did not create an account, you can ignore this email.`,
    html,
  })
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const transporter = createTransporter()
  const html = layout(
    `Reset your ${appName()} password`,
    `<p style="margin:0 0 8px;font-size:15px;color:#374151;">Use the button below to choose a new password.</p>
     ${button(resetUrl, 'Reset password')}
     <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Or paste this link into your browser:</p>
     <p style="margin:0 0 16px;font-size:13px;word-break:break-all;"><a href="${escapeHtml(resetUrl)}" style="color:#2563eb;">${escapeHtml(resetUrl)}</a></p>
     <p style="margin:0;font-size:12px;color:#9ca3af;">This link expires in 1 hour. If you did not request it, you can ignore this email.</p>`,
  )
  await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject: `Reset your ${appName()} password`,
    text: `Use this link to reset your ${appName()} password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you did not request it, you can ignore this email.`,
    html,
  })
}
