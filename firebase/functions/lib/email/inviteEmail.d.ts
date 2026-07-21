export type MailLocale = "en" | "es";
export interface InviteEmailInput {
    orgName: string;
    role: string;
    inviteUrl: string;
    locale?: string;
}
export interface RenderedEmail {
    subject: string;
    html: string;
    text: string;
}
/**
 * Render the invite email (subject + HTML + plain-text). HTML is kept
 * email-client-safe: a single centered column, inline styles only (no
 * stylesheet, no flexbox/grid), a button-styled link with the plain URL
 * repeated underneath for clients that strip styles.
 */
export declare function renderInviteEmail({ orgName, role, inviteUrl, locale }: InviteEmailInput): RenderedEmail;
