#!/usr/bin/env tsx
/**
 * seo-dev management CLI — for humans and AI agents.
 *
 * Usage:
 *   npm run cli -- <command> [options]
 *   npm run cli -- --help
 */
import { defineCommand, runMain } from 'citty';
import { infraCommand } from './commands/infra';

const main = defineCommand({
  meta: {
    name: 'seo',
    version: '0.1.0',
    description: 'seo-dev CLI — infra checks and database management',
  },
  subCommands: {
    infra: infraCommand,
  },
});

runMain(main);
