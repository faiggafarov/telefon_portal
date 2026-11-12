const nodemailer = require('nodemailer');

// Create transporter from environment variables, or log mode if not configured
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  }
  return null;
}

/**
 * Send meeting invitation email to participants
 * @param {Object} meetingData { title, organizer, dept_name, meeting_date, start_time, end_time, description, participants }
 * @param {boolean} isReminder true if this is a 1-hour-prior reminder
 */
async function sendMeetingNotification(meetingData, isReminder = false) {
  const { title, organizer, dept_name, meeting_date, start_time, end_time, description, participants } = meetingData;

  const validParticipants = (Array.isArray(participants) ? participants : [])
    .filter(p => p && p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim()));

  if (validParticipants.length === 0) {
    return { sent: 0, reason: 'No valid participant emails' };
  }

  const dateFormatted = typeof meeting_date === 'string' ? meeting_date.split('T')[0] : new Date(meeting_date).toISOString().split('T')[0];
  const startFmt = (start_time || '').slice(0, 5);
  const endFmt = (end_time || '').slice(0, 5);

  const subjectPrefix = isReminder ? '⏰ [XATIRLATMA - 1 SAAT QALDI]' : '📅 [YENİ İCLAS DƏVƏTİ]';
  const subject = `${subjectPrefix} ${title} - ${dateFormatted} ${startFmt}`;

  const transporter = getTransporter();
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@telefonportal.az';

  const results = [];

  for (const p of validParticipants) {
    const toEmail = p.email.trim();
    const pName = p.name || toEmail;

    const htmlContent = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <div style="background: ${isReminder ? '#EA580C' : '#2563EB'}; padding: 24px 30px; color: #ffffff;">
          <h2 style="margin: 0; font-size: 20px; font-weight: 700;">
            ${isReminder ? '⏰ İclas Xatırlatması (1 Saat Qaldı)' : '📅 İclas Dəvəti'}
          </h2>
          <p style="margin: 6px 0 0; font-size: 13px; opacity: 0.9;">
            Kadastr və Yerquruluşu Layihə-Tədqiqat Mərkəzi — İclas Otağı
          </p>
        </div>

        <div style="padding: 26px 30px; color: #1E293B; line-height: 1.6;">
          <p style="font-size: 15px; margin-top: 0;">Hörmətli <strong>${pName}</strong>,</p>
          <p style="font-size: 14px; color: #334155;">
            ${isReminder 
              ? `Təyin olunmuş aşağıdakı iclasın başlamasına <strong>1 saat</strong> qalmışdır:` 
              : `Aşağıdakı məlumatlara uyğun olaraq yeni bir iclas təyin edilmiş və siz iştirakçı qismində dəvət olunmusunuz:`}
          </p>

          <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-left: 4px solid ${isReminder ? '#EA580C' : '#2563EB'}; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
            <div style="margin-bottom: 10px;">
              <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748B; display: block;">İclasın Mövzusu</span>
              <span style="font-size: 16px; font-weight: 700; color: #0F172A;">${title}</span>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
              <div>
                <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748B; display: block;">Tarix</span>
                <span style="font-size: 14px; font-weight: 600; color: #1E293B;">🗓️ ${dateFormatted}</span>
              </div>
              <div>
                <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748B; display: block;">Saat</span>
                <span style="font-size: 14px; font-weight: 600; color: #1E293B;">🕒 ${startFmt} – ${endFmt}</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div>
                <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748B; display: block;">Təşkilatçı</span>
                <span style="font-size: 14px; color: #1E293B;">👤 ${organizer}</span>
              </div>
              <div>
                <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748B; display: block;">Aid Olduğu Şöbə</span>
                <span style="font-size: 14px; color: #1E293B;">🏢 ${dept_name || '—'}</span>
              </div>
            </div>

            ${description ? `
              <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #CBD5E1;">
                <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748B; display: block;">Əlavə Qeyd</span>
                <span style="font-size: 13px; color: #475569; font-style: italic;">${description}</span>
              </div>
            ` : ''}
          </div>

          <p style="font-size: 13px; color: #64748B; margin-bottom: 0;">
            Zəhmət olmasa təyin olunmuş vaxtda iclas zalında olmağınız xahiş olunur.
          </p>
        </div>

        <div style="background: #F1F5F9; padding: 14px 30px; text-align: center; font-size: 12px; color: #64748B; border-top: 1px solid #E2E8F0;">
          Bu bildiriş avtomatik olaraq Telefon Portalı sistemi tərəfindən göndərilmişdir.
        </div>
      </div>
    `;

    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"Telefon Portalı" <${fromAddress}>`,
          to: toEmail,
          subject,
          html: htmlContent
        });
        results.push({ email: toEmail, status: 'sent' });
        console.log(`[MAIL] Sent notification to ${toEmail} for meeting "${title}" (reminder: ${isReminder})`);
      } catch (err) {
        console.error(`[MAIL ERROR] Failed to send to ${toEmail}:`, err.message);
        results.push({ email: toEmail, status: 'failed', error: err.message });
      }
    } else {
      // SMTP not configured, log simulated mail delivery
      console.log(`[MAIL SIMULATION] Transporter not configured. Would send to ${toEmail}: "${subject}"`);
      results.push({ email: toEmail, status: 'simulated' });
    }
  }

  return { sent: results.filter(r => r.status === 'sent' || r.status === 'simulated').length, results };
}

module.exports = {
  sendMeetingNotification
};
