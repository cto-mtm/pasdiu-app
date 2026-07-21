"use strict";
// Invite-email renderer — pure function, no Firestore, no network.
//
// i18n note: functions can't use the app's vue-i18n modules, so this module
// carries its own tiny en+es dictionary. The strings deliberately MIRROR the
// app's tone and vocabulary (see app/src/i18n/locales/configs/roles.ts and
// locales/pages/team.ts) — if the app copy changes, update this dictionary in
// the same change. `en` is the source of truth; `es` is typed against it so
// the two locales cannot diverge (same convention as the app's modules).
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderInviteEmail = renderInviteEmail;
const en = {
    subject: "You're invited to {orgName} on Pasdiu",
    heading: "Join {orgName}",
    body: "You've been invited to join {orgName} on Pasdiu as {role}.",
    button: "Accept invite",
    linkFallback: "Or paste this link into your browser:",
    footer: "This invite was sent from the {orgName} workspace on Pasdiu.",
    // Mirrors app/src/i18n/locales/configs/roles.ts (contractor displays as Editor).
    roles: { admin: "Admin", pm: "Project Manager", contractor: "Editor", client: "Client" },
};
const es = {
    subject: "Te han invitado a {orgName} en Pasdiu",
    heading: "Únete a {orgName}",
    body: "Te han invitado a unirte a {orgName} en Pasdiu como {role}.",
    button: "Aceptar invitación",
    linkFallback: "O pega este enlace en tu navegador:",
    footer: "Esta invitación se envió desde el espacio de trabajo {orgName} en Pasdiu.",
    roles: { admin: "Administrador", pm: "Gestor de proyecto", contractor: "Editor", client: "Cliente" },
};
const DICTIONARIES = { en, es };
function dictionaryFor(locale) {
    // Unknown/missing locales fall back to 'en' (the app's fallbackLocale too).
    return locale === "es" ? DICTIONARIES.es : DICTIONARIES.en;
}
function fill(template, vars) {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}
/** Org names are user-typed — escape them before interpolation into HTML. */
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
/**
 * Render the invite email (subject + HTML + plain-text). HTML is kept
 * email-client-safe: a single centered column, inline styles only (no
 * stylesheet, no flexbox/grid), a button-styled link with the plain URL
 * repeated underneath for clients that strip styles.
 */
function renderInviteEmail({ orgName, role, inviteUrl, locale }) {
    const d = dictionaryFor(locale);
    const roleName = d.roles[role] ?? role;
    const vars = { orgName, role: roleName };
    const htmlVars = { orgName: escapeHtml(orgName), role: escapeHtml(roleName) };
    const subject = fill(d.subject, vars);
    const text = [
        fill(d.heading, vars),
        "",
        fill(d.body, vars),
        "",
        `${d.button}: ${inviteUrl}`,
        "",
        fill(d.footer, vars),
    ].join("\n");
    const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:12px;padding:32px;font-family:Helvetica,Arial,sans-serif;text-align:left;">
            <tr>
              <td>
                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#18181b;">${fill(d.heading, htmlVars)}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3f46;">${fill(d.body, htmlVars)}</p>
                <p style="margin:0 0 24px;">
                  <a href="${inviteUrl}" style="display:inline-block;background-color:#0891b2;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 24px;border-radius:8px;">${d.button}</a>
                </p>
                <p style="margin:0 0 4px;font-size:13px;line-height:1.6;color:#71717a;">${d.linkFallback}</p>
                <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${inviteUrl}" style="color:#0891b2;">${inviteUrl}</a></p>
                <p style="margin:0;border-top:1px solid #e4e4e7;padding-top:16px;font-size:12px;line-height:1.6;color:#a1a1aa;">${fill(d.footer, htmlVars)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
    return { subject, html, text };
}
