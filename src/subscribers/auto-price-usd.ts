import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import { IPricingModuleService, IRegionModuleService } from "@medusajs/types";

// Helper to parse the Env Config
function getPricingRules() {
  try {
    const rules = process.env.DYNAMIC_PRICING_RULES;
    if (!rules) return [];
    return JSON.parse(rules);
  } catch (e) {
    console.error("Failed to parse DYNAMIC_PRICING_RULES from .env", e);
    return [];
  }
}

export default async function autoPriceDynamicInr({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const pricingModule: IPricingModuleService = container.resolve(Modules.PRICING);
  
  // Note: Depending on your specific Medusa setup, Regions might be in the REGION module or STORE module.
  // We try resolving the Region Module first.
  const regionModule: IRegionModuleService = container.resolve(Modules.REGION);

  const rules = getPricingRules();
  if (rules.length === 0) return;

  // 1. Fetch the Price Set
  const priceSets = await pricingModule.listPriceSets({
    id: [data.id] 
  }, { relations: ["prices"] });

  if (!priceSets.length) return;
  const priceSet = priceSets[0];

  // 2. Find the Base INR Price (The one with NO region_id)
  // We assume the "Base" price is the one generic for INR.
  const basePrice = priceSet.prices.find(
    p => p.currency_code === "inr" && Object.keys(p.rules || {}).length === 0
  );

  if (!basePrice) {
    // If we can't find a base price, we can't calculate multipliers.
    return;
  }

  // 3. Get All Regions to map Country -> Region ID
  const allRegions = await regionModule.listRegions({}, { relations: ["countries"] });

  const newPrices = [];

  for (const rule of rules) {
    // A. Find the Region ID for this country code (e.g., "us")
    const targetRegion = allRegions.find(r => 
      r.countries.some(c => c.iso_2 === rule.country.toLowerCase())
    );

    if (!targetRegion) {
      console.warn(`Skipping rule for ${rule.country}: No region found containing this country.`);
      continue;
    }

    // B. Calculate the new Amount (INR * Multiplier)
    const targetAmount = Math.round(basePrice.amount * rule.multiplier);

    // C. Prepare the Price Object
    // We strictly use INR, but restrict it to a specific region_id.
    const pricePayload = {
      currency_code: "inr",
      amount: targetAmount,
      min_quantity: 1,
      rules: {
        region_id: targetRegion.id,
      },
    };

    // D. Check if this exact price already exists to avoid duplicates
    const existingPrice = priceSet.prices.find(p => 
      p.currency_code === "inr" && 
      p.rules?.region_id === targetRegion.id
    );

    if (!existingPrice || existingPrice.amount !== targetAmount) {
      newPrices.push(pricePayload);
      console.log(`Prepared INR Price for Region ${targetRegion.name} (${rule.country}): ${targetAmount}`);
    }
  }

  // 4. Write to Database
  if (newPrices.length > 0) {
    await pricingModule.addPrices([{
      price_set_id: priceSet.id,
      prices: newPrices
    }]);
    console.log(`Updated Region-Specific INR prices for: ${rules.map(r => r.country).join(", ")}`);
  }
}

export const config: SubscriberConfig = {
  event: "price_set.updated",
};