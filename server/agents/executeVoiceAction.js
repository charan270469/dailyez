// Executes a routed voice action (summarize emails, create signal, disconnect platform,
// navigate) and returns the text response the voice agent should speak/display.
import { summarizeEmailsInRange } from './summarizeEmails.js';
import { createSignal } from './createSignal.js';
import { disconnectGmail } from '../auth.js';

const PLATFORM_LABELS = { gmail: 'Gmail', whatsapp: 'WhatsApp', discord: 'Discord' };

const GENERAL_FALLBACK =
  "I can help you summarize emails, add signals, or navigate the app — try asking me one of those.";

/**
 * Executes a routed voice action and returns the text-to-speak response.
 *
 * @param {"summarize_emails"|"create_signal"|"disconnect_platform"|"navigate"|"general_query"} action
 * @param {Object} params
 * @returns {Promise<{ response: string, navigateTo?: string }>}
 */
export async function executeAction(action, params = {}) {
  switch (action) {
    case 'summarize_emails': {
      const timeRange = params.timeRange || 'today';
      const { summary } = await summarizeEmailsInRange(timeRange);
      return { response: summary };
    }

    case 'create_signal': {
      const context = String(params.context || '').trim();
      if (!context) {
        return {
          response: "I didn't catch what you'd like to track. Try saying something like \"add a signal for emails from recruiters\".",
        };
      }
      await createSignal(context, []);
      return { response: `Added a new signal: ${context}` };
    }

    case 'disconnect_platform': {
      const platform = String(params.platform || 'gmail').toLowerCase();
      const label = PLATFORM_LABELS[platform] || platform;

      // WhatsApp/Discord were never actually connected — never fake a disconnect.
      if (platform !== 'gmail') {
        return { response: `${label} isn't connected yet — there's nothing to disconnect.` };
      }

      await disconnectGmail('default');
      return {
        response:
          'Gmail has been disconnected. Your previously fetched messages are still here, and you can reconnect anytime from Settings.',
      };
    }

    case 'navigate': {
      const tab = params.tab || 'important';
      return { response: `Opening ${tab.replace(/_/g, ' ')}`, navigateTo: tab };
    }

    case 'general_query':
    default:
      return { response: GENERAL_FALLBACK };
  }
}