#!/usr/bin/env tsx
/**
 * seo-dev management CLI — for humans and AI agents.
 *
 * Usage:
 *   npm run cli -- <command> [options]
 *   npm run cli -- --help
 */
import { defineCommand, runMain } from 'citty';
import { articlesCommand } from './commands/articles';
import { dbCommand } from './commands/db';
import { infraCommand } from './commands/infra';

const main = defineCommand({
  meta: {
    name: 'seo',
    version: '0.1.0',
    description: 'seo-dev CLI — infra checks, database management, and article pipeline ops',
  },
  subCommands: {
    infra: infraCommand,
    db: dbCommand,
    articles: articlesCommand,
  },
});

runMain(main);
