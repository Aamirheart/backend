import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import { IPricingModuleService } from "@medusajs/types";

export default async function autoPriceUsd({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const pricingModule: IPricingModuleService = container.resolve(Modules.PRICING);

  // 1. Fetch the Price Set for the Variant
  // (Note: In v2, you might need to fetch the variant to get the price_set_id)
  // For simplicity, this logic assumes we have the price_set_id
  const priceSets = await pricingModule.listPriceSets({
    id: [data.id] 
  }, { relations: ["prices"] });

  if (!priceSets.length) return;
  const priceSet = priceSets[0];

  // 2. Find the INR Price
  const inrPrice = priceSet.prices.find(p => p.currency_code === "inr");

  if (inrPrice) {
    // 3. Calculate USD Price (Logic: INR amount * 2? Or usually conversion / 80 * 2?)
    // Your requirement was "Price * 2", so:
    const targetUsdAmount = inrPrice.amount * 2; 

    // 4. Update or Create the USD Price programmatically
    await pricingModule.addPrices([{
      price_set_id: priceSet.id,
      prices: [{
        currency_code: "usd",
        amount: targetUsdAmount,
        min_quantity: 1,
      }]
    }]);
    
    console.log(`Updated USD price to ${targetUsdAmount} for PriceSet ${priceSet.id}`);
  }
}

export const config: SubscriberConfig = {
  event: "price_set.updated", // Listen to price updates
};