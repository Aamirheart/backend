import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    // 1. Log to confirm the request reached the backend
    console.log("--- Custom Booking Request Received ---");
    console.log("Body:", req.body);

    // 2. Extract data
    const { variant_id, quantity, country_code, therapist_id, metadata } = req.body as any;

    if (!variant_id || !country_code) {
      return res.status(400).json({ message: "Missing required fields (variant_id, country_code)" });
    }

    // 3. Define Logic for Dynamic Price
    // Logic: Therapist "11" costs 2000, others cost 1000
    let customUnitPrice = 1000; 
    if (therapist_id === "11") {
      customUnitPrice = 2000;
    }
    console.log(`Applying Custom Price: ${customUnitPrice} for Therapist: ${therapist_id}`);

    // 4. Resolve necessary Medusa Services
    const cartModuleService = req.scope.resolve(Modules.CART);
    const regionModuleService = req.scope.resolve(Modules.REGION);
    
    // 5. Get Region details (Currency etc.)
    const regions = await regionModuleService.listRegions({ countries: { iso_2: country_code } });
    if (!regions.length) {
      return res.status(400).json({ message: `Region not found for country: ${country_code}` });
    }
    const region = regions[0];

    // 6. Create the Cart with CUSTOM PRICE
    const cart = await cartModuleService.createCarts({
      region_id: region.id,
      currency_code: region.currency_code,
      items: [
        {
          variant_id: variant_id,
          quantity: quantity ?? 1,
          unit_price: customUnitPrice, // <--- Key Step: Overriding the price
          metadata: {
            ...metadata,
            therapist_id: therapist_id,
            is_dynamic_price: true
          }
        }
      ]
    });

    console.log("Cart Created Successfully:", cart.id);

    // 7. Return Cart ID to Frontend
    return res.json({ cart_id: cart.id });

  } catch (error: any) {
    console.error("CRITICAL ERROR in /store/custom/add-booking:", error);
    return res.status(500).json({ message: error.message || "Internal Server Error" });
  }
}