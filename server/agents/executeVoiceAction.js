// Executes a routed voice action (summarize emails, create signal, disconnect platform,
// navigate, WhatsApp summary, find email, general answer) and returns the text response
// the assistant should speak/display.
import { summarizeEmailsInRange } from './summarizeEmails.js';
import { summarizeWhatsAppChat } from './summarizeWhatsApp.js';
import { findEmail } from './findEmail.js';
import { generalAnswer } from './generalAnswer.js';
import { createSignal } from './createSignal.js';
import { disconnectGmail } from '../auth.js';

const PLATFORM_LABELS = { gmail: 'Gmail', whatsapp: 'WhatsApp', discord: 'Discord' };

/**
 * Executes a routed assistant action and returns the text response.
 *
 * @param {"summarize_emails"|"create_signal"|"disconnect_platform"|"navigate"|"summarize_whatsapp"|"find_email"|"general_query"} action
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

    case 'summarize_whatsapp': {
      const { summary } = await summarizeWhatsAppChat({
        chat: params.chat,
        count: params.count,
        groupsOnly: params.groupsOnly,
      });
      return { response: summary };
    }

    case 'find_email': {
      const result = await findEmail(params.query);
      // Navigate to All Inbox so the user can actually see the matched email.
      return { response: result.response, ...(result.found ? { navigateTo: 'inbox' } : {}) };
    }

    case 'general_query':
    default: {
      const answer = await generalAnswer(params.text);
      return { response: answer };
    }
  }
}