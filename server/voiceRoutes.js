// Voice-agent HTTP routes: transcribes recorded audio via Groq Whisper and
// routes + executes text voice commands (summarize, add signal, navigate, disconnect).
import express from 'express';
import dotenv from 'dotenv';
import Groq, { toFile } from 'groq-sdk';
import { routeIntent } from './agents/routeVoiceIntent.js';
import { executeAction } from './agents/executeVoiceAction.js';

dotenv.config(); // load server/.env config early — same pattern as auth.js / db.js

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const TRANSCRIBE_MODEL = 'whisper-large-v3-turbo';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB — generous upper bound for a voice command

/**
 * Maps a MIME type to the file extension Groq's Whisper expects.
 * MediaRecorder normally produces audio/webm (Chrome/Firefox) or audio/mp4 (Safari).
 */
function extensionForMimeType(mimeType) {
  const type = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const extByType = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/flac': 'flac',
  };
  return extByType[type] || 'webm';
}

/**
 * Pulls the raw audio bytes + metadata out of the request.
 *
 * Supported request shapes:
 *  1. application/json — { "audioBase64": "<base64>", "mimeType"? } ("audio" is accepted as an alias)
 *  2. audio/*          — Content-Type: audio/webm (etc.), raw audio bytes as the body
 *
 * @param {import('express').Request} req
 * @returns {{ buffer: Buffer, mimeType: string, filename: string }}
 */
function extractAudio(req) {
  const contentType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();

  // Raw binary audio — parsed into req.body by the express.raw() middleware.
  if (contentType.startsWith('audio/')) {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      const err = new Error('Audio body is empty');
      err.status = 400;
      throw err;
    }
    return {
      buffer: req.body,
      mimeType: contentType,
      filename: `recording.${extensionForMimeType(contentType)}`,
    };
  }

  // JSON body carrying a base64-encoded audio string.
  if (contentType === 'application/json') {
    const base64 = req.body?.audioBase64 || req.body?.audio;
    if (!base64 || typeof base64 !== 'string' || base64.length === 0) {
      const err = new Error('Missing audio. Send JSON { "audioBase64": "<base64>" } or raw audio/* bytes.');
      err.status = 400;
      throw err;
    }

    const mimeType = req.body?.mimeType || 'audio/webm';
    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch (parseError) {
      const err = new Error('audioBase64 is not valid base64 data');
      err.status = 400;
      throw err;
    }

    if (buffer.length === 0) {
      const err = new Error('Decoded audio is empty');
      err.status = 400;
      throw err;
    }

    return {
      buffer,
      mimeType,
      filename: `recording.${extensionForMimeType(mimeType)}`,
    };
  }

  const err = new Error('Unsupported content type. Send JSON { "audioBase64": "<base64>" } or raw audio/* bytes.');
  err.status = 415;
  throw err;
}

/**
 * Voice AI backend routes.
 * @param {import('express').Express} app
 */
export function registerVoiceRoutes(app) {
  // POST /api/voice/transcribe — speech-to-text via Groq Whisper
  app.post(
    '/api/voice/transcribe',
    express.raw({ type: 'audio/*', limit: MAX_AUDIO_BYTES }),
    async (req, res) => {
      try {
        if (!process.env.GROQ_API_KEY) {
          return res.status(500).json({ ok: false, error: 'GROQ_API_KEY is not set. Add it to server/.env' });
        }

        const { buffer, mimeType, filename } = extractAudio(req);

        const transcription = await groq.audio.transcriptions.create({
          model: TRANSCRIBE_MODEL,
          response_format: 'json',
          file: await toFile(buffer, filename, { type: mimeType }),
        });

        res.json({ text: (transcription.text || '').trim() });
      } catch (error) {
        const status = error.status || 500;
        if (status === 429) {
          const message = error.error?.message || error.message;
          return res.status(429).json({ ok: false, error: 'AI rate limit reached. Try again in a few minutes.', details: String(message).slice(0, 300) });
        }
        if (status >= 500) {
          console.error('Failed to transcribe audio:', error);
        } else {
          console.warn(`Transcribe rejected (${status}):`, error.message);
        }
        res.status(status).json({ ok: false, error: error.message || 'Failed to transcribe audio' });
      }
    }
  );

  // POST /api/voice/command — full voice pipeline (text already transcribed):
  // intent routing -> action execution -> spoken + displayed response
  app.post('/api/voice/command', async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      if (!text) {
        return res.status(400).json({ ok: false, error: 'Missing text. Send JSON { "text": "..." }' });
      }

      const { action, params } = await routeIntent(text);
      const result = await executeAction(action, params);

      res.json({
        response: result.response,
        ...(result.navigateTo ? { navigateTo: result.navigateTo } : {}),
      });
    } catch (error) {
      if (error.status === 429) {
        const message = error.error?.message || error.message;
        return res.status(429).json({
          ok: false,
          response: "The AI's rate limit was just reached, so I couldn't run that command. Give it a few minutes, then try again.",
          error: 'AI rate limit reached',
          details: String(message).slice(0, 300),
        });
      }
      console.error('Failed to process voice command:', error);
      res.status(500).json({ ok: false, error: error.message || 'Failed to process voice command' });
    }
  });
}