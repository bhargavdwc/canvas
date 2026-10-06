import crypto from 'node:crypto';
import type { StoredMessage } from '../repo/types';
import { loadConfig } from '../config';
import { createAppContext } from '../app';

const WORDS = (
  'light river window midnight paper static orchard signal harbor ember quiet lantern ' +
  'thunder velvet distant morning garden echo marble compass whisper silver ocean ' +
  'forest ladder pocket letter shadow tender bright hollow gentle voyage anchor meadow ' +
  'kindle ripple faint season thread canvas beacon puzzle lullaby copper winter summer'
).split(' ');

function randomSentence(): string {
  const len = 6 + Math.floor(Math.random() * 8);
  const w: string[] = [];
  for (let i = 0; i < len; i++) {
    w.push(WORDS[Math.floor(Math.random() * WORDS.length)] as string);
  }
  return `${w[0]!.charAt(0).toUpperCase()}${w.join(' ').slice(1)}.`;
}

async function main() {
  const count = Number(process.argv[2] || 500);
  console.log(`Seeding ${count} messages...`);
  const config = loadConfig(process.env);
  const ctx = await createAppContext(config);

  const sessionId = crypto.randomUUID();
  const messages: StoredMessage[] = [];
  const CELL = 500;
  const JITTER = 140;
  const gridSide = Math.ceil(Math.sqrt(count / 0.6));
  const offset = (gridSide * CELL) / 2;

  let created = 0;
  for (let gx = 0; gx < gridSide && created < count; gx++) {
    for (let gy = 0; gy < gridSide && created < count; gy++) {
      if (Math.random() > 0.65) continue;
      const x = Math.round(gx * CELL - offset + CELL / 2 + (Math.random() * 2 - 1) * JITTER);
      const y = Math.round(gy * CELL - offset + CELL / 2 + (Math.random() * 2 - 1) * JITTER);
      messages.push({
        id: crypto.randomUUID(),
        sessionId,
        content: `${randomSentence()} ${randomSentence()}`,
        position: { x, y },
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 30 * 86400 * 1000)).toISOString(),
        status: 'active',
      });
      created++;
    }
  }

  await ctx.repo.insertMessages(messages);
  console.log(`Successfully seeded ${messages.length} spatial messages.`);
  await ctx.repo.close();
}

void main();
