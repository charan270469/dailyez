import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWhatsAppStatusJid,
  isWhatsAppGroupJid,
  isWhatsAppGroupSystemMessage,
  normalizeWhatsAppMessage,
  normalizeWhatsAppChatIdForGrouping,
  groupWhatsAppConversations,
  beginWhatsAppResync,
  completeWhatsAppResync,
  getWhatsAppResyncState,
  __seedWhatsAppContact,
  __seedWhatsAppChat,
  __seedWhatsAppLidMapping,
  __clearWhatsAppCaches,
} from '../whatsapp/connection.js';

test('canonical chat id unifies PN / LID / bare-number forms of the same 1:1 chat', () => {
  // No live socket store in tests, so the fallback is the bare JID. The key
  // invariant is that all forms of the same contact collapse to ONE id.
  assert.equal(normalizeWhatsAppChatIdForGrouping('919876543210@s.whatsapp.net'), '919876543210');
  assert.equal(normalizeWhatsAppChatIdForGrouping('919876543210'), '919876543210');
  assert.equal(normalizeWhatsAppChatIdForGrouping('919876543210@lid'), '919876543210');
  assert.equal(normalizeWhatsAppChatIdForGrouping('abc'), 'abc');
});

test('canonical chat id keeps group JIDs intact', () => {
  assert.equal(normalizeWhatsAppChatIdForGrouping('1234567890-123456@g.us'), '1234567890-123456@g.us');
  assert.equal(normalizeWhatsAppChatIdForGrouping('919876543210@s.whatsapp.net'), '919876543210');
});

test('normalizeWhatsAppMessage converts Baileys payloads into inbox-ready message docs', () => {
  assert.equal(isWhatsAppStatusJid('status@broadcast'), true);
  assert.equal(isWhatsAppStatusJid('919876543210@s.whatsapp.net'), false);
  assert.equal(isWhatsAppStatusJid('1234567890-123456@g.us'), false);
});

test('identifies WhatsApp group JIDs', () => {
  assert.equal(isWhatsAppGroupJid('1234567890-123456@g.us'), true);
  assert.equal(isWhatsAppGroupJid('919876543210@s.whatsapp.net'), false);
  assert.equal(isWhatsAppGroupJid('status@broadcast'), false);
});

test('group-membership system notifications are flagged for exclusion', () => {
  const added = normalizeWhatsAppMessage({
    key: { remoteJid: '1234567890-123456@g.us', participant: '919876543210@s.whatsapp.net', fromMe: false, id: 'SYS_ADD' },
    messageTimestamp: 1710000000,
    messageStubType: 27, // GROUP_PARTICIPANT_ADD
    messageStubParameters: ['Ankitha'],
    message: {},
  });
  assert.equal(isWhatsAppGroupSystemMessage(added), true);

  const left = normalizeWhatsAppMessage({
    key: { remoteJid: '1234567890-123456@g.us', participant: '919876543210@s.whatsapp.net', fromMe: false, id: 'SYS_LEAVE' },
    messageTimestamp: 1710000000,
    messageStubType: 32, // GROUP_PARTICIPANT_LEAVE
    messageStubParameters: [],
    message: {},
  });
  assert.equal(isWhatsAppGroupSystemMessage(left), true);

  // A real conversational group message is NOT a system notification.
  const real = normalizeWhatsAppMessage({
    key: { remoteJid: '1234567890-123456@g.us', participant: '919876543210@s.whatsapp.net', fromMe: false, id: 'REAL1' },
    messageTimestamp: 1710000000,
    message: { conversation: 'Are we meeting tomorrow?' },
  });
  assert.equal(isWhatsAppGroupSystemMessage(real), false);

  // 1:1 chats are never system notifications (no membership stub events).
  const dm = normalizeWhatsAppMessage({
    key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'DM1' },
    messageTimestamp: 1710000000,
    message: { conversation: 'I left it at home' },
  });
  assert.equal(isWhatsAppGroupSystemMessage(dm), false);

  // Legacy record without stub metadata still caught via rendered text.
  assert.equal(
    isWhatsAppGroupSystemMessage({ isGroup: true, content: 'Karthik G removed Ankitha' }),
    true,
  );
  assert.equal(
    isWhatsAppGroupSystemMessage({ isGroup: true, content: 'Busy day, more later' }),
    false,
  );

  __clearWhatsAppCaches();
});

test('normalizeWhatsAppMessage converts Baileys payloads into inbox-ready message docs', () => {
  const raw = {
    key: {
      remoteJid: '919876543210@s.whatsapp.net',
      fromMe: false,
      id: '3EB0ABCDEF123',
    },
    pushName: 'Alice',
    messageTimestamp: 1710000000,
    message: {
      conversation: 'Hey, we can do the project next week.',
    },
  };

  const result = normalizeWhatsAppMessage(raw);

  assert.equal(result.source, 'whatsapp');
  assert.equal(result.id, '3EB0ABCDEF123');
  // No saved contact available (no socket store), so the bare number is shown —
  // never the contact's self-chosen pushName.
  assert.equal(result.from, '919876543210');
  assert.equal(result.subject, 'WhatsApp chat');
  assert.equal(result.sender, '919876543210');
  assert.match(result.content, /project next week/);
  assert.equal(result.preview, result.content);
  assert.ok(result.timestamp instanceof Date);
  assert.equal(result.isGroup, false);
});

test('normalizeWhatsAppMessage drops status updates entirely (including captions)', () => {
  const status = {
    key: {
      remoteJid: 'status@broadcast',
      participant: '919876543210@s.whatsapp.net',
      fromMe: false,
      id: 'STATUS_1',
    },
    pushName: 'Alice',
    messageTimestamp: 1710000000,
    message: {
      imageMessage: { url: 'https://mmg.whatsapp.net/x', caption: 'Status caption that must NOT be fetched' },
    },
  };

  assert.equal(isWhatsAppStatusJid(status.key.remoteJid), true);
  assert.equal(normalizeWhatsAppMessage(status), null);
});

test('group messages are labeled with the group identity', () => {
  const groupMsg = {
    key: {
      remoteJid: '1234567890-123456@g.us',
      participant: '919876543210@s.whatsapp.net',
      fromMe: false,
      id: 'GROUP_1',
    },
    pushName: 'Alice',
    messageTimestamp: 1710000000,
    message: {
      conversation: 'Meeting at 5 PM.',
    },
  };

  const result = normalizeWhatsAppMessage(groupMsg);

  assert.equal(result.isGroup, true);
  assert.equal(result.groupJid, '1234567890-123456@g.us');
  // No live socket store in tests, so no saved group subject — falls back to the group id.
  assert.equal(result.groupName, null);
  assert.equal(result.from, '1234567890-123456');
  assert.equal(result.sender, '919876543210');
  assert.match(result.content, /Meeting at 5 PM/);
});

test('extracts text from wrapped messages and describes media without captions', () => {
  const wrapped = normalizeWhatsAppMessage({
    key: { remoteJid: '919876543210@s.whatsapp.net', id: 'WRAPPED_1' },
    message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'Wrapped text' } } } },
  });
  const media = normalizeWhatsAppMessage({
    key: { remoteJid: '919876543210@s.whatsapp.net', id: 'MEDIA_1' },
    message: { viewOnceMessage: { message: { videoMessage: { mimetype: 'video/mp4' } } } },
  });

  assert.equal(wrapped.content, 'Wrapped text');
  assert.equal(media.content, 'Video was sent');
});

test('resolves a saved 1:1 contact name (never the contact self-chosen pushName)', () => {
  __clearWhatsAppCaches();
  __seedWhatsAppContact({
    id: '919876543210@s.whatsapp.net',
    phoneNumber: '919876543210@s.whatsapp.net',
    lid: '9876543210@lid',
    name: 'Alice Smith',
    notify: 'alice_self_chosen', // must NOT be used as the saved name
  });

  const result = normalizeWhatsAppMessage({
    key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'P1' },
    messageTimestamp: 1710000000,
    message: { conversation: 'Hi there' },
  });

  assert.equal(result.from, 'Alice Smith');
  assert.equal(result.sender, 'Alice Smith');
  assert.equal(result.subject, 'WhatsApp chat');
  __clearWhatsAppCaches();
});

test('LID-keyed message resolves to the phone-numbered saved contact', () => {
  __clearWhatsAppCaches();
  // Contact saved under the phone-numbered JID...
  __seedWhatsAppContact({
    id: '919876543210@s.whatsapp.net',
    phoneNumber: '919876543210@s.whatsapp.net',
    name: 'Bob Example',
  });
  // ...but WhatsApp currently keys that same chat by a rotating LID JID.
  __seedWhatsAppLidMapping('9876543210@lid', '919876543210@s.whatsapp.net');

  const result = normalizeWhatsAppMessage({
    key: { remoteJid: '9876543210@lid', fromMe: false, id: 'L1' },
    messageTimestamp: 1710000000,
    message: { conversation: 'via lid' },
  });

  assert.equal(result.from, 'Bob Example');
  assert.equal(result.sender, 'Bob Example');
  __clearWhatsAppCaches();
});

test('group subject is resolved from cached chat metadata', () => {
  __clearWhatsAppCaches();
  __seedWhatsAppChat({ id: '1234567890-123456@g.us', name: 'Forest Team' });

  const result = normalizeWhatsAppMessage({
    key: {
      remoteJid: '1234567890-123456@g.us',
      participant: '919876543210@s.whatsapp.net',
      fromMe: false,
      id: 'G1',
    },
    messageTimestamp: 1710000000,
    message: { conversation: 'Standup at 10' },
  });

  assert.equal(result.isGroup, true);
  assert.equal(result.groupName, 'Forest Team');
  assert.equal(result.from, 'Forest Team');
  assert.match(result.subject, /Forest Team/);
  __clearWhatsAppCaches();
});

test('conversation grouping counts all persisted messages and previews the newest', () => {
  __clearWhatsAppCaches();
  // The chat is keyed by a LID on WhatsApp, but that LID maps to a phone number.
  __seedWhatsAppLidMapping('175316555276422@lid', '919876543210@s.whatsapp.net');

  const docs = [
    {
      source: 'whatsapp', id: 'M1', chatId: '919876543210@s.whatsapp.net',
      content: 'older', preview: 'older', timestamp: new Date('2026-01-01T00:00:00Z'),
    },
    {
      source: 'whatsapp', id: 'M2', chatId: '175316555276422@lid',
      content: 'newest', preview: 'newest', timestamp: new Date('2026-01-02T00:00:00Z'),
    },
  ];
  const conversations = groupWhatsAppConversations(docs, []);
  // LID + phone-numbered messages collapse into ONE conversation, count 2.
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].messageCount, 2);
  assert.equal(conversations[0].preview, 'newest');
  __clearWhatsAppCaches();
});

test('status@broadcast documents are excluded from conversation grouping', () => {
  const docs = [
    { source: 'whatsapp', id: 'S1', chatId: 'status@broadcast', content: 'status' },
    { source: 'whatsapp', id: 'R1', chatId: '919876543210@s.whatsapp.net', content: 'real' },
  ];
  const conversations = groupWhatsAppConversations(docs, []);
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].content, 'real');
});

test('legacy status updates stored with a status senderJid are excluded too', () => {
  const docs = [
    {
      source: 'whatsapp', id: 'S2', chatId: '919876543210@s.whatsapp.net',
      senderJid: 'status@broadcast', content: 'legacy status',
    },
  ];
  const conversations = groupWhatsAppConversations(docs, []);
  // The doc references a status broadcast via its raw key and is skipped.
  assert.equal(conversations.length, 0);
});

test('resync state helper uses a single resyncing contract and completes', () => {
  completeWhatsAppResync();
  // Idle initially.
  assert.equal(getWhatsAppResyncState().resyncing, false);
  beginWhatsAppResync({ cleared: 4, purged: 1 });
  const during = getWhatsAppResyncState();
  assert.equal(during.resyncing, true);
  assert.equal(during.cleared, 4);
  completeWhatsAppResync();
  assert.equal(getWhatsAppResyncState().resyncing, false);
  // Idempotent: a second begin while completed just re-fires into a new cycle.
  beginWhatsAppResync({ cleared: 3, purged: 0 });
  assert.equal(getWhatsAppResyncState().resyncing, true);
  completeWhatsAppResync();
});

// ─── Content extraction for system / stub / protocol / modern message types ───

test('group system event (stub) messages get readable content instead of blank', () => {
  __clearWhatsAppCaches();
  __seedWhatsAppContact({ id: '919876543210@s.whatsapp.net', name: 'Karthik G' });

  const result = normalizeWhatsAppMessage({
    key: {
      remoteJid: '1234567890-123456@g.us',
      participant: '919876543210@s.whatsapp.net',
      fromMe: false,
      id: 'GSTUB1',
    },
    messageTimestamp: 1710000000,
    messageStubType: 27, // GROUP_PARTICIPANT_ADD
    messageStubParameters: ['Ankitha'],
    message: {},
  });

  assert.equal(result.isGroup, true);
  assert.match(result.content, /Karthik G added Ankitha/);
  assert.equal(result.preview, result.content);
  __clearWhatsAppCaches();
});

test('own group actions are described as "You"', () => {
  __clearWhatsAppCaches();

  // Self-join shows as "You joined the group" rather than "You added You".
  const result = normalizeWhatsAppMessage({
    key: {
      remoteJid: '1234567890-123456@g.us',
      participant: '919876543210@s.whatsapp.net',
      fromMe: true,
      id: 'GSTUB2',
    },
    messageTimestamp: 1710000000,
    messageStubType: 27, // GROUP_PARTICIPANT_ADD
    messageStubParameters: [
      '{"id":"19444680023670@lid","phoneNumber":"919876543210@s.whatsapp.net","admin":null}',
    ],
    message: {},
  });

  assert.match(result.content, /You joined the group/);
  __clearWhatsAppCaches();
});

test('protocol system messages (deleted / disappearing settings) produce readable text', () => {
  __clearWhatsAppCaches();
  __seedWhatsAppContact({ id: '919876543210@s.whatsapp.net', name: 'Ravi' });

  const revoked = normalizeWhatsAppMessage({
    key: {
      remoteJid: '1234567890-123456@g.us',
      participant: '919876543210@s.whatsapp.net',
      fromMe: false,
      id: 'GPROTO1',
    },
    messageTimestamp: 1710000000,
    message: {
      protocolMessage: { type: 0, key: { id: 'ORIGINAL_1' } }, // REVOKE
    },
  });
  assert.equal(revoked.content, 'This message was deleted');

  const ephemeral = normalizeWhatsAppMessage({
    key: {
      remoteJid: '1234567890-123456@g.us',
      participant: '919876543210@s.whatsapp.net',
      fromMe: false,
      id: 'GPROTO2',
    },
    messageTimestamp: 1710000000,
    message: {
      protocolMessage: { type: 3, ephemeralExpiration: 86400 }, // EPHEMERAL_SETTING
    },
  });
  assert.equal(ephemeral.content, 'Ravi changed the disappearing messages setting');

  __clearWhatsAppCaches();
});

test('participant-leave and number-change stubs render as human text', () => {
  __clearWhatsAppCaches();

  const left = normalizeWhatsAppMessage({
    key: {
      remoteJid: '1234567890-123456@g.us',
      participant: '919876543210@s.whatsapp.net',
      fromMe: false,
      id: 'GSTUB_LEAVE',
    },
    messageTimestamp: 1710000000,
    messageStubType: 32, // GROUP_PARTICIPANT_LEAVE
    messageStubParameters: [],
    message: {},
  });
  assert.match(left.content, /left the group/);

  const changedNumber = normalizeWhatsAppMessage({
    key: {
      remoteJid: '1234567890-123456@g.us',
      participant: '919876543210@s.whatsapp.net',
      fromMe: false,
      id: 'GSTUB_NUM',
    },
    messageTimestamp: 1710000000,
    messageStubType: 33, // GROUP_PARTICIPANT_CHANGE_NUMBER
    messageStubParameters: ['NEWNUMBER@lid'],
    message: {},
  });
  assert.match(changedNumber.content, /changed their phone number/);

  __clearWhatsAppCaches();
});

test('polls, list replies, reactions and video messages produce readable text', () => {
  __clearWhatsAppCaches();

  const poll = normalizeWhatsAppMessage({
    key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'P1' },
    messageTimestamp: 1710000000,
    message: { pollCreationMessage: { name: 'Which slot works?' } },
  });
  assert.equal(poll.content, 'Poll: Which slot works?');

  const listReply = normalizeWhatsAppMessage({
    key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'L1' },
    messageTimestamp: 1710000000,
    message: { listResponseMessage: { singleSelectReply: { selectedRowId: 'Option A' } } },
  });
  assert.equal(listReply.content, 'Selected: Option A');

  const reaction = normalizeWhatsAppMessage({
    key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'R1' },
    messageTimestamp: 1710000000,
    message: { reactionMessage: { text: '👍' } },
  });
  assert.equal(reaction.content, 'Reacted 👍');

  const video = normalizeWhatsAppMessage({
    key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'V1' },
    messageTimestamp: 1710000000,
    message: { ptvMessage: {} },
  });
  assert.equal(video.content, 'Video message');

  __clearWhatsAppCaches();
});

test('edited messages are unwrapped and their latest text is used', () => {
  __clearWhatsAppCaches();

  const result = normalizeWhatsAppMessage({
    key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'E1' },
    messageTimestamp: 1710000000,
    message: {
      editedMessage: {
        message: { extendedTextMessage: { text: 'updated version of a message' } },
      },
    },
  });

  assert.match(result.content, /updated version of a message/);
  __clearWhatsAppCaches();
});

test('modern participant JSON stub parameters resolve to names or bare numbers', () => {
  __clearWhatsAppCaches();
  // Unnamed contact in a modern stub JSON parameter (Baileys stores these as
  // JSON strings) must render as a bare phone number, never the raw JSON blob.
  const result = normalizeWhatsAppMessage({
    key: {
      remoteJid: '1234567890-123456@g.us',
      participant: '919876543210@s.whatsapp.net',
      fromMe: false,
      id: 'GSTUB3',
    },
    messageTimestamp: 1710000000,
    messageStubType: 27, // GROUP_PARTICIPANT_ADD
    messageStubParameters: [
      '{"id":"81338124263558@lid","phoneNumber":"916301525382@s.whatsapp.net","admin":null}',
    ],
    message: {},
  });

  assert.doesNotMatch(result.content, /\{"/, 'no raw JSON blob may leak into content');
  assert.match(result.content, /added 916301525382/);
  __clearWhatsAppCaches();
});