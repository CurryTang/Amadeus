#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { extractLatestPaperPosts } = require('../src/services/twitter-playwright-tracker.service');
const { normalizeTwitterProfileLinks } = require('../src/utils/twitter-profile-links');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const linksFromArgs = args.links || process.env.X_PROFILE_LINKS || '';
  const { normalized: profileLinks } = normalizeTwitterProfileLinks(linksFromArgs);

  const maxPostsPerProfile = parseInt(
    args.maxPostsPerProfile || process.env.X_MAX_POSTS_PER_PROFILE || '15',
    10
  );
  const onlyWithPaperLinks = args.papersOnly
    ? true
    : process.env.X_ONLY_WITH_PAPER_LINKS === 'true';
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : '';

  if (profileLinks.length === 0) {
    console.error(
      'No valid profile links provided. Use --links "https://x.com/user1,https://x.com/user2"'
    );
    process.exit(1);
  }

  const result = await extractLatestPaperPosts({
    mode: 'playwright',
    profileLinks,
    maxPostsPerProfile,
    onlyWithPaperLinks,
  });

  const json = JSON.stringify(result, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json);
    console.log(`Saved ${result.totalPosts} post(s) to ${outPath}`);
    return;
  }

  console.log(json);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
