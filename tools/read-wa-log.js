#!/usr/bin/env node
/**
 * Read recent WhatsApp conversation from NanoClaw transcript
 *
 * Usage: node read-wa-log.js [--limit 20] [--path /custom/path]
 *
 * Reads the latest JSONL transcript from NanoClaw's session directory
 * and displays the most recent human/agent exchanges.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = '/Users/jerpint/nanoclaw/data/sessions/main/.claude/projects/-workspace-group';
const DEFAULT_LIMIT = 20;

// Parse args
const args = process.argv.slice(2);
let limit = DEFAULT_LIMIT;
let transcriptDir = DEFAULT_PATH;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--path' && args[i + 1]) {
    transcriptDir = args[i + 1];
    i++;
  }
}

// Find the latest .jsonl file in the directory
function findLatestTranscript(dir) {
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      name: f,
      mtime: fs.statSync(path.join(dir, f)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? path.join(dir, files[0].name) : null;
}

// Extract sender name and text from user message content
function parseUserMessage(content) {
  const match = content.match(/<message sender="([^"]*)" time="([^"]*)">([\s\S]*?)<\/message>/);
  if (!match) return null;
  return {
    sender: match[1],
    time: new Date(match[2]),
    text: match[3].trim()
  };
}

// Extract text from assistant message content
function parseAssistantText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textParts = content
      .filter(c => c.type === 'text')
      .map(c => c.text);
    return textParts.join('');
  }
  return null;
}

// Format timestamp
function formatTime(date) {
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    hour12: true
  });
}

// Truncate long text
function truncate(text, max = 200) {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function main() {
  const file = findLatestTranscript(transcriptDir);
  if (!file) {
    console.log('⚠ No WhatsApp transcript found (NanoClaw may not be running)');
    return;
  }

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');

  // Collect conversation exchanges (user messages + assistant text responses)
  const exchanges = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === 'user' && typeof entry.message?.content === 'string') {
      const parsed = parseUserMessage(entry.message.content);
      if (parsed) {
        exchanges.push({
          role: 'human',
          sender: parsed.sender.toLowerCase() === 'jeremy' ? 'jerpint' : parsed.sender,
          time: parsed.time,
          text: parsed.text
        });
      }
    } else if (entry.type === 'assistant' && entry.message?.content) {
      const text = parseAssistantText(entry.message.content);
      if (text && text.trim()) {
        exchanges.push({
          role: 'assistant',
          sender: 'neowolt',
          time: new Date(entry.timestamp),
          text: text.trim()
        });
      }
    }
  }

  // Deduplicate assistant messages (streaming produces multiple entries for same response)
  const deduped = [];
  for (let i = 0; i < exchanges.length; i++) {
    const curr = exchanges[i];
    const next = exchanges[i + 1];

    // Skip assistant entries that are followed by another assistant entry (keep the last one)
    if (curr.role === 'assistant' && next && next.role === 'assistant') {
      continue;
    }
    deduped.push(curr);
  }

  const recent = deduped.slice(-limit);

  if (recent.length === 0) {
    console.log('⚠ WhatsApp transcript found but no conversation exchanges parsed');
    return;
  }

  console.log('=== Recent WhatsApp conversation ===\n');

  for (const ex of recent) {
    const time = formatTime(ex.time);
    const text = truncate(ex.text);
    console.log(`[${time}] ${ex.sender}: ${text}`);
  }

  console.log(`\n(${recent.length} most recent exchanges)`);
}

main();
