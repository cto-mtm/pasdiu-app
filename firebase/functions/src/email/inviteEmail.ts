// Invite-email renderer — pure function, no Firestore, no network.
//
// i18n note: functions can't use the app's vue-i18n modules, so this module
// carries its own tiny en+es dictionary. The strings deliberately MIRROR the
// app's tone and vocabulary (see app/src/i18n/locales/configs/roles.ts and
// locales/pages/team.ts) — if the app copy changes, update this dictionary in
// the same change. `en` is the source of truth; `es` is typed against it so
// the two locales cannot diverge (same convention as the app's modules).

export type MailLocale = "en" | "es";

type RoleKey = "admin" | "pm" | "contractor" | "client";

interface Dictionary {
  subject: string; // {orgName}
  heading: string; // {orgName}
  body: string; // {orgName}, {role}
  button: string;
  linkFallback: string;
  footer: string; // {orgName}
  roles: Record<RoleKey, string>;
}

const en: Dictionary = {
  subject: "You're invited to {orgName} on Pasdiu",
  heading: "Join {orgName}",
  body: "You've been invited to join {orgName} on Pasdiu as {role}.",
  button: "Accept invite",
  linkFallback: "Or paste this link into your browser:",
  footer: "This invite was sent from the {orgName} workspace on Pasdiu.",
  // Mirrors app/src/i18n/locales/configs/roles.ts (contractor displays as Editor).
  roles: { admin: "Admin", pm: "Project Manager", contractor: "Editor", client: "Client" },
};

const es: typeof en = {
  subject: "Te han invitado a {orgName} en Pasdiu",
  heading: "Únete a {orgName}",
  body: "Te han invitado a unirte a {orgName} en Pasdiu como {role}.",
  button: "Aceptar invitación",
  linkFallback: "O pega este enlace en tu navegador:",
  footer: "Esta invitación se envió desde el espacio de trabajo {orgName} en Pasdiu.",
  roles: { admin: "Administrador", pm: "Gestor de proyecto", contractor: "Editor", client: "Cliente" },
};

const DICTIONARIES: Record<MailLocale, Dictionary> = { en, es };

function dictionaryFor(locale: string | undefined): Dictionary {
  // Unknown/missing locales fall back to 'en' (the app's fallbackLocale too).
  return locale === "es" ? DICTIONARIES.es : DICTIONARIES.en;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

/** Org names are user-typed — escape them before interpolation into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface InviteEmailInput {
  orgName: string;
  role: string; // one of the app's roles; unknown values render as-is
  inviteUrl: string;
  locale?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Brand tokens — MIRROR app/src/assets/css/main.css (":root" Cinematic Dark
// theme). Email clients can't read the app's CSS variables, so the hex values
// are inlined here; if the theme changes, update this block in the same change.
const BRAND = {
  bg: "#121212", // --bg
  surface: "#1e1e1e", // --surface
  surface2: "#262626", // --surface-2 (BaseButton background)
  border: "#333333", // --border
  text: "#f5f5f5", // --text
  textMuted: "#a3a3a3", // --text-muted
  accentCyan: "#22d3ee", // --accent-cyan (links/indicators only, per theme)
  // Web fonts via @import below; these stacks are the graceful fallback for
  // clients that strip <style> (Gmail keeps <style> but drops remote fonts).
  fontDisplay: "'Boldonse',system-ui,-apple-system,'Segoe UI',sans-serif", // --font-display
  fontBody: "'B612 Mono',ui-monospace,'SFMono-Regular',Menlo,monospace", // --font-body
};

/**
 * Render the invite email (subject + HTML + plain-text). HTML is kept
 * email-client-safe: a single centered column, table layout, inline styles
 * (the only <style> block is the font @import — progressive enhancement), a
 * button-styled link with the plain URL repeated underneath for clients that
 * strip styles. Visuals follow the app's Cinematic Dark brand (BRAND above):
 * dark card, Boldonse display wordmark/heading, B612 Mono body, neutral
 * BaseButton-style CTA, cyan reserved for the fallback link.
 */
export function renderInviteEmail({ orgName, role, inviteUrl, locale }: InviteEmailInput): RenderedEmail {
  const d = dictionaryFor(locale);
  const roleName = d.roles[role as RoleKey] ?? role;
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
  <head>
    <meta charset="utf-8">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Boldonse&family=B612+Mono&display=swap');
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.bg};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.bg};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:12px;padding:32px;text-align:left;">
            <tr>
              <td>
                <p style="margin:0 0 24px;font-family:${BRAND.fontDisplay};font-weight:400;font-size:15px;letter-spacing:0.04em;color:${BRAND.text};">Pasdiu</p>
                <h1 style="margin:0 0 16px;font-family:${BRAND.fontDisplay};font-weight:400;font-size:20px;line-height:1.3;color:${BRAND.text};">${fill(d.heading, htmlVars)}</h1>
                <p style="margin:0 0 24px;font-family:${BRAND.fontBody};font-size:14px;line-height:1.7;color:${BRAND.textMuted};">${fill(d.body, htmlVars)}</p>
                <p style="margin:0 0 24px;">
                  <a href="${inviteUrl}" style="display:inline-block;background-color:${BRAND.surface2};border:1px solid ${BRAND.border};color:${BRAND.text};text-decoration:none;font-family:${BRAND.fontBody};font-size:14px;font-weight:bold;padding:12px 24px;border-radius:8px;">${d.button}</a>
                </p>
                <p style="margin:0 0 4px;font-family:${BRAND.fontBody};font-size:12px;line-height:1.6;color:${BRAND.textMuted};">${d.linkFallback}</p>
                <p style="margin:0 0 24px;font-family:${BRAND.fontBody};font-size:12px;line-height:1.6;word-break:break-all;"><a href="${inviteUrl}" style="color:${BRAND.accentCyan};">${inviteUrl}</a></p>
                <p style="margin:0;border-top:1px solid ${BRAND.border};padding-top:16px;font-family:${BRAND.fontBody};font-size:12px;line-height:1.6;color:${BRAND.textMuted};">${fill(d.footer, htmlVars)}</p>
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
