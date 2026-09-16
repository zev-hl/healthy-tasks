import type { ListingItem } from '../../src/services/exclusives/sp-api/listings.js';
import type { ListingOffersPayload } from '../../src/services/exclusives/sp-api/pricing.js';

// Trimmed from real SP-API responses, keeping the exact shapes we parse.

// Brand-owned listing (SOMBRA): full content in the seller's own attributes,
// image via the media locator, price + currency from the offer.
export const ownedListing: ListingItem = {
  sku: 'SOM-0003',
  summaries: [
    {
      marketplaceId: 'ATVPDKIKX0DER',
      asin: 'B0HD28Z5TX',
      productType: 'MEDICATION',
      itemName: 'Sombra MAX 5 Active OTC Topical Analgesic 4 oz.',
      status: ['DISCOVERABLE'],
    },
  ],
  attributes: {
    brand: [{ value: 'SOMBRA' }],
    bullet_point: [{ value: 'OTC topical analgesic cream.' }, { value: 'Menthol 6%, camphor 3%.' }],
    product_description: [{ value: 'Sombra MAX is an OTC topical analgesic cream.' }],
    item_package_dimensions: [
      {
        length: { value: 2.5, unit: 'inches' },
        width: { value: 2.5, unit: 'inches' },
        height: { value: 2, unit: 'inches' },
      },
    ],
    main_product_image_locator: [{ media_location: 'https://m.media-amazon.com/images/I/71fIlObcgPL.jpg' }],
  },
  issues: [],
  offers: [{ price: { amount: 14.49, currencyCode: 'USD' } }],
};

// Reseller listing: only offer/fulfillment attributes; catalog image from the
// summary; price from the purchasable_offer schedule (no currency there).
export const resellerListing: ListingItem = {
  sku: 'KI-5380',
  summaries: [
    {
      marketplaceId: 'ATVPDKIKX0DER',
      asin: 'B07G4G3DP9',
      productType: 'HAIR_COLORING_AGENT',
      itemName: 'Red by Kiss Tintation Semi-Permanent Hair Color (Hawaiian Fire, 5 Fl Oz)',
      mainImage: { link: 'https://m.media-amazon.com/images/I/31-0q9nwTsL.jpg' },
      status: ['DISCOVERABLE'],
    },
  ],
  attributes: {
    purchasable_offer: [{ currency: 'USD', our_price: [{ schedule: [{ value_with_tax: 6.19 }] }] }],
    fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT' }],
  },
  issues: [],
  offers: [],
};

// Suppressed via an explicit enforcement action.
export const suppressedListing: ListingItem = {
  sku: 'SUP-1',
  summaries: [{ asin: 'B000SUPPR1', itemName: 'Suppressed item', status: ['DISCOVERABLE'] }],
  attributes: {},
  issues: [
    {
      code: '90220',
      message: 'Image requirement not met.',
      severity: 'WARNING',
      enforcements: { actions: [{ action: 'SEARCH_SUPPRESSED' }] },
    },
  ],
  offers: [],
};

// Suppressed via an ERROR-severity issue (not BUYABLE).
export const errorSeverityListing: ListingItem = {
  sku: 'ERR-1',
  summaries: [{ asin: 'B000ERROR1', itemName: 'Error item', status: ['DISCOVERABLE'] }],
  attributes: {},
  issues: [{ code: '99001', message: 'Attribute invalid.', severity: 'ERROR' }],
  offers: [],
};

// BUYABLE despite an ERROR-severity issue — purchasable, so NOT suppressed.
export const buyableWithErrorListing: ListingItem = {
  sku: 'BUY-ERR',
  summaries: [{ asin: 'B000BUYERR', itemName: 'Buyable item', status: ['BUYABLE', 'DISCOVERABLE'] }],
  attributes: {},
  issues: [{ code: '5000', message: 'Attribute compliance issue.', severity: 'ERROR' }],
  offers: [{ price: { amount: 75.6, currencyCode: 'USD' } }],
};

// --- Pricing / Buy Box payloads ---

export const offersCompetitor: ListingOffersPayload = {
  ASIN: 'B0YSL1602',
  SKU: 'C-YSL-1602-A',
  Summary: {
    TotalOfferCount: 26,
    BuyBoxPrices: [{ condition: 'New', LandedPrice: { Amount: 89.98, CurrencyCode: 'USD' } }],
  },
  Offers: [
    { SellerId: 'A1UWLDVGZSXGKG', ListingPrice: { Amount: 94.99 }, Shipping: { Amount: 0 }, IsBuyBoxWinner: true },
    { SellerId: 'A3GRC7XH38FJ6S', ListingPrice: { Amount: 89.98 }, Shipping: { Amount: 0 }, IsBuyBoxWinner: false },
  ],
};

export const offersWeHold: ListingOffersPayload = {
  ASIN: 'B0OWN0001',
  SKU: 'OWN-1',
  Summary: {
    TotalOfferCount: 3,
    BuyBoxPrices: [{ condition: 'New', LandedPrice: { Amount: 24.99, CurrencyCode: 'USD' } }],
  },
  Offers: [
    { SellerId: 'A1UWLDVGZSXGKG', ListingPrice: { Amount: 19.99 }, Shipping: { Amount: 5.0 } },
    { SellerId: 'AXXXCOMP', ListingPrice: { Amount: 26.5 }, Shipping: { Amount: 0 } },
  ],
};

export const offersSuppressed: ListingOffersPayload = {
  ASIN: 'B0SUPPBB0',
  SKU: 'SUPP-BB',
  Summary: { TotalOfferCount: 0, BuyBoxPrices: [] },
  Offers: [],
};
