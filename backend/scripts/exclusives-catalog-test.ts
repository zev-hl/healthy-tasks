/* eslint-disable no-console */
import { getCatalogItem } from '../src/services/exclusives/sp-api/catalog.js';

function values(attrs: Record<string, Array<Record<string, unknown>>> | undefined, key: string) {
  const v = attrs?.[key];
  return Array.isArray(v) ? v : [];
}

async function main() {
  const asin = process.argv[2] ?? 'B000W7GXZ2';
  console.log(`Catalog Items lookup for ASIN ${asin} (US, read-only)…\n`);

  const item = await getCatalogItem(asin, 'USA');
  const s = item.summaries?.[0];
  const attrs = item.attributes;
  const bullets = values(attrs, 'bullet_point').map((b) => b.value).filter((v): v is string => typeof v === 'string');
  const desc = values(attrs, 'product_description')[0]?.value;
  const dims = values(attrs, 'item_package_dimensions')[0] ?? values(attrs, 'item_dimensions')[0];
  const mainImg = item.images?.[0]?.images?.find((i) => i.variant === 'MAIN')?.link;

  console.log(`Title:       ${s?.itemName ?? '(none)'}`);
  console.log(`Brand:       ${s?.brand ?? '(none)'}`);
  console.log(`Manufacturer:${s?.manufacturer ?? '(none)'}`);
  console.log(`Category:    ${s?.browseClassification?.displayName ?? '(none)'}`);
  console.log(`Main image:  ${mainImg ?? '(none)'}`);
  console.log(`Dimensions:  ${dims ? JSON.stringify(dims) : '(none)'}`);
  console.log(`\nBullet points (${bullets.length}):`);
  bullets.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
  console.log(`\nDescription:\n  ${(typeof desc === 'string' ? desc : '(none)').slice(0, 300)}`);
  console.log(`\nAttribute keys (${Object.keys(attrs ?? {}).length}): ${Object.keys(attrs ?? {}).join(', ')}`);
}

void main();
