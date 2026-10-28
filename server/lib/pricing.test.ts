import { describe, expect, it } from "vitest";

import { comparePricing, competitorWords, perThousandResults, relevantTo, type Competitor } from "./pricing.js";

const rival = (price: number | null, rating: number | null = 4.5, title = "x"): Competitor => ({
  id: String(Math.random()),
  title,
  url: "https://apify.com/a/b",
  users30d: 10,
  rating,
  pricePer1000: price,
  priceLabel: null,
  description: "",
});

describe("perThousandResults", () => {
  it("reads per-item pricing", () => {
    expect(perThousandResults({ pricingModel: "PRICE_PER_DATASET_ITEM", pricePerUnitUsd: 0.002 })).toBe(2);
  });

  it("reads the primary pay-per-event price, using the list (FREE) tier", () => {
    const info = {
      pricingModel: "PAY_PER_EVENT",
      pricingPerEvent: {
        actorChargeEvents: {
          "apify-actor-start": { eventPriceUsd: 0.05 },
          "apify-default-dataset-item": { isPrimaryEvent: true, eventTieredPricingUsd: { FREE: { tieredEventPriceUsd: 0.00075 }, GOLD: { tieredEventPriceUsd: 0.0005 } } },
        },
      },
    };
    expect(perThousandResults(info)).toBe(0.75);
  });

  it("returns null for rentals and missing data rather than guessing", () => {
    expect(perThousandResults({ pricingModel: "FLAT_PRICE_PER_MONTH", pricePerUnitUsd: 20 })).toBeNull();
    expect(perThousandResults(null)).toBeNull();
  });
});

describe("competitorWords", () => {
  it("drops prices, emoji and marketing from a real-world title", () => {
    expect(competitorWords("Trustpilot All Reviews Scraper 💰$0.65+ · No Cap · AI Insights", "x")).toEqual(["Trustpilot", "Reviews"]);
  });

  it("falls back to the actor name", () => {
    expect(competitorWords(null, "reed-jobs-scraper")).toEqual(["reed", "jobs"]);
  });
});

describe("comparePricing ignores dead actors", () => {
  it("does not count competitors with almost no users", () => {
    const dead = [0.4, 0.5, 0.6, 0.5, 0.45].map((p) => ({ ...rival(p), users30d: 1 }));
    expect(comparePricing(2, 4.5, dead).verdict).toBe("unknown");
  });
});

describe("relevantTo", () => {
  it("keeps only competitors that mention every key word", () => {
    const list = [rival(1, 4, "YouTube Comments Scraper"), rival(1, 4, "YouTube Scraper"), rival(1, 4, "Comments exporter for YouTube")];
    list[1]!.description = "also exports comments";
    expect(relevantTo(list, ["YouTube", "Comments"]).map((r) => r.title)).toEqual(["YouTube Comments Scraper", "Comments exporter for YouTube"]);
  });
});

describe("comparePricing", () => {
  const rivals = [rival(0.4), rival(0.5), rival(0.6), rival(0.5), rival(0.45), rival(null)];

  it("flags a price well above the median", () => {
    const v = comparePricing(1.5, 4.0, rivals);
    expect(v.verdict).toBe("above");
    expect(v.median).toBe(0.5);
    expect(v.recommendation).toMatch(/above the median/);
  });

  it("accepts a premium backed by the top rating", () => {
    expect(comparePricing(1.5, 5, rivals.slice(0, 5)).recommendation).toMatch(/may be justified/);
  });

  it("flags room to raise a price far below the median", () => {
    expect(comparePricing(0.1, 4.5, rivals).verdict).toBe("below");
  });

  it("is in line within 50 percent", () => {
    expect(comparePricing(0.55, 4.5, rivals).verdict).toBe("in-line");
    expect(comparePricing(0.7, 4.5, rivals).verdict).toBe("in-line");
  });

  it("refuses to judge with fewer than 5 comparable competitors", () => {
    const v = comparePricing(1, 4.5, [rival(0.5), rival(0.6), rival(0.7), rival(0.8), rival(null)]);
    expect(v.verdict).toBe("unknown");
  });

  it("says so when there is no price to compare", () => {
    expect(comparePricing(null, null, rivals).recommendation).toMatch(/no per-result price/i);
  });
});
